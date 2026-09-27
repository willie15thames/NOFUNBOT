/*
 * NAVIGATION HEADER
 * FILE: src/services/statLeaderService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
// src/services/statLeaderService.js
// THE single stats pipeline. All stat ingestion and posting goes here.
//
// BUG FIX: old releaseWeeklyStats() called updateLeagueMemory({ scores: parsed.scores })
// where `parsed` was undefined in scope — crashing every weekly stat release silently.
// This service reads exclusively from state.hubWeeklyData which is always available.

const { EmbedBuilder } = require('discord.js');
const { makeLogger }   = require('../utils/logger');
const log = makeLogger('statLeaders');

let _getCh  = null;
let _state  = null;

function init({ getCh, state }) {
  _getCh = getCh;
  _state = state;
}

// ── Ingest new stat lines into the hub staging area ─────────────────────
function ingestStatLines(statLines = [], scores = []) {
  if (!_state) return;
  for (const sl of statLines) {
    if (sl?.player) _state.hubWeeklyData.statLines.push({ ...sl, timestamp: Date.now() });
  }
  for (const sc of scores) {
    const mk = `${_state.hubWeeklyData.week}:${(sc.team1||'').toLowerCase().replace(/\W/g,'')}:${(sc.team2||'').toLowerCase().replace(/\W/g,'')}`;
    if (!_state.hubWeeklyData.scores.some(x => x.matchKey === mk)) {
      _state.hubWeeklyData.scores.push({ ...sc, matchKey: mk, timestamp: Date.now() });
    }
  }
}

// ── Compute best-per-category leaders from all hub stat lines ───────────
function computeLeaders() {
  const lines = _state?.hubWeeklyData?.statLines;
  if (!lines?.length) return null;
  const best = {};
  for (const sl of lines) {
    const cat = (sl.stat || 'other').toLowerCase();
    if (!best[cat]) best[cat] = sl;
  }
  const week = _state.hubWeeklyData.week || '?';
  return {
    week, timestamp: Date.now(),
    passing:   best.passing   ? `${best.passing.player} — ${best.passing.team} — ${best.passing.value}`       : 'N/A',
    rushing:   best.rushing   ? `${best.rushing.player} — ${best.rushing.team} — ${best.rushing.value}`       : 'N/A',
    receiving: best.receiving ? `${best.receiving.player} — ${best.receiving.team} — ${best.receiving.value}` : 'N/A',
    defense:   best.defense   ? `${best.defense.player} — ${best.defense.team} — ${best.defense.value}`       : 'N/A',
    special:   best.kicking   ? `${best.kicking.player} — ${best.kicking.team} — ${best.kicking.value}`       : null,
  };
}

// ── Build the stat leaders embed ────────────────────────────────────────
function buildStatLeadersBoardEmbed(leaders) {
  const sl = leaders || _state?.currentStatLeaders;
  if (!sl) {
    return new EmbedBuilder().setColor(0x0096c7).setTitle('📊 STAT LEADERS')
      .setDescription('No stat leaders yet. Commissioner: use `/set-stat-leaders`.').setTimestamp();
  }
  const fields = [
    { name: '🏈 Passing',   value: sl.passing,   inline: false },
    { name: '🏃 Rushing',   value: sl.rushing,   inline: false },
    { name: '🙌 Receiving', value: sl.receiving, inline: false },
    { name: '🛡 Defense',   value: sl.defense,   inline: false },
  ];
  if (sl.special) fields.push({ name: '⭐ Spotlight', value: sl.special, inline: false });
  return new EmbedBuilder().setColor(0x0096c7)
    .setTitle(`📊 STAT LEADERS — WEEK ${sl.week}`)
    .addFields(fields)
    .setFooter({ text: `Week ${sl.week} • NOFUNLEAGUE` }).setTimestamp();
}

// ── Post stat leaders to #stat-leaders + mirror to #scoresheets ─────────
// FIX: reads from hubWeeklyData (not the old undefined `parsed` variable)

async function postStatLeaders(guild, { announce = false } = {}) {
  const leaders = computeLeaders();
  if (!leaders) { log.warn('No stat lines available — skipping post.'); return; }

  _state.currentStatLeaders = leaders;

  // Update league memory
  for (const s of (_state.hubWeeklyData.scores || [])) {
    if (!_state.leagueMemory.scores.some(m => m.matchKey && m.matchKey === s.matchKey)) {
      _state.leagueMemory.scores.push({ ...s, timestamp: Date.now() });
    }
  }
  for (const sl of (_state.hubWeeklyData.statLines || [])) {
    _state.leagueMemory.statLines.push({ ...sl, timestamp: Date.now() });
  }

  const embed = buildStatLeadersBoardEmbed(leaders);
  const scoresheetsCh = _getCh(guild, 'scoresheets');
  const announceCh = _getCh(guild, 'announcements');

  // Keep the persistent #stat-leaders board managed in rewardBoardService to avoid duplicate posts.
  try {
    const rb = require('./rewardBoardService');
    await rb.refresh(guild);
  } catch {}

  // Mirror a one-time release copy to #scoresheets only when leaders are actually posted.
  if (scoresheetsCh) {
    await scoresheetsCh.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
  }

  if (announce && announceCh) {
    const spaceId = require('../league/spaceContext').current();
    const roleId = spaceId ? require('./activeLeagueService').getLeague(spaceId)?.memberRoleId : null;
    await announceCh.send({
      content: roleId ? `<@&${roleId}>` : undefined,
      embeds: [embed],
      allowedMentions: roleId ? { roles: [roleId], parse: [] } : { parse: [] },
    }).catch(e => log.error('#announcements stat leaders failed:', e.message));
  }
}


// ── Manual override via /set-stat-leaders ───────────────────────────────

async function setStatLeadersManual(guild, { week, passing, rushing, receiving, defense, special }) {
  const leaders = { week, timestamp: Date.now(), passing, rushing, receiving, defense, special: special || null };
  _state.currentStatLeaders = leaders;
  const embed = buildStatLeadersBoardEmbed(leaders);

  // Update persistent board instead of posting duplicate messages directly into #stat-leaders.
  try { const rb = require('./rewardBoardService'); await rb.refresh(guild); } catch {}

  const scoresheetsCh = _getCh(guild, 'scoresheets');
  if (scoresheetsCh) {
    await scoresheetsCh.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(e => log.error('Manual stat mirror failed:', e.message));
  }
  return embed;
}


module.exports = {
  init,
  ingestStatLines,
  computeLeaders,
  buildStatLeadersBoardEmbed,
  postStatLeaders,
  setStatLeadersManual,
};
