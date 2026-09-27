/*
 * NAVIGATION HEADER
 * FILE: src/services/hubReleaseService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
// src/services/hubReleaseService.js
// Weekly release pipeline: 6:59pm PST daily.
// Also owns: schedule timer, POTW AI pick, NFL updates, createLeagueStructure.

const { EmbedBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const { makeLogger } = require('../utils/logger');
const { resolveServerName } = require('./serverBrandService');
const { getWeeklySettings, getAdvanceMs } = require('./weeklyAutomationService');
const { norm, splitLongText } = require('../utils/helpers');
const { getTeamEmoji, getTeamDataByAnyName } = require('../utils/teamUtils');
const { COMM_ROLE }  = require('../config/env');
const { postStatLeaders } = require('./statLeaderService');
const log = makeLogger('hubRelease');

// ── Time helpers ──────────────────────────────────────────────
// Uses UTC offsets directly — works correctly on ANY OS, timezone, or cloud host.
// PST = UTC-8. PDT = UTC-7. We always target PST (UTC-8) for consistency.
function msUntilHourPST(targetHour, targetMin) {
  const nowMs = Date.now();
  // Current time in PST (UTC-8), expressed as ms since epoch aligned to PST midnight
  const pstOffsetMs = 8 * 60 * 60 * 1000; // UTC-8
  const pstNowMs = nowMs - pstOffsetMs;
  // PST midnight of current day
  const pstMidnight = Math.floor(pstNowMs / 86400000) * 86400000;
  // Target time today in PST
  let targetMs = pstMidnight + (targetHour * 3600 + targetMin * 60) * 1000 + pstOffsetMs;
  // If we've already passed it, schedule for tomorrow
  if (targetMs <= nowMs) targetMs += 86400000;
  return targetMs - nowMs;
}
function msUntil659pmPST() { return msUntilHourPST(18, 59); }
function msUntil7pmPST()   { return msUntilHourPST(19, 0);  }

// ── Hub Release ───────────────────────────────────────────────
async function runWeeklyRelease(guild, client, state, deps, manual=false) {
  if (state.hubWeeklyData.released && !manual) return;
  state.hubWeeklyData.released = true;
  const { getCh, aiCall, MODELS } = deps;
  const week = state.hubWeeklyData.week||'?';
  log.info(`Running weekly release for Week ${week} (${manual?'manual':'auto'})`);

  await _releaseScoresheet(guild, state, getCh);
  // FIX: postStatLeaders reads from hubWeeklyData (not the old undefined `parsed`)
  await postStatLeaders(guild, { announce: true });
  await _releaseStandings(guild, state, getCh);

  // Schedule POTW pick
  if (state.hubWeeklyData.potwTimerId) clearTimeout(state.hubWeeklyData.potwTimerId);
  const delay = manual ? 1000 : 6*60*1000;
  state.hubWeeklyData.potwTimerId = setTimeout(
    () => _selectAndConfirmPOTW(guild, client, state, deps), delay
  );
}

async function _releaseScoresheet(guild, state, getCh) {
  const scores = state.hubWeeklyData.scores;
  if (!scores.length) return;
  const week = state.hubWeeklyData.week||'?';

  const lines = scores.map(s => {
    const e1=getTeamEmoji(guild,s.team1)||'🏈', e2=getTeamEmoji(guild,s.team2)||'🏈';
    const d1=getTeamDataByAnyName(s.team1,state.players)?.displayTeam||s.team1;
    const d2=getTeamDataByAnyName(s.team2,state.players)?.displayTeam||s.team2;
    const w=(s.score1??-1)>(s.score2??-1)?d1:(s.score2??-1)>(s.score1??-1)?d2:null;
    return `${e1} **${d1}** \`${s.score1??'?'}\` — \`${s.score2??'?'}\` **${d2}** ${e2}${w?' 🏆':''}`;
  });
  const embed = new EmbedBuilder().setColor(0x1a73e8).setTitle(`📋 Week ${week} — Final Scores`).setDescription(lines.join('\n')).setFooter({text:`${scores.length} games • ${resolveServerName(guild, 'this server')}`}).setTimestamp();
  const scoresCh=getCh(guild,'scoresheets'), announceCh=getCh(guild,'announcements');
  if (scoresCh) await scoresCh.send({embeds:[embed]}).catch(e=>log.error('#scoresheets failed:',e.message));
  if (announceCh) await announceCh.send({content:'@everyone',embeds:[embed],allowedMentions:{parse:['everyone']}}).catch(()=>null);
}

async function _releaseStandings(guild, state, getCh) {
  if (!state.hubWeeklyData.standings?.length) return;
  const week=state.hubWeeklyData.week||'?';
  const rows=state.hubWeeklyData.standings.slice(0,16).map(s=>
    `\`${String(s.rank||'').padStart(2)}\` ${getTeamEmoji(guild,s.team)||'🏈'} **${getTeamDataByAnyName(s.team,state.players)?.displayTeam||s.team}** — ${s.wins??'?'}W ${s.losses??'?'}L`
  );
  const embed=new EmbedBuilder().setColor(0x9b59b6).setTitle(`🏆 Week ${week} Standings`).setDescription(rows.join('\n')).setTimestamp();
  const announceCh=getCh(guild,'announcements');
  if (announceCh) await announceCh.send({content:'@everyone',embeds:[embed],allowedMentions:{parse:['everyone']}}).catch(()=>null);
}

async function _selectAndConfirmPOTW(guild, client, state, deps) {
  const { getCh, aiCall, MODELS } = deps;
  const lines = state.hubWeeklyData.statLines;
  if (!lines.length) return;
  const week = state.hubWeeklyData.week||'?';
  const summary = lines.map(sl=>`${sl.player} (${sl.team}) — ${sl.stat}: ${sl.value}`).join('\n');
  try {
    const res = await aiCall({ model:MODELS.FAST, max_tokens:300,
      messages:[{role:'user',content:`${resolveServerName(guild, 'this server')} Week ${week} stat analyst. Pick BEST OVERALL player from these stat lines. Return ONLY raw JSON: {"player":"","team":"","stat":"","statLine":"","reason":""}\n\n${summary}`}]});
    const raw=res.content[0].text.trim().replace(/^```json\s*/i,'').replace(/```\s*$/i,'');
    const pick=JSON.parse(raw);
    state.hubWeeklyData.potwCandidate=pick;
    const embed=new EmbedBuilder().setColor(0xf1c40f).setTitle(`⭐ AI BEST-IN-LEAGUE PICK — Week ${week} — CONFIRM NEEDED`).setDescription(`**Player:** ${pick.player}\n**Team:** ${pick.team}\n**Key Stat:** ${pick.statLine}\n\n**Reason:** ${pick.reason}\n\nRun \`/potw-confirm action:confirm\` to post this.`).setTimestamp();
    const commRole=COMM_ROLE?guild.roles.cache.get(COMM_ROLE):null;
    if (commRole) for (const [,m] of commRole.members) await m.send({embeds:[embed]}).catch(()=>null);
    const hubCh=getCh(guild,'commishHub');
    if (hubCh) await hubCh.send({embeds:[embed]}).catch(()=>null);
  } catch (e) { log.error('POTW AI failed:', e.message); }
}

