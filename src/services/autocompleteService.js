/*
 * Canonical Discord autocomplete lifecycle.
 * Owns sanitization, dedupe, bounds, latency/error incident capture, and exactly-one respond attempt.
 * Autocomplete is convenience UI only; execution MUST canonically re-resolve values before mutation.
 */
'use strict';

const runtimeIncidents = require('./runtimeIncidentService');

function _string(value, fallback = '') {
  const out = value == null ? fallback : String(value);
  return out;
}

function focused(interaction) {
  try {
    const row = interaction?.options?.getFocused?.(true);
    if (row && typeof row === 'object') return { name:_string(row.name), value:_string(row.value).trim() };
  } catch {}
  try { return { name:'', value:_string(interaction?.options?.getFocused?.()).trim() }; } catch { return { name:'', value:'' }; }
}

function sanitizeChoices(choices = []) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(choices) ? choices : []) {
    if (!raw) continue;
    const name = _string(raw.name ?? raw.label ?? raw.value ?? 'Option').replace(/\s+/g,' ').trim().slice(0,100);
    const value = _string(raw.value ?? '').trim().slice(0,100);
    if (!name || !value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({ name, value });
    if (out.length >= 25) break;
  }
  return out;
}

async function respond(interaction, choices = [], meta = {}) {
  if (!interaction?.isAutocomplete?.() || typeof interaction.respond !== 'function') return false;
  if (interaction.__nofunAutocompleteResponded) return false;
  interaction.__nofunAutocompleteResponded = true;
  const startedAt = Number(meta.startedAt || Date.now());
  const safe = sanitizeChoices(choices);
  try {
    await interaction.respond(safe);
    return true;
  } catch (err) {
    interaction.__nofunAutocompleteError = err;
    try {
      await runtimeIncidents.capture(err, {
        source:'autocomplete',
        eventType:'autocomplete-failure',
        severity:'warning',
        guildId:interaction.guildId || interaction.guild?.id || null,
        channelId:interaction.channelId || interaction.channel?.id || null,
        userId:interaction.user?.id || null,
        commandName:interaction.commandName || null,
        optionName:meta.optionName || focused(interaction).name || null,
        resolverStage:meta.resolverStage || 'respond',
        focusedLength:Math.min(100, Number(meta.focusedLength ?? focused(interaction).value.length) || 0),
        latencyMs:Math.max(0, Date.now() - startedAt),
      });
    } catch {}
    // An expired/unknown autocomplete interaction has no valid fallback reply channel.
    return false;
  }
}

async function run(interaction, resolver, meta = {}) {
  const startedAt = Date.now();
  const f = focused(interaction);
  try {
    const choices = await resolver({ focused:f.value.toLowerCase(), optionName:f.name, startedAt });
    return respond(interaction, choices, { ...meta, startedAt, optionName:f.name, focusedLength:f.value.length, resolverStage:'resolved' });
  } catch (err) {
    try {
      await runtimeIncidents.capture(err, {
        source:'autocomplete', eventType:'autocomplete-resolver-failure', severity:'warning',
        guildId:interaction.guildId || interaction.guild?.id || null,
        channelId:interaction.channelId || interaction.channel?.id || null,
        userId:interaction.user?.id || null,
        commandName:interaction.commandName || null,
        optionName:f.name || null,
        focusedLength:f.value.length,
        resolverStage:meta.resolverStage || 'resolver',
        latencyMs:Math.max(0, Date.now() - startedAt),
      });
    } catch {}
    return respond(interaction, [], { ...meta, startedAt, optionName:f.name, focusedLength:f.value.length, resolverStage:'fallback' });
  }
}

module.exports = { focused, sanitizeChoices, respond, run };
