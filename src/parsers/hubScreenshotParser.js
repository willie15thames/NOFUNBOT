/*
 * NAVIGATION HEADER
 * FILE: src/parsers/hubScreenshotParser.js
 * LAYER: Parsing and transformation layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: See nearby files in the same folder for related behavior.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
// src/parsers/hubScreenshotParser.js
// Handles ALL commissioner screenshot drops — #commish-hub, #scoresheets, AND
// any channel where a commissioner @mentions the bot with an image attached.
//
// Supported screenshot types:
//   weekly_schedule  — Madden weekly schedule overview grid (team abbreviations)
//   full_schedule    — Madden full schedule list view (e.g. "Cowboys @ Eagles")
//   scoreboard       — Final score screen
//   stats            — Individual player stat screen
//   box_score        — Full box score
//   standings        — League standings table
//   unknown          — Not a Madden screen

const { EmbedBuilder, ChannelType } = require('discord.js');
const { makeLogger } = require('../utils/logger');
// V202: norm() no longer needed here — matchup identity is owned by league/canonicalModel via ensureGameChannel.
const { COMM_ROLE }  = require('../config/env');
const log = makeLogger('hubParser');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function isImage(a) {
  if (!a?.url) return false;
  if (a.contentType?.startsWith('image/')) return true;
  const url = a.url.toLowerCase().split('?')[0];
  return IMAGE_EXTS.has(url.slice(url.lastIndexOf('.')));
}
function mediaType(a) {
  const ct  = (a.contentType || '').split(';')[0].trim().toLowerCase();
  const url = a.url.toLowerCase().split('?')[0];
  if (ct.startsWith('image/')) return ct;
  if (url.endsWith('.png'))  return 'image/png';
  if (url.endsWith('.gif'))  return 'image/gif';
  if (url.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}
// SECURITY FIX (CIA-03): Only fetch from Discord CDN domains. Add 10s timeout.
const ALLOWED_FETCH_HOSTS = new Set([
  'cdn.discordapp.com', 'media.discordapp.net', 'attachments.discord.com',
  'images-ext-1.discordapp.net', 'images-ext-2.discordapp.net',
]);

function _validateAttachmentUrl(url) {
  try { const { safeUrl } = require('../utils/safeUrl'); const parsed = safeUrl(url); return !!parsed && ALLOWED_FETCH_HOSTS.has(parsed.hostname); } catch { return false; }
}

async function fetchBase64(url) {
  if (!_validateAttachmentUrl(url)) {
    const { safeUrl } = require('../utils/safeUrl'); const parsed = safeUrl(url); throw new Error(`SSRF_BLOCKED: fetchBase64 rejected non-CDN URL: ${parsed?.hostname || 'invalid-url'}`);
  }
  const lib = require('https');
  return new Promise((res, rej) => {
    const req = lib.get(url, r => {
      const c = [];
      r.on('data', d => c.push(d));
      r.on('end', () => res(Buffer.concat(c).toString('base64')));
      r.on('error', rej);
    });
    // BUG-08 FIX: timeout prevents indefinite hang on slow/unresponsive CDN
    req.setTimeout(10000, () => { req.destroy(new Error('fetchBase64 timeout after 10s')); });
    req.on('error', rej);
  });
}

// ── OCR prompt — understands all Madden 26 screen types ──────
const OCR_PROMPT = `You are reading a Madden NFL 26 franchise screenshot for a Discord league managed by CommishAI.

IMPORTANT: There are TWO types of schedule screens in Madden 26:

TYPE 1 — "Weekly Schedule" overview grid (shows team abbreviations like DAL, PHI, KC, LAC in a 2-column layout with "AT" between matchups):
- Extract all visible team abbreviation pairs as matchups
- Common abbreviations: DAL=Cowboys, PHI=Eagles, KC=Chiefs, LAC=Chargers, NYG=Giants, WAS=Commanders, CIN=Bengals, CLE=Browns, PIT=Steelers, NYJ=Jets, TB=Buccaneers, ATL=Falcons, CAR=Panthers, JAX=Jaguars, TEN=Titans, DEN=Broncos, HOU=Texans, LAR=Rams, BAL=Ravens, BUF=Bills, MIA=Dolphins, IND=Colts, AZ=Cardinals, NO=Saints, SF=49ers, SEA=Seahawks, DET=Lions, GB=Packers, MIN=Vikings, CHI=Bears, LV=Raiders, NE=Patriots
- Return type: "weekly_schedule"

TYPE 2 — Full schedule list (shows "Team @ Team" matchups with game times like "Thu 8:20 PM", "Sun 1:00 PM"):
- Extract all matchup rows in "Team1 @ Team2" format
- Use the full team name from the matchup column
- Return type: "weekly_schedule" (same type, different format — still schedule data)

OTHER TYPES:
- Scoreboard showing final score: type "scoreboard"
- Player stat screen: type "stats"  
- Box score breakdown: type "box_score"
- League standings table: type "standings"
- Not Madden at all: type "unknown"

Return ONLY raw JSON with NO markdown, no explanation, no backticks:
{
  "type": "weekly_schedule|scoreboard|stats|box_score|standings|unknown",
  "week": null,
  "weeklySchedule": [
    {"team1": "full team name or abbr", "team2": "full team name or abbr", "isPrimetime": false, "isGotw": false, "isOverseas": false}
  ],
  "scores": [{"team1":"","score1":0,"team2":"","score2":0,"winner":""}],
  "statLines": [{"player":"","team":"","stat":"passing|rushing|receiving|defense|kicking|other","value":""}],
  "standings": [{"rank":0,"team":"","wins":0,"losses":0}],
  "notes": null
}

For schedule screens: isPrimetime=true if game time is Thursday/Sunday Night/Monday Night. Extract EVERY matchup visible.`;

// ── Abbreviation → full team name resolver ────────────────────
const ABBR_MAP = {
  DAL:'Cowboys', PHI:'Eagles', KC:'Chiefs', LAC:'Chargers',
  NYG:'Giants', WAS:'Commanders', CIN:'Bengals', CLE:'Browns',
  PIT:'Steelers', NYJ:'Jets', TB:'Buccaneers', ATL:'Falcons',
  CAR:'Panthers', JAX:'Jaguars', TEN:'Titans', DEN:'Broncos',
  HOU:'Texans', LAR:'Rams', BAL:'Ravens', BUF:'Bills',
  MIA:'Dolphins', IND:'Colts', AZ:'Cardinals', NO:'Saints',
  SF:'49ers', SEA:'Seahawks', DET:'Lions', GB:'Packers',
  MIN:'Vikings', CHI:'Bears', LV:'Raiders', NE:'Patriots',
};
function expandAbbr(name) {
  if (!name) return name;
  const upper = name.trim().toUpperCase();
  return ABBR_MAP[upper] || name.trim();
}

/**
 * Main handler — called for:
 *   1. Any message in #commish-hub (commissioner only)
 *   2. Any commissioner message anywhere that has an image + bot mention
 */