function resetHubWeek(week, state) {
  if (state.hubWeeklyData.potwTimerId) clearTimeout(state.hubWeeklyData.potwTimerId);
  const timer = state.hubWeeklyData.releaseTimerId;
  state.hubWeeklyData = {
    week, scores:[], statLines:[], standings:null,
    potwCandidate:null, released:false,
    releaseTimerId:timer, potwTimerId:null,
  };
}

function startHubReleaseTimer(guild, client, state, deps) {
  if (state.hubWeeklyData.releaseTimerId) clearTimeout(state.hubWeeklyData.releaseTimerId);
  const scheduleNext = () => {
    const delay = msUntil659pmPST();
    log.info(`Release timer: next fire in ${Math.round(delay/60000)}m (6:59pm PST)`);
    state.hubWeeklyData.releaseTimerId = setTimeout(async () => {
      if (!state.hubWeeklyData.released && state.hubWeeklyData.scores.length)
        await runWeeklyRelease(guild, client, state, deps, false);
      scheduleNext();
    }, delay);
  };
  scheduleNext();
}

// ── Schedule ──────────────────────────────────────────────────
function parseMatchupLines(raw, guild, players) {
  const lines = raw.split('\n').map(l=>l.trim()).filter(Boolean);
  return lines.map(line => {
    const isPrimetime=/\[P\]/i.test(line), isGotw=/\[G\]/i.test(line), isOverseas=/\[O\]/i.test(line);
    const clean=line.replace(/\[[PGO]\]/gi,'').trim();
    const sep=clean.match(/\s+(?:vs\.?|@|at)\s+/i);
    if (!sep) return null;
    const idx=clean.search(/\s+(?:vs\.?|@|at)\s+/i);
    const raw1=clean.slice(0,idx).trim(), raw2=clean.slice(idx+sep[0].length).trim();
    const td1=getTeamDataByAnyName(raw1,players), td2=getTeamDataByAnyName(raw2,players);
    return { team1:td1?.displayTeam||raw1, team2:td2?.displayTeam||raw2, base1:td1?.baseTeam||raw1, base2:td2?.baseTeam||raw2, user1Id:td1?.userId||null, user2Id:td2?.userId||null, isPrimetime, isGotw, isOverseas };
  }).filter(Boolean);
}

