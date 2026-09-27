/*
 * NAVIGATION HEADER
 * FILE: src/services/commandAliasService.js
 * LAYER: Command registration + routing boundary (V203)
 * PURPOSE: Lets a legacy top-level command be registered as a subcommand (or subcommand group) of an existing
 *          group command WITHOUT changing its handler. ONE spec (GROUPED_ALIASES) drives both sides:
 *            - registration: applyGroupedAliases(json) moves the legacy command's own definition into its container
 *              (options, descriptions and choices are the legacy builder's — no second definition exists);
 *            - routing: resolveInteractionAlias(interaction) rewrites interaction.commandName back to the legacy name
 *              BEFORE any gate runs, so dedupe, install-mode, hierarchy, validation class, auto-defer, permission
 *              checks and the router case are exactly the ones the legacy command always had.
 * WHY: Discord allows 100 top-level chat-input commands. v201/v202 defined 112, so 12 commands were silently cut.
 *      Nesting them into permission-matched groups restores all 12 with zero changes to the other 100.
 * RULES:
 *   - Container must already be a group command and have the SAME default_member_permissions and dm_permission as
 *     the legacy command (never widen who sees an admin tool). Violations throw at build time.
 *   - Legacy commands that already have subcommands become a subcommand GROUP (kind 'group'); flat legacy commands
 *     become a subcommand, optionally inside a named group.
 *   - Name collisions, >25 options per level, or container payload > MAX_COMMAND_JSON_BYTES throw at build time.
 * LOOK HERE FIRST WHEN DEBUGGING: GROUPED_ALIASES, resolveInteractionAlias(), displayPath().
 * RELATED FLOW: src/commands.js buildCommandsForState, index.js interactionCreate, routing/interactionRouter.handleInteraction.
 */

'use strict';

const SUB = 1;
const GROUP = 2;
const MAX_OPTIONS_PER_LEVEL = 25;
// Discord caps the combined length of names/descriptions/values per command at 8000 characters.
// Serialized JSON length is a strict upper bound for that count, so staying under it is always safe.
const MAX_COMMAND_JSON_BYTES = 8000;

/**
 * legacy     — original top-level command name (router case, validation class, allowlists stay keyed on it)
 * container  — existing registered group command that hosts it
 * group      — optional subcommand group inside the container (flat legacy commands only)
 * name       — subcommand name (flat) or subcommand-group name (kind 'group')
 * kind       — 'sub' for a flat legacy command, 'group' for a legacy command that has its own subcommands
 */
const GROUPED_ALIASES = Object.freeze([
  { legacy: 'hub-status',               container: 'game-channels', group: 'hub',       name: 'status',               kind: 'sub' },
  { legacy: 'clear-hub',                container: 'game-channels', group: 'hub',       name: 'clear',                kind: 'sub' },
  { legacy: 'cancel-release-timer',     container: 'game-channels', group: 'hub',       name: 'cancel-release-timer', kind: 'sub' },
  { legacy: 'cancel-potw-timer',        container: 'game-channels', group: 'hub',       name: 'cancel-potw-timer',    kind: 'sub' },
  { legacy: 'repost-schedule',          container: 'game-channels', group: 'schedule',  name: 'repost',               kind: 'sub' },
  { legacy: 'schedule-registry-status', container: 'game-channels', group: 'schedule',  name: 'registry-status',      kind: 'sub' },
  { legacy: 'live-sync-status',         container: 'game-channels', group: 'live-sync', name: 'status',               kind: 'sub' },
  { legacy: 'live-sync-now',            container: 'game-channels', group: 'live-sync', name: 'now',                  kind: 'sub' },
  { legacy: 'set-league-source-mode',   container: 'game-channels', group: 'live-sync', name: 'source-mode',          kind: 'sub' },
  { legacy: 'restore-stream',           container: 'streams',       group: null,        name: 'restore',              kind: 'sub' },
  { legacy: 'process-builder',          container: 'workflow',      group: null,        name: 'process-builder',      kind: 'group' },
  { legacy: 'process-run',              container: 'workflow',      group: null,        name: 'process-run',          kind: 'sub' },
  { legacy: 'kill-bot',                 container: 'workflow',      group: 'bot',       name: 'kill',                 kind: 'sub' },
  { legacy: 'ignite-bot',               container: 'workflow',      group: 'bot',       name: 'ignite',               kind: 'sub' },
  { legacy: 'bot-status',               container: 'workflow',      group: 'bot',       name: 'status',               kind: 'sub' },
  { legacy: 'post-server-guide',        container: 'workflow',      group: 'guide',     name: 'republish',            kind: 'sub' },
]);