async function handleCommishHubScreenshot(message, { getCh, state, aiCall, MODELS, isAdminMember, COMM_ROLE: commRole }) {
  const guild    = message.guild;
  const hubCh    = getCh(guild, 'commishHub');
  const scoresCh = getCh(guild, 'scoresheets');

  const inHub    = hubCh    && message.channel.id === hubCh.id;
  const inScores = scoresCh && message.channel.id === scoresCh.id;

  // Must be in hub/scoresheets, OR commissioner @mentioning bot with an image anywhere
  if (!inHub && !inScores) return false;
  if (!isAdminMember(message.member)) return false;

  const img = message.attachments.find(a => isImage(a));
  if (!img) return false;

  // Week check — but for schedule screenshots we can auto-detect/set week
  // Don't block on missing week for schedule screens
  await message.react('🔍').catch(() => null);

  let base64, mType;
  try {
    base64 = await fetchBase64(img.url);
    mType  = mediaType(img);
  } catch (e) {
    log.error('Image fetch failed:', e.message);
    await message.react('❌').catch(() => null);
    await message.reply('❌ Could not download that image. Try re-uploading.').catch(() => null);
    return true;
  }

  let parsed;
  try {
    const res = await aiCall({
      model: MODELS.SMART,
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mType, data: base64 } },
          { type: 'text',  text: OCR_PROMPT },
        ],
      }],
    });
    const raw = res.content[0].text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
    parsed = JSON.parse(raw);
  } catch (e) {
    log.error('OCR failed:', e.message);
    await message.reactions.removeAll().catch(() => null);
    await message.react('❓').catch(() => null);
    await message.reply("⚠️ Couldn't read that screenshot. Try a cleaner photo or different angle.").catch(() => null);
    return true;
  }

  if (!parsed || parsed.type === 'unknown') {
    await message.reactions.removeAll().catch(() => null);
    await message.react('❓').catch(() => null);
    await message.reply("That doesn't look like a Madden screen. Try a scoreboard, schedule, or stat screen.").catch(() => null);
    return true;
  }

  const stored = [];

  // ── SCHEDULE SCREENSHOT → AUTO-CREATE GAME CHANNELS ─────────
  if (parsed.type === 'weekly_schedule' && parsed.weeklySchedule?.length) {
    // V202 (BUG-004): structured find-or-create with resolved team owners — never pass null owners and count success.
    const { ensureGameChannel } = require('../services/gameChannelService');
    const { getTeamDataByAnyName } = require('../utils/teamUtils');

    // Auto-detect or use stored week
    const schedWeek = parsed.week || state.hubWeeklyData.week || state.scheduleState.week;
    if (!schedWeek) {
      await message.reactions.removeAll().catch(() => null);
      await message.react('⚠️').catch(() => null);
      await message.reply('⚠️ Week number not detected. Run `/set-hub-week` first, then re-upload the schedule.').catch(() => null);
      return true;
    }
    if (schedWeek && !state.hubWeeklyData.week) state.hubWeeklyData.week = schedWeek;

    let created = 0, skipped = 0, failed = 0, held = 0;
    for (const m of parsed.weeklySchedule) {
      if (!m.team1 || !m.team2) continue;

      // Expand abbreviations to full names
      const t1 = expandAbbr(m.team1);
      const t2 = expandAbbr(m.team2);

      // Resolve owners from the canonical player registry (league scope, base + display aliases)
      const owner1 = getTeamDataByAnyName(t1, state.players)?.userId || null;
      const owner2 = getTeamDataByAnyName(t2, state.players)?.userId || null;

      try {
        const result = await ensureGameChannel(guild, {
          week: schedWeek, team1: t1, team2: t2, user1Id: owner1, user2Id: owner2,
          isPrimetime: !!m.isPrimetime, isGotw: !!m.isGotw, isOverseas: !!m.isOverseas,
          game: state.leagueConfig?.game, leagueTag: state.leagueConfig?.leagueName,
        });
        const tag = m.isPrimetime ? ' 🌟' : m.isGotw ? ' 🏆' : m.isOverseas ? ' 🌍' : '';
        if (result.ok && result.created) {
          created++;
          stored.push(`📺 **${t1} vs ${t2}**${tag}`);
          // Small delay to avoid rate limits
          await new Promise(r => setTimeout(r, 400));
        } else if (result.ok) {
          skipped++;
        } else if (result.reason === 'missing-owner') {
          held++;
          stored.push(`⏸ **${t1} vs ${t2}** — HOLD: no owner assigned for ${result.missing.join(', ')}`);
        } else if (result.reason === 'cpu-or-bye') {
          skipped++;
        } else {
          failed++;
          stored.push(`⚠️ Failed: ${t1} vs ${t2} — ${result.reason}${result.error ? ` (${result.error})` : ''}`);
          log.error(`Channel create failed ${t1} vs ${t2}: ${result.reason}`);
        }
      } catch (e) {
        failed++;
        stored.push(`⚠️ Failed: ${t1} vs ${t2} — ${e.message}`);
        log.error(`Channel create failed ${t1} vs ${t2}:`, e.message);
      }
    }

    await message.reactions.removeAll().catch(() => null);
    await message.react('✅').catch(() => null);

    const summary = stored.length ? stored.slice(0, 16).join('\n') : 'No new matchups found.';
    await message.reply({
      embeds: [new EmbedBuilder()
        .setColor(created > 0 ? 0x2ecc71 : 0xf39c12)
        .setTitle(`📅 Week ${schedWeek} Schedule Processed`)
        .setDescription(summary + (stored.length > 16 ? `\n...and ${stored.length - 16} more` : ''))
        .addFields(
          { name: '✅ Created',  value: String(created),  inline: true },
          { name: '⏭ Skipped',  value: String(skipped),  inline: true },
          { name: '⏸ Held (no owner)', value: String(held), inline: true },
          { name: '❌ Failed',   value: String(failed),   inline: true },
        )
        .setFooter({ text: `${parsed.weeklySchedule.length} matchups found in screenshot • Week ${schedWeek}${held ? ' • assign held teams with /teams assign, then re-upload' : ''}` })
        .setTimestamp()],
    }).catch(() => null);

    return true;
  }

  // ── STATS / SCORES ───────────────────────────────────────────
  if (!state.hubWeeklyData.week) {
    await message.reactions.removeAll().catch(() => null);
    await message.react('⚠️').catch(() => null);
    await message.reply('⚠️ No week set — use `/set-hub-week` first before dropping stat/score screenshots.').catch(() => null);
    return true;
  }

  // Fraud detection for score/stat duplicates
  const normT = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const fraudFlags = [];
  for (const s of (parsed.scores || [])) {
    if (!s.team1 || !s.team2) continue;
    const mk  = [parsed.week, normT(s.team1), normT(s.team2)].join(':');
    const dup = state.ocrGameResults.find(r => {
      const rk  = [r.week, normT(r.team1), normT(r.team2)].join(':');
      const rkf = [r.week, normT(r.team2), normT(r.team1)].join(':');
      return rk === mk || rkf === mk;
    });
    if (dup) fraudFlags.push(`⚠️ DUPLICATE: **${s.team1} vs ${s.team2}** Week ${parsed.week} already recorded (${dup.score1}–${dup.score2})`);
    const cur = parsed.week || state.hubWeeklyData.week;
    if (cur && parsed.week && parsed.week < cur - 2)
      fraudFlags.push(`⚠️ OLD DATA: Week ${parsed.week} uploaded but current week is ${cur}`);
  }
  for (const sl of (parsed.statLines || [])) {
    if (!sl.player) continue;
    const dup = state.leagueMemory.statLines?.find(m =>
      m.player?.toLowerCase() === sl.player?.toLowerCase() &&
      m.week === (parsed.week || state.hubWeeklyData.week)
    );
    if (dup) fraudFlags.push(`⚠️ DUPLICATE STAT: **${sl.player}** Week ${parsed.week || state.hubWeeklyData.week} already recorded`);
  }
  if (fraudFlags.length) {
    const warnCh = getCh(guild, 'warningsLog') || getCh(guild, 'adminHq');
    if (warnCh) await warnCh.send({
      content: commRole ? `<@&${commRole}> 🚨 STAT FRAUD ALERT` : '🚨 STAT FRAUD ALERT',
      embeds: [new EmbedBuilder().setColor(0xff0000).setTitle('🚨 Suspicious Screenshot — Review Required')
        .setDescription(fraudFlags.join('\n'))
        .addFields(
          { name: 'Uploaded by', value: `${message.author}`, inline: true },
          { name: 'Channel',     value: `${message.channel}`, inline: true },
        ).setTimestamp()],
      allowedMentions: commRole ? { roles: [commRole] } : {},
    }).catch(() => null);
    await message.react('🚨').catch(() => null);
  }

  // Set week from screenshot if not already set
  if (parsed.week && !state.hubWeeklyData.week) state.hubWeeklyData.week = parsed.week;

  // Ingest into stat pipeline
  const statLeaders = require('../services/statLeaderService');
  if (parsed.scores?.length || parsed.statLines?.length) {
    statLeaders.ingestStatLines(parsed.statLines || [], parsed.scores || []);
    for (const s of (parsed.scores || []))
      if (s.team1 && s.team2) stored.push(`📊 Score: **${s.team1} ${s.score1 ?? '?'} — ${s.score2 ?? '?'} ${s.team2}**`);
    for (const sl of (parsed.statLines || []))
      if (sl.player) stored.push(`📈 **${sl.player}** (${sl.team}) — ${sl.value}`);
  }
  if (parsed.standings?.length) {
    state.hubWeeklyData.standings = parsed.standings;
    stored.push(`🏆 Standings: ${parsed.standings.length} teams captured`);
  }

  await message.reactions.removeAll().catch(() => null);
  await message.react('✅').catch(() => null);

  const summary = stored.length ? stored.slice(0, 10).join('\n') : 'Data captured — no structured content found.';
  await message.reply({
    embeds: [new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`✅ ${parsed.type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())} Logged — Week ${state.hubWeeklyData.week || '?'}`)
      .setDescription(summary + (stored.length > 10 ? `\n...and ${stored.length - 10} more` : ''))
      .setFooter({ text: `${state.hubWeeklyData.scores.length} scores • ${state.hubWeeklyData.statLines.length} stat lines • Releases at 6:59pm PST` })
      .setTimestamp()],
  }).catch(() => null);

  return true;
}