async function postScheduleEmbed(guild, state, getCh, getTeamEmoji) {
  const { week, matchups } = state.scheduleState;
  if (!week||!matchups.length) return;
  const ch = getCh(guild,'weeklySchedule');
  if (!ch) return;
  if (state.scheduleState.pinnedMsgId) {
    try { const old=await ch.messages.fetch(state.scheduleState.pinnedMsgId); await old.delete().catch(()=>null); } catch {}
    state.scheduleState.pinnedMsgId=null;
  }
  const lines=matchups.map(m=>{
    const e1=getTeamEmoji(guild,m.base1)||'🏈', e2=getTeamEmoji(guild,m.base2)||'🏈';
    const u1=m.user1Id?`<@${m.user1Id}>`:m.team1, u2=m.user2Id?`<@${m.user2Id}>`:m.team2;
    const tag=m.isGotw?' 🏆 **GOTW**':m.isPrimetime?' 🌟 **Primetime**':m.isOverseas?' 🌍 **Overseas**':'';
    return `${e1} **${m.team1}** ${u1}\n@ ${e2} **${m.team2}** ${u2}${tag}`;
  });
  const weekly = getWeeklySettings();
  const modeText = weekly.mode === 'automatic' ? `Auto mode • ${weekly.advanceHours}h cycle` : `Manual mode • ${weekly.advanceHours}h target`;
  const embed=new EmbedBuilder().setColor(0x1a73e8).setTitle(`🏈 Regular Season Week ${week} Schedule`).setDescription(lines.join('\n─────────────────────\n')).setFooter({text:modeText}).setTimestamp();
  const sent=await ch.send({content:`@everyone — **Week ${week}** schedule is live! Get your games in within ${weekly.advanceHours} hours. 🏈`,embeds:[embed],allowedMentions:{parse:['everyone']}}).catch(()=>null);
  if (sent) { state.scheduleState.pinnedMsgId=sent.id; state.scheduleState.lastPosted=Date.now(); }
}

// V202 (BUG-002): one scheduler object owns BOTH the initial timeout and the recurring interval.
// Every start cancels any pending timeout/interval first; a monotonically increasing generation token
// makes an old callback a no-op if a newer generation was started while it was pending; a single-flight
// guard prevents an overlapping post if Discord is slow. Timers are wake-ups only — schedule authority is
// state.scheduleState (hydrated from scheduleRegistry) and the advance engine, never these handles.
const _scheduleTimers = new Map(); // guildId → { generation, initialTimerId, intervalId, inFlight, authority }

function _scheduleEntry(guildId) {
  if (!_scheduleTimers.has(guildId)) _scheduleTimers.set(guildId, { generation: 0, initialTimerId: null, intervalId: null, inFlight: false, authority: 'legacy-schedule-timer' });
  return _scheduleTimers.get(guildId);
}