const GROUP_DESCRIPTIONS = Object.freeze({
  'game-channels:hub': 'Weekly commish-hub staging and release timers (Commissioner only)',
  'game-channels:schedule': 'Weekly schedule posting and registry (Commissioner only)',
  'game-channels:live-sync': 'Legacy live sync controls and source mode (Commissioner only)',
  'workflow:bot': 'Bot lifecycle controls (Commissioner only)',
  'workflow:guide': 'Server guide publication controls (Commissioner only)',
});

const _byLegacy = new Map(GROUPED_ALIASES.map(a => [a.legacy, a]));
const _byContainer = new Map();
for (const a of GROUPED_ALIASES) {
  if (!_byContainer.has(a.container)) _byContainer.set(a.container, []);
  _byContainer.get(a.container).push(a);
}

function _isGroupCommand(json) {
  const opts = json.options || [];
  return opts.length > 0 && opts.every(o => o.type === SUB || o.type === GROUP);
}

function _samePermissions(a, b) {
  const pa = a.default_member_permissions ?? null;
  const pb = b.default_member_permissions ?? null;
  const da = a.dm_permission ?? null;
  const db = b.dm_permission ?? null;
  return String(pa) === String(pb) && String(da) === String(db);
}

function _assertLevel(options, where) {
  if (options.length > MAX_OPTIONS_PER_LEVEL) throw new Error(`[commandAlias] ${where} has ${options.length} options (max ${MAX_OPTIONS_PER_LEVEL})`);
  const names = new Set();
  for (const o of options) {
    if (names.has(o.name)) throw new Error(`[commandAlias] name collision "${o.name}" in ${where}`);
    names.add(o.name);
  }
}

/**
 * Build-time transform. Input: deduped top-level chat-input JSON (legacy commands included).
 * Output: same list with each aliased legacy command removed from the top level and nested in its container.
 * Pure: never mutates the input objects.
 */
function applyGroupedAliases(commandJson) {
  const list = commandJson.map(c => JSON.parse(JSON.stringify(c)));
  const byName = new Map(list.map(c => [c.name, c]));
  const moved = new Set();
  for (const a of GROUPED_ALIASES) {
    const legacy = byName.get(a.legacy);
    const container = byName.get(a.container);
    if (!legacy) throw new Error(`[commandAlias] legacy command /${a.legacy} is not defined`);
    if (!container) throw new Error(`[commandAlias] container /${a.container} is not defined`);
    if (!_isGroupCommand(container)) throw new Error(`[commandAlias] container /${a.container} is not a group command`);
    if (!_samePermissions(legacy, container)) throw new Error(`[commandAlias] /${a.legacy} and /${a.container} have different permissions — refusing to change who can see it`);
    const legacyOpts = legacy.options || [];
    const legacyHasSubs = legacyOpts.some(o => o.type === SUB || o.type === GROUP);
    if (legacyOpts.some(o => o.type === GROUP)) throw new Error(`[commandAlias] /${a.legacy} has subcommand groups and cannot be nested`);
    if (a.kind === 'group' && !legacyHasSubs) throw new Error(`[commandAlias] /${a.legacy} is flat but aliased as kind 'group'`);
    if (a.kind === 'sub' && legacyHasSubs) throw new Error(`[commandAlias] /${a.legacy} has subcommands and must be aliased as kind 'group'`);
    if (a.kind === 'group' && a.group) throw new Error(`[commandAlias] /${a.legacy}: a subcommand group cannot be nested inside another group`);

    const node = a.kind === 'group'
      ? { type: GROUP, name: a.name, description: legacy.description, options: legacyOpts }
      : { type: SUB, name: a.name, description: legacy.description, options: legacyOpts };

    if (a.group) {
      let grp = container.options.find(o => o.name === a.group);
      if (!grp) {
        grp = { type: GROUP, name: a.group, description: GROUP_DESCRIPTIONS[`${a.container}:${a.group}`] || `${a.group} (Commissioner only)`, options: [] };
        container.options.push(grp);
      }
      if (grp.type !== GROUP) throw new Error(`[commandAlias] /${a.container} ${a.group} exists and is not a subcommand group`);
      grp.options.push(node);
    } else {
      container.options.push(node);
    }
    moved.add(a.legacy);
  }
  const out = list.filter(c => !moved.has(c.name));
  for (const c of out) {
    if (!_byContainer.has(c.name)) continue;
    _assertLevel(c.options, `/${c.name}`);
    for (const o of c.options) if (o.type === GROUP) _assertLevel(o.options || [], `/${c.name} ${o.name}`);
    const bytes = JSON.stringify(c).length;
    if (bytes > MAX_COMMAND_JSON_BYTES) throw new Error(`[commandAlias] /${c.name} payload ${bytes} bytes exceeds ${MAX_COMMAND_JSON_BYTES}`);
  }
  return out;
}

