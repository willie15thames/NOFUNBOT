/*
 * NAVIGATION HEADER
 * FILE: src/config/emojiBank.js
 * LAYER: Configuration layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: See nearby files in the same folder for related behavior.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
// src/config/emojiBank.js
// Central emoji bank — ALL emojis the bot uses, plus bulk upload to Discord.
// Emoji image files live in /emojis/nfl/ and /emojis/nba/
// Run /sync-emojis to auto-upload any missing ones to the server.

const path = require('path');

// ── Static Unicode Emojis ─────────────────────────────────────
const EMOJI = {
  SUCCESS: '✅', ERROR: '❌', WARNING: '⚠️', INFO: 'ℹ️',
  LOADING: '⏳', FIRE: '🔥', TROPHY: '🏆', STAR: '⭐', CROWN: '👑',
  FOOTBALL: '🏈', BASKETBALL: '🏀', STADIUM: '🏟', GAMEPAD: '🎮',
  WHISTLE: '📣', MEDAL: '🥇', MEDAL_2: '🥈', MEDAL_3: '🥉',
  TRADE: '🔁', BOOST: '📈', STREAM: '📺', CAMERA: '🎥', MIC: '🎙️',
  MEGAPHONE: '📢', BELL: '🔔', LOCK: '🔒', UNLOCK: '🔓', HAMMER: '🔨',
  BOOT: '🥾', SHIELD: '🛡️', WRENCH: '🔧', CLIPBOARD: '📋', CHART: '📊',
  COMMISH: '👑', PLAYER: '👤', TEAM: '👥', WAVE: '👋', HANDSHAKE: '🤝',
  POTW: '🏅', DEV_UP: '📈', SUPERBOWL: '🏆', SCHEDULE: '📅',
  RULES: '📖', OPEN_TEAM: '🏟', HIGHLIGHT: '🎬',
  WARN: '⚠️', STRIKE: '🚨', TIMEOUT: '⏰', BAN: '🔨', DISMISS: '❌',
  BAR_FULL: '█', BAR_EMPTY: '░',
};

// ── NFL Emoji Files → Discord emoji names ─────────────────────
const NFL_EMOJIS = {
  '49ers':       { file: '4375-49ers.png',          name: 'nfl_49ers' },
  'bears':       { file: '4002-chicago-bears.png',  name: 'nfl_bears' },
  'bengals':     { file: '8315-bengals.png',        name: 'nfl_bengals' },
  'bills':       { file: '3207-bills.png',          name: 'nfl_bills' },
  'broncos':     { file: '2225-broncos.png',        name: 'nfl_broncos' },
  'browns':      { file: '3410-browns.png',         name: 'nfl_browns' },
  'buccaneers':  { file: '1014-buccaneers.png',     name: 'nfl_buccaneers' },
  'cardinals':   { file: '4178-cardinals.png',      name: 'nfl_cardinals' },
  'chargers':    { file: '7279-chargers.png',       name: 'nfl_chargers' },
  'chiefs':      { file: '8133-chiefs.png',         name: 'nfl_chiefs' },
  'colts':       { file: '8534-coltslogo.png',      name: 'nfl_colts' },
  'commanders':  { file: '1310-commanders.png',     name: 'nfl_commanders' },
  'cowboys':     { file: '9528-cowboys.png',        name: 'nfl_cowboys' },
  'dolphins':    { file: '5058-dolphins.png',       name: 'nfl_dolphins' },
  'eagles':      { file: '5949-eagles.png',         name: 'nfl_eagles' },
  'falcons':     { file: '3177-falcons.png',        name: 'nfl_falcons' },
  'giants':      { file: '4173-giants.png',         name: 'nfl_giants' },
  'jaguars':     { file: '3023-jaguars.png',        name: 'nfl_jaguars' },
  'jets':        { file: '3960-jets.png',           name: 'nfl_jets' },
  'lions':       { file: '78843-lions.png',         name: 'nfl_lions' },
  'packers':     { file: '7983-packers.png',        name: 'nfl_packers' },
  'panthers':    { file: '1804-panthers.png',       name: 'nfl_panthers' },
  'patriots':    { file: '4570-patriots.png',       name: 'nfl_patriots' },
  'raiders':     { file: '1804-raiders.png',        name: 'nfl_raiders' },
  'rams':        { file: '9246-rams.png',           name: 'nfl_rams' },
  'ravens':      { file: '4375-ravens.png',         name: 'nfl_ravens' },
  'saints':      { file: '9462-saints.png',         name: 'nfl_saints' },
  'seahawks':    { file: '7454-seahawks2.png',      name: 'nfl_seahawks' },
  'steelers':    { file: '5156-steelers.png',       name: 'nfl_steelers' },
  'texans':      { file: '3615-texans.png',         name: 'nfl_texans' },
  'titans':      { file: '8038-titans.png',         name: 'nfl_titans' },
  'vikings':     { file: '3487-vikings.png',        name: 'nfl_vikings' },
};

// ── NBA Emoji Files → Discord emoji names ─────────────────────
const NBA_EMOJIS = {
  '76ers':         { file: '2878-76ers.png',          name: 'nba_76ers' },
  'bucks':         { file: '3434-bucks.png',          name: 'nba_bucks' },
  'bulls':         { file: '7199-bulls.png',          name: 'nba_bulls' },
  'cavaliers':     { file: '9460-cavaliers.png',      name: 'nba_cavaliers' },
  'celtics':       { file: '1609-celtics.png',        name: 'nba_celtics' },
  'clippers':      { file: '6452-clippers.png',       name: 'nba_clippers' },
  'grizzlies':     { file: '4737-grizzlies.png',      name: 'nba_grizzlies' },
  'nba_hawks':     { file: '1900-hawks.png',          name: 'nba_hawks' },
  'heat':          { file: '5463-heat.png',           name: 'nba_heat' },
  'hornets':       { file: '4070-hornets.png',        name: 'nba_hornets' },
  'jazz':          { file: '8173-jazz.png',           name: 'nba_jazz' },
  'nba_kings':     { file: '1758-kings.png',          name: 'nba_kings' },
  'knicks':        { file: '8941-knicks.png',         name: 'nba_knicks' },
  'lakers':        { file: '3503-lakers.png',         name: 'nba_lakers' },
  'magic':         { file: '3090-magic.png',          name: 'nba_magic' },
  'mavericks':     { file: '6534-mavericks.png',      name: 'nba_mavericks' },
  'nets':          { file: '8159-nets.png',           name: 'nba_nets' },
  'nuggets':       { file: '7985-nuggets.png',        name: 'nba_nuggets' },
  'pacers':        { file: '9445-pacers.png',         name: 'nba_pacers' },
  'pelicans':      { file: '2128-pelicans.png',       name: 'nba_pelicans' },
  'pistons':       { file: '6534-pistons.png',        name: 'nba_pistons' },
  'raptors':       { file: '8831-raptors.png',        name: 'nba_raptors' },
  'rockets':       { file: '4635-rockets.png',        name: 'nba_rockets' },
  'spurs':         { file: '1274-spurs.png',          name: 'nba_spurs' },
  'suns':          { file: '3754-suns.png',           name: 'nba_suns' },
  'thunder':       { file: '1338-thunder.png',        name: 'nba_thunder' },
  'timberwolves':  { file: '1338-timberwolves.png',   name: 'nba_timberwolves' },
  'trailblazers':  { file: '8613-trailblazers.png',   name: 'nba_trailblazers' },
  'warriors':      { file: '7061-warriors.png',       name: 'nba_warriors' },
  'wizards':       { file: '4963-wizards.png',        name: 'nba_wizards' },
  'nba2k':         { file: '22263-nba2k.png',         name: 'nba_2k' },
};

// ── Combined lookup: team key → Discord emoji name ────────────
const ALL_TEAM_EMOJIS = {};
for (const [k, v] of Object.entries(NFL_EMOJIS)) ALL_TEAM_EMOJIS[k] = v.name;
for (const [k, v] of Object.entries(NBA_EMOJIS)) ALL_TEAM_EMOJIS[k] = v.name;

// Legacy names from the old TEAM_EMOJI_MAP for backward compat
const LEGACY_NAME_MAP = {
  'ravens': 'ravens', 'browns': 'browns', 'eagles': 'eagles', 'colts': 'colts',
  'texans': 'texans', 'lions': 'lions', '49ers': '49ers', 'broncos': 'broncos',
  'dolphins': 'dolphins', 'packers': 'packers', 'cardinals': 'cardinals',
  'vikings': 'vikings', 'raiders': 'raiders', 'seahawks': 'seahawks',
  'patriots': 'patriots', 'rams': 'rams', 'buccaneers': 'buccaneers',
  'commanders': 'commanders', 'bills': 'bills', 'jets': 'jets',
  'falcons': 'falcons', 'titans': 'titans', 'chiefs': 'chiefs',
  'bengals': 'bengals', 'jaguars': '3023jaguars', 'panthers': '1804panthers',
  'cowboys': 'cowboys', 'bears': 'chicagobears', 'saints': 'saints',
  'chargers': 'chargers', 'steelers': 'steelers', 'giants': 'giants',
};

/**
 * Get a team emoji for Discord messages.
 * Tries new nfl_/nba_ name first, then legacy names from old config.
 */