function stopScheduleTimer(guild, state) {
  const entry = _scheduleEntry(guild?.id || 'default');
  entry.generation += 1;
  if (entry.initialTimerId) { clearTimeout(entry.initialTimerId); entry.initialTimerId = null; }
  if (entry.intervalId) { clearInterval(entry.intervalId); entry.intervalId = null; }
  if (state?.scheduleState) { state.scheduleState.timerId = null; state.scheduleState.initialTimerId = null; state.scheduleState.scheduleGeneration = entry.generation; }
  return entry.generation;
}

function getScheduleTimerStatus(guild) {
  const entry = _scheduleTimers.get(guild?.id || 'default');
  if (!entry) return { active: false, generation: 0, phase: 'idle' };
  return { active: !!(entry.initialTimerId || entry.intervalId), generation: entry.generation, phase: entry.intervalId ? 'recurring' : entry.initialTimerId ? 'pending-first-fire' : 'idle', inFlight: entry.inFlight, authority: entry.authority || 'legacy-schedule-timer' };
}

function startScheduleTimer(guild, state, getCh, getTeamEmoji) {
  const guildId = guild?.id || 'default';
  const generation = stopScheduleTimer(guild, state); // cancels pending timeout AND interval, bumps generation
  const entry = _scheduleEntry(guildId);
  const weekly = getWeeklySettings();
  if (weekly.mode !== 'automatic') {
    entry.authority = 'manual';
    log.info(`Schedule timer: manual mode enabled — no recurring repost timer started.`);
    return { started: false, generation, reason: 'manual-mode' };
  }

  // When the V202 advance policy has been explicitly configured, the advance engine owns the clock.
  // Week projection already posts the schedule after a provider-verified transition, so a second 48h
  // repost interval would create two independent clocks. Legacy mode is retained until a policy file exists.
  try {
    const policy = require('../league/automationPolicyService').getPolicy();
    if (policy?.source === 'policy-file' && policy.enabled) {
      entry.authority = 'advance-engine';
      log.info('Schedule timer: advance engine is authoritative — legacy recurring repost timer not armed.');
      return { started: false, generation, reason: 'advance-engine-authoritative', authority: 'advance-engine' };
    }
  } catch (err) {
    log.warn(`Schedule timer authority check failed; retaining legacy behavior: ${err.message}`);
  }
  entry.authority = 'legacy-schedule-timer';
  const tick = async () => {
    if (entry.generation !== generation) return;          // stale generation — a newer start superseded us
    if (entry.inFlight) { log.warn('Schedule timer: previous post still in flight — skipping this tick'); return; }
    entry.inFlight = true;
    try { await postScheduleEmbed(guild, state, getCh, getTeamEmoji); }
    catch (e) { log.warn(`Schedule timer post failed: ${e.message}`); }
    finally { entry.inFlight = false; }
  };
  const fire = async () => {
    entry.initialTimerId = null;
    if (entry.generation !== generation) return;
    await tick();
    if (entry.generation !== generation) return;
    entry.intervalId = setInterval(tick, getAdvanceMs());
    if (entry.intervalId?.unref) entry.intervalId.unref();
    state.scheduleState.timerId = entry.intervalId;
    state.scheduleState.initialTimerId = null;
  };
  const delay = msUntil7pmPST();
  log.info(`Schedule timer: automatic mode enabled (gen ${generation}). First fire in ${Math.round(delay/60000)}m, then every ${weekly.advanceHours}h.`);
  entry.initialTimerId = setTimeout(fire, delay);
  if (entry.initialTimerId?.unref) entry.initialTimerId.unref();
  state.scheduleState.initialTimerId = entry.initialTimerId;
  state.scheduleState.timerId = entry.initialTimerId; // ACTIVE from the moment it is armed (awareness/diagnostics)
  state.scheduleState.scheduleGeneration = generation;
  return { started: true, generation };
}

