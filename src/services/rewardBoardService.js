/*
 * NAVIGATION HEADER
 * FILE: src/services/rewardBoardService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */


'use strict';
// src/services/rewardBoardService.js
// Reward and history boards. Edits in place and skips unchanged payloads.

const { EmbedBuilder }      = require('discord.js');
const { makeLogger }        = require('../utils/logger');
const { buildProgressBar }  = require('../utils/helpers');
const { upsertBoardMessage } = require('./boardManagerService');
const activeLeagueService = require('./activeLeagueService');
const log = makeLogger('rewardBoards');

const STREAM_TIERS = [
  { count: 8,  label: 'Superstar Dev Trait'      },
  { count: 16, label: 'Dev Upgrade or Age Reset' },
];

let _getCh  = null;
let _state  = null;

function init({ getCh, state }) {
  _getCh = getCh;
  _state = state;
}

async function upsertBoard(guild, boardKey, channelKey, embed) {
  const ch = _getCh(guild, channelKey);
  if (!ch) return { skipped: true, reason: 'missing-channel' };

  const payload = { embeds: [embed], allowedMentions: { parse: [] } };
  try {
    return await upsertBoardMessage({
      boardKey,
      channel: ch,
      payload,
    });
  } catch (err) {
    log.error(`Failed to upsert '${boardKey}' board:`, err.message);
    return { error: true, message: err.message };
  }
}

function buildPotwBoardEmbed() {
  const history = _state.potwHistory;
  if (!history.length) {
    return new EmbedBuilder().setColor(0xf1c40f)
      .setTitle('⭐ Player of the Week History')
      .setDescription('No POTW winners yet this season.').setTimestamp();
  }
  const typeLabels = { AFC_OFF:'🏈 AFC Off', AFC_DEF:'🛡 AFC Def', NFC_OFF:'🏈 NFC Off', NFC_DEF:'🛡 NFC Def', LEAGUE:'⭐ Best in League' };
  const byWeek = {};
  for (const p of history) { if (!byWeek[p.week]) byWeek[p.week]=[]; byWeek[p.week].push(p); }
  const weeks = Object.keys(byWeek).map(Number).sort((a,b)=>b-a).slice(0,4);
  const fields = weeks.map(w => ({
    name: `Week ${w}`,
    value: byWeek[w].map(p=>`${typeLabels[p.type]||p.type}: **${p.player}** — ${p.displayTeam}`).join('\n'),
    inline: false,
  }));
  return new EmbedBuilder().setColor(0xf1c40f)
    .setTitle('⭐ Player of the Week — Season History')
    .addFields(fields)
    .setFooter({ text: `${history.length} total POTW awards` }).setTimestamp();
}

function buildStreamBoardEmbed() {
  const standings = [..._state.players.values()]
    .filter(p => p.streamCount > 0)
    .sort((a,b) => b.streamCount - a.streamCount)
    .slice(0, 20);
  const medals = ['🥇','🥈','🥉'];
  const rows = standings.map((p,i) => {
    const next = STREAM_TIERS.find(t => t.count > p.streamCount);
    return `${medals[i]||`${i+1}.`} **${p.displayTeam}** — ${p.streamCount} streams\n> \`${buildProgressBar(p.streamCount,16)}\` ${next?`${next.count-p.streamCount} to ${next.label}`:'🏆 Max'}`;
  });
  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle('📺 STREAM STANDINGS & MILESTONES')
    .setDescription(rows.length ? rows.join('\n\n') : 'No streams logged yet.')
    .setTimestamp();
  const milestones = (_state.streamMilestones || []).slice(-10).reverse();
  if (milestones.length) {
    embed.addFields({ name: '🎖 Recent Milestones', value: milestones.map(m=>`**${m.displayTeam}** hit **${m.count} streams** → ${m.reward}`).join('\n') });
  }
  embed.setFooter({ text: 'Every stream = +2 non-physical attr boost • Post link in #livestreams' });
  return embed;
}

function buildYearlyAwardBoardEmbed() {
  const history = _state.yearlyAwardHistory;
  if (!history.length) {
    return new EmbedBuilder().setColor(0xffd700).setTitle('🏆 Yearly Awards').setDescription('No yearly awards yet.').setTimestamp();
  }
  const bySeason = {};
  for (const a of history) { if (!bySeason[a.season]) bySeason[a.season]=[]; bySeason[a.season].push(a); }
  const lines = [];
  for (const season of Object.keys(bySeason).map(Number).sort((a,b)=>b-a)) {
    lines.push(`**Season ${season}**`);
    for (const a of bySeason[season]) lines.push(`${a.awardLabel} — **${a.player}** (${a.displayTeam}) ${a.isXF?'🔄 AR':'⭐ Dev'}`);
    lines.push('');
  }
  return new EmbedBuilder().setColor(0xffd700).setTitle('🏆 Yearly Awards — History')
    .setDescription(lines.join('\n').trim()).setTimestamp();
}

function buildSuperbowlBoardEmbed() {
  const history = _state.superbowlHistory;
  if (!history.length) {
    return new EmbedBuilder().setColor(0xffd700).setTitle('🏆 SUPER BOWL CHAMPIONS').setDescription('No champions yet.').setTimestamp();
  }
  const rows = [...history].reverse().map(s =>
    `**Season ${s.season}** — 🏆 **${s.displayTeam}**${s.userId?` (<@${s.userId}>)`:''}${s.score?` — ${s.score}`:''}\n> Rewards: 1× Age Reset + 1× X-Factor`
  );
  return new EmbedBuilder().setColor(0xffd700).setTitle('🏆 SUPER BOWL CHAMPIONS')
    .setDescription(rows.join('\n\n'))
    .setFooter({ text: 'Super Bowl winners receive 1 Age Reset + 1 X-Factor' }).setTimestamp();
}

function buildStatLeadersBoardEmbed() {
  const sl = _state.currentStatLeaders;
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
    .setFooter({ text: `Week ${sl.week} • CommishAI` }).setTimestamp();
}



// ── Refresh all boards ──────────────────────────────────────────────────
async function refresh(guild) {
  if (!_getCh || !_state) { log.warn('refresh() called before init()'); return; }
  const hasActiveLeague = activeLeagueService.listOperationalLeagues().length > 0 || !!(_state.leagueConfig?.leagueTypeId && _state.leagueConfig?.leagueName);
  const hasMeaningfulData = !!(_state.currentStatLeaders || (_state.potwHistory && _state.potwHistory.length) || (_state.streamMilestones && _state.streamMilestones.length) || (_state.superbowlHistory && _state.superbowlHistory.length) || (_state.yearlyAwardHistory && _state.yearlyAwardHistory.length));
  if (!hasActiveLeague && !hasMeaningfulData) return { skipped: true, reason: 'no-active-league' };
  await Promise.allSettled([
    upsertBoard(guild, 'rewards:potw', 'rewards', buildPotwBoardEmbed()),
    upsertBoard(guild, 'rewards:streams', 'rewards', buildStreamBoardEmbed()),
    upsertBoard(guild, 'rewards:yearly', 'rewards', buildYearlyAwardBoardEmbed()),
    upsertBoard(guild, 'superbowl:history', 'superbowl', buildSuperbowlBoardEmbed()),
    upsertBoard(guild, 'stats:leaders', 'statLeaders', buildStatLeadersBoardEmbed()),
  ]);
}

module.exports = {
  init,
  refresh,
  upsertBoard,
  buildPotwBoardEmbed,
  buildStreamBoardEmbed,
  buildYearlyAwardBoardEmbed,
  buildSuperbowlBoardEmbed,
  buildStatLeadersBoardEmbed,
};