function getTeamEmoji(guild, teamKey) {
  if (!guild || !teamKey) return '';
  const key = teamKey.toLowerCase().trim();
  // New standardized name
  const newName = ALL_TEAM_EMOJIS[key];
  if (newName) {
    const found = guild.emojis.cache.find(e => e.name === newName);
    if (found) return `<:${found.name}:${found.id}>`;
  }
  // Legacy name fallback
  const legacyName = LEGACY_NAME_MAP[key];
  if (legacyName) {
    const found = guild.emojis.cache.find(e =>
      e.name === legacyName || e.name.toLowerCase() === legacyName.toLowerCase()
    );
    if (found) return `<:${found.name}:${found.id}>`;
  }
  return '';
}

function getCustomEmoji(guild, name) {
  if (!guild || !name) return '';
  const found = guild.emojis.cache.find(e => e.name === name);
  return found ? `<:${found.name}:${found.id}>` : '';
}

/**
 * Upload missing team emojis to the Discord server.
 * @param {Guild} guild
 * @param {'nfl'|'nba'|'all'} league
 */
async function syncEmojis(guild, league = 'all') {
  const fs = require('fs');
  const results = { uploaded: [], skipped: [], failed: [] };
  const packs = [];
  if (league === 'nfl' || league === 'all') packs.push({ map: NFL_EMOJIS, dir: 'nfl' });
  if (league === 'nba' || league === 'all') packs.push({ map: NBA_EMOJIS, dir: 'nba' });

  for (const pack of packs) {
    for (const [teamKey, info] of Object.entries(pack.map)) {
      const existing = guild.emojis.cache.find(e => e.name === info.name);
      if (existing) { results.skipped.push(info.name); continue; }
      const legacyName = LEGACY_NAME_MAP[teamKey];
      if (legacyName && guild.emojis.cache.find(e => e.name === legacyName || e.name.toLowerCase() === legacyName.toLowerCase())) {
        results.skipped.push(`${info.name} (legacy exists)`); continue;
      }
      const filePath = path.join(__dirname, '..', '..', 'emojis', pack.dir, info.file);
      if (!fs.existsSync(filePath)) { results.failed.push(`${info.name} — file missing`); continue; }
      try {
        await guild.emojis.create({ attachment: filePath, name: info.name, reason: 'CommishAI emoji sync' });
        results.uploaded.push(info.name);
        await new Promise(r => setTimeout(r, 1200)); // rate limit
      } catch (err) { results.failed.push(`${info.name} — ${err.message}`); }
    }
  }
  return results;
}