// ── NFL Updates ───────────────────────────────────────────────
async function postNFLUpdates(guild, getCh, aiCall, MODELS) {
  const ch = getCh(guild,'nflUpdates');
  if (!ch) { log.warn('#nfl-updates not resolved.'); return; }
  try {
    const res = await aiCall({
      model: MODELS.FAST,
      max_tokens: 600,
      system: `You are the NFL reporter for ${resolveServerName(guild, 'this server')}. Give 4-6 bullet points of NFL news relevant to Madden franchise players. Each bullet: emoji + bold team + 2 sentences. End with: "📲 Follow @brgridiron on Instagram for real-time NFL updates."`,
      messages: [{ role: 'user', content: 'Give me the latest NFL news digest for today.' }],
    });
    await ch.send({
      embeds: [new EmbedBuilder()
        .setColor(0x013369)
        .setTitle(`🏈 NFL Updates — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`)
        .setDescription(res.content[0].text.trim())
        .setFooter({ text: `Posted by ${resolveServerName(guild, 'this server')} Bot` })
        .setTimestamp()],
    });
  } catch (e) { log.error('NFL updates failed:', e.message); }
}

// ── Create League Structure ───────────────────────────────────
const STRUCTURE = [
  {category:'📢 ─── LEAGUE INFO ───',channels:['👋│welcome','📣│announcements','📖│rules','🟢│how-to-join','🏟│open-teams','🏗│teambuilder-imports','📋│wait-list','🧾│ea-gamertags']},
  {category:'🏈 ─── GAMEPLAY ───',channels:['💬│general','🏈│nfl-chat','📊│polls','⭐│player-of-the-week','📈│dev-upgrades','🎯│ability-resets','🏆│rewards','📊│stat-leaders','🏆│superbowl-history','📸│game-results']},
  {category:'🔁 ─── ROSTERS & TRADES ───',channels:['💰│trade-block','⏳│pending-trades','✅│accepted-trades','❌│declined-trades','🔄│transactions']},
  {category:'🗓 ─── SCHEDULING ───',channels:['📅│weekly-schedule','✅│active-check','👑│force-wins','⚖️│fair-sims']},
  {category:'🎥 ─── MEDIA ───',channels:['📺│livestreams','🎬│highlights','🏆│game-of-the-week','🌍│overseas-games','🌙│primetime-games']},
  {category:'🧠 ─── ADMIN HQ ───',channels:['🤖│commissioner-ai','🛠│admin-hq','📷│commish-hub','📋│scoresheets']},
  {category:'⚠️ ─── DISCIPLINE ───',channels:['🚨│warnings-log','🥾│boot-log']},
  {category:'🎮 ─── WEEK GAMES ───',channels:[]},
];

async function createLeagueStructure(guild, getCh, state, aiCall, MODELS) {
  const { findOrCreateCategory } = require('./baseInitService');
  for (const group of STRUCTURE) {
    // V198 FIX: Use findOrCreateCategory instead of raw guild.channels.create
    const cat = await findOrCreateCategory(guild, group.category);
    for (const name of group.channels) {
      if (guild.channels.cache.find(c=>c.name===name)) continue;
      const isAdmin=name.includes('commissioner-ai')||name.includes('admin-hq')||name.includes('commish-hub')||name.includes('scoresheets');
      const perms=isAdmin&&COMM_ROLE?[{id:guild.roles.everyone.id,deny:[PermissionsBitField.Flags.ViewChannel]},{id:COMM_ROLE,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages]}]:undefined;
      const bareName=name.includes('│')?name.split('│')[1].trim():name.trim();
      await guild.channels.create({name,type:ChannelType.GuildText,parent:cat.id,permissionOverwrites:perms}).catch(()=>null);
    }
  }
  const { refreshOpenTeamsBoard } = require('./openTeamsService');
  await refreshOpenTeamsBoard(guild);
  log.info('League structure created.');
}

module.exports = {
  runWeeklyRelease, resetHubWeek, startHubReleaseTimer,
  parseMatchupLines, postScheduleEmbed, startScheduleTimer, stopScheduleTimer, getScheduleTimerStatus,
  postNFLUpdates, createLeagueStructure,
};