/**
 * handleAnywhereSchedule — called when a commissioner @mentions the bot
 * with an image attached outside of #commish-hub.
 * Only triggers for schedule screenshots — routes to channel creation.
 */
async function handleAnywhereSchedule(message, deps) {
  const { isAdminMember, COMM_ROLE: commRole, getCh, state, aiCall, MODELS } = deps;
  if (!isAdminMember(message.member)) return false;

  const img = message.attachments.find(a => isImage(a));
  if (!img) return false;

  // Re-use the same handler — just forward it as if it came from commish-hub
  // We pass it through handleCommishHubScreenshot but override the channel check
  // by temporarily routing to the image processing logic directly
  await message.react('🔍').catch(() => null);

  let base64, mType;
  try {
    base64 = await fetchBase64(img.url);
    mType  = mediaType(img);
  } catch (e) {
    await message.react('❌').catch(() => null);
    return true;
  }

  let parsed;
  try {
    const res = await aiCall({
      model: MODELS.SMART, max_tokens: 1200,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mType, data: base64 } },
        { type: 'text',  text: OCR_PROMPT },
      ]}],
    });
    const raw = res.content[0].text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
    parsed = JSON.parse(raw);
  } catch (e) {
    await message.reactions.removeAll().catch(() => null);
    await message.react('❓').catch(() => null);
    return true;
  }

  if (!parsed || parsed.type === 'unknown' || parsed.type !== 'weekly_schedule') {
    await message.reactions.removeAll().catch(() => null);
    await message.react('❓').catch(() => null);
    await message.reply("Can't read that. For schedules, drop it in **#commish-hub**. For stats/scores too.").catch(() => null);
    return true;
  }

  // It's a schedule — create channels (V202: structured find-or-create with resolved owners)
  const { ensureGameChannel } = require('../services/gameChannelService');
  const { getTeamDataByAnyName } = require('../utils/teamUtils');
  const schedWeek = parsed.week || state.hubWeeklyData.week || state.scheduleState.week;
  if (!schedWeek) {
    await message.reactions.removeAll().catch(() => null);
    await message.reply('⚠️ Week not set — run `/set-hub-week` first then re-upload.').catch(() => null);
    return true;
  }

  const stored = [];
  let created = 0, skipped = 0, held = 0, failed = 0;
  for (const m of (parsed.weeklySchedule || [])) {
    if (!m.team1 || !m.team2) continue;
    const t1 = expandAbbr(m.team1), t2 = expandAbbr(m.team2);
    const owner1 = getTeamDataByAnyName(t1, state.players)?.userId || null;
    const owner2 = getTeamDataByAnyName(t2, state.players)?.userId || null;
    try {
      const result = await ensureGameChannel(message.guild, {
        week: schedWeek, team1: t1, team2: t2, user1Id: owner1, user2Id: owner2,
        isPrimetime: !!m.isPrimetime, isGotw: !!m.isGotw, isOverseas: !!m.isOverseas,
        game: state.leagueConfig?.game, leagueTag: state.leagueConfig?.leagueName,
      });
      if (result.ok && result.created) {
        created++;
        stored.push(`📺 **${t1} vs ${t2}**`);
        await new Promise(r => setTimeout(r, 400));
      } else if (result.ok || result.reason === 'cpu-or-bye') {
        skipped++;
      } else if (result.reason === 'missing-owner') {
        held++;
        stored.push(`⏸ **${t1} vs ${t2}** — HOLD: no owner for ${result.missing.join(', ')}`);
      } else {
        failed++;
        stored.push(`⚠️ ${t1} vs ${t2} — ${result.reason}`);
      }
    } catch (e) {
      failed++;
      stored.push(`⚠️ ${t1} vs ${t2} — ${e.message}`);
    }
  }

  await message.reactions.removeAll().catch(() => null);
  await message.react('✅').catch(() => null);
  await message.reply({
    embeds: [new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`📅 Week ${schedWeek} — Game Channels Created`)
      .setDescription(stored.slice(0, 16).join('\n') || 'No new matchups.')
      .addFields(
        { name: '✅ Created', value: String(created), inline: true },
        { name: '⏭ Skipped', value: String(skipped), inline: true },
        { name: '⏸ Held (no owner)', value: String(held), inline: true },
        { name: '❌ Failed', value: String(failed), inline: true },
      )
      .setTimestamp()],
  }).catch(() => null);
  return true;
}

module.exports = { handleCommishHubScreenshot, handleAnywhereSchedule };