/**
 * Audit: what's mapped, unmapped, and missing from the server.
 */
function auditEmojis(guild) {
  if (!guild) return { mapped: [], unmapped: [], missing: [] };
  const allExpected = new Set([
    ...Object.values(NFL_EMOJIS).map(e => e.name),
    ...Object.values(NBA_EMOJIS).map(e => e.name),
    ...Object.values(LEGACY_NAME_MAP),
  ]);
  const mapped = [], unmapped = [], missing = [];
  for (const [, e] of guild.emojis.cache) {
    if (allExpected.has(e.name) || allExpected.has(e.name.toLowerCase())) mapped.push(`<:${e.name}:${e.id}> ${e.name}`);
    else unmapped.push(`<:${e.name}:${e.id}> ${e.name}`);
  }
  for (const [teamKey, info] of Object.entries({ ...NFL_EMOJIS, ...NBA_EMOJIS })) {
    const found = guild.emojis.cache.find(e => e.name === info.name);
    const legacy = LEGACY_NAME_MAP[teamKey];
    const legacyFound = legacy ? guild.emojis.cache.find(e => e.name === legacy || e.name.toLowerCase() === legacy.toLowerCase()) : null;
    if (!found && !legacyFound) missing.push(`${info.name} (${teamKey})`);
  }
  return { mapped, unmapped, missing };
}

module.exports = { EMOJI, NFL_EMOJIS, NBA_EMOJIS, ALL_TEAM_EMOJIS, LEGACY_NAME_MAP, getTeamEmoji, getCustomEmoji, syncEmojis, auditEmojis };