/**
 * Runtime: if this chat-input/autocomplete interaction targets an aliased path, set interaction.commandName to the
 * legacy name so every downstream gate and the router case behave exactly as for the legacy command.
 * Idempotent (safe to call from index.js and the router). Returns the resolution or null.
 */
function resolveInteractionAlias(interaction) {
  if (!interaction) return null;
  if (interaction.__nofunAlias !== undefined) return interaction.__nofunAlias;
  interaction.__nofunAlias = null;
  const isChat = interaction.isChatInputCommand?.() || interaction.isAutocomplete?.();
  if (!isChat) return null;
  const entries = _byContainer.get(interaction.commandName);
  if (!entries) return null;
  const group = interaction.options?.getSubcommandGroup?.(false) || null;
  const sub = interaction.options?.getSubcommand?.(false) || null;
  let hit = null;
  for (const a of entries) {
    if (a.kind === 'group' ? group === a.name : ((a.group || null) === group && sub === a.name)) { hit = a; break; }
  }
  if (!hit) return null;
  const resolved = { container: interaction.commandName, group, sub, legacy: hit.legacy };
  interaction.__nofunAlias = resolved;
  interaction.commandName = hit.legacy;
  return resolved;
}

/** User-facing path for a command name, e.g. displayPath('hub-status') → '/game-channels hub status'. */
function displayPath(commandName) {
  const a = _byLegacy.get(String(commandName || '').replace(/^\//, ''));
  if (!a) return `/${String(commandName || '').replace(/^\//, '')}`;
  if (a.kind === 'group') return `/${a.container} ${a.name}`;
  return `/${a.container}${a.group ? ` ${a.group}` : ''} ${a.name}`;
}

/**
 * True when (container, group, sub) is an aliased path. Container router cases call this as a fail-closed guard:
 * if resolution was ever skipped, the container must NOT treat e.g. "live-sync now" as one of its own subcommands.
 */
function isAliasedPath(interaction) {
  const entries = _byContainer.get(interaction?.commandName);
  if (!entries) return false;
  const group = interaction.options?.getSubcommandGroup?.(false) || null;
  const sub = interaction.options?.getSubcommand?.(false) || null;
  return entries.some(a => (a.kind === 'group' ? group === a.name : ((a.group || null) === group && sub === a.name)));
}

function listAliases() { return GROUPED_ALIASES.map(a => ({ ...a, path: displayPath(a.legacy) })); }

module.exports = { GROUPED_ALIASES, MAX_OPTIONS_PER_LEVEL, MAX_COMMAND_JSON_BYTES, applyGroupedAliases, resolveInteractionAlias, isAliasedPath, displayPath, listAliases };
