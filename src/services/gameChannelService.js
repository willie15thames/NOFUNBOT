/*
 * NAVIGATION HEADER
 * FILE: src/services/gameChannelService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 * V202: createGameChannel is now idempotent (find-or-create on a stable matchup key), returns a structured
 *       result via ensureGameChannel(), persists sessions through league/gameSessionService, and re-arms
 *       reminder/deadline handling after restart (armReminders). Legacy createGameChannel signature preserved.
 */

// src/services/gameChannelService.js
'use strict';
const { EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const loggerConfigService = require('./loggerConfigService');
const gameSessions = require('../league/gameSessionService');
const { matchupKey: buildMatchupKey, normalizeTeam } = require('../league/canonicalModel');
const { makeLogger } = require('../utils/logger');
const log = makeLogger('gameChannel');

const SEVEN_HOURS       = 7  * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const TWO_HOURS_MS      = 2  * 60 * 60 * 1000;
const SEARCH_WORD_RX    = /\bsearch(ing)?\b/i;
const GAME_START_RX     = /\b(invite sent|send invite|sending invite|sent invite|game invite|match invite|invite out|invite otw|inv sent|start(ing)? now|about to start|match is starting|game is starting|booting up|loading in|we'?re starting|we are starting|running it now|joining now|loading up|starting up)\b/i;
const CANCEL_WORDS_RX   = /\b(cancel|postpone|reschedul|not tonight|another night|can't tonight|cant tonight|not now|hold on|wait|brb|not yet|give me a min|one sec)\b/i;
const gameSearchState   = new Map();

let _services = null;
function init(services) { _services = services; }

function _cleanChannelPart(s){ return (s||'').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,18); }
function _weeklyGamesCategoryName(gameKey){
  const k = String(gameKey||'madden').toLowerCase();
  if (k.includes('nba') || k.includes('2k')) return '🎮 ─── WEEKLY GAMES — NBA 2K ───';
  if (k.includes('ncaa')) return '🎮 ─── WEEKLY GAMES — NCAA ───';
  return '🎮 ─── WEEKLY GAMES — MADDEN ───';
}

function _buildSearchRulesEmbed(game) {
  const sport = String(game?.gameKey || 'madden').toLowerCase();
  const leagueTag = game?.leagueTag ? ` • ${game.leagueTag}` : '';
  const titleSport = sport.includes('2k') || sport.includes('nba') ? 'NBA 2K' : sport.includes('ncaa') ? 'NCAA' : 'MADDEN';

  return new EmbedBuilder()
    .setColor(0x1a73e8)
    .setTitle(`🔎 Search Activated — ${titleSport}${leagueTag}`)
    .setDescription(`Use this channel to lock in your matchup. Saying **search** tells the bot you're actively trying to schedule and starts the game-search timer.`)
    .addFields(
      {
        name: 'Game Rules While Searching',
        value:
          '• Reach out and respond promptly in this channel.\n' +
          '• Use `/respond` here once you acknowledge the matchup.\n' +
          '• Be clear about your availability and timezone.\n' +
          '• Use `/report-result` when the game is done.\n' +
          '• If you need to pause scheduling, say something like **cancel**, **postpone**, or **not tonight**.'
      },
      {
        name: 'Timer / Enforcement',
        value:
          '• Search starts the active scheduling window.\n' +
          '• If the search stays active and the channel goes unresolved for too long, the bot may clean up the channel automatically.\n' +
          '• Both no-show = Fair Sim. One no-show = Force Loss.'
      }
    )
    .setFooter({ text: 'Only weekly game channels use this search trigger.' })
    .setTimestamp();
}

function _buildGameStartEmbed(game) {
  const sport = String(game?.gameKey || 'madden').toLowerCase();
  const leagueTag = game?.leagueTag ? ` • ${game.leagueTag}` : '';
  const titleSport = sport.includes('2k') || sport.includes('nba') ? 'NBA 2K' : sport.includes('ncaa') ? 'NCAA' : 'MADDEN';

  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`🎮 Game Starting — ${titleSport}${leagueTag}`)
    .setDescription('The bot detected that the invite is out or the game is about to begin. Finish the matchup and use `/report-result` when you are done.')
    .addFields({ name: 'Checklist', value: '• Confirm both players are in\n• Play the game\n• Post results when done\n• If something falls apart, explain it here immediately' })
    .setFooter({ text: 'Invite/game-start phrases refresh the active game timer.' })
    .setTimestamp();
}

function _gameChannelName(leagueTag, week, team1, team2) {
  return `${leagueTag ? leagueTag + '-' : ''}w${week}-${_cleanChannelPart(team1)}-vs-${_cleanChannelPart(team2)}`;
}

/** Find a live in-memory game for the same week + teams (order-independent). */
function _findLiveGame(state, week, team1, team2, leagueId) {
  const a = normalizeTeam(team1), b = normalizeTeam(team2);
  for (const [channelId, g] of state.games.entries()) {
    if (g.finished) continue;
    if (String(g.leagueId || 'default') !== String(leagueId || 'default')) continue;
    if (Number(g.week) !== Number(week)) continue;
    const ga = normalizeTeam(g.team1), gb = normalizeTeam(g.team2);
    if ((ga === a && gb === b) || (ga === b && gb === a)) return { channelId, game: g };
  }
  return null;
}

/**
 * V202 (BUG-003 / spec §18): idempotent, structured game-channel creation.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} gameData  { week, team1|homeTeamName, team2|awayTeamName, user1Id|homeUserId, user2Id|awayUserId,
 *                             isPrimetime, isGotw, isOverseas, game, leagueTag, leagueId, provider, seasonId,
 *                             allowPendingOwners }
 * @returns {Promise<{ok:true, created:boolean, channel:object, matchupKey:string}|{ok:false, reason:string, missing?:string[], matchupKey?:string|null}>}
 *
 * Reasons: 'invalid-teams' | 'cpu-or-bye' | 'missing-owner' | 'same-owner' | 'category-unavailable' | 'create-failed'
 * Never returns null. Never counts as created when an existing managed channel is reused (created:false).
 */
async function ensureGameChannel(guild, gameData = {}) {
  const { state, getCh } = _services;
  const week = Number(gameData.week);
  const team1 = String(gameData.team1 || gameData.homeTeamName || '').trim();
  const team2 = String(gameData.team2 || gameData.awayTeamName || '').trim();
  const user1Id = gameData.user1Id || gameData.homeUserId || null;
  const user2Id = gameData.user2Id || gameData.awayUserId || null;
  const isPrimetime = !!gameData.isPrimetime, isGotw = !!gameData.isGotw, isOverseas = !!gameData.isOverseas;

  if (!team1 || !team2 || !Number.isFinite(week)) return { ok: false, reason: 'invalid-teams', matchupKey: null };
  if (/\b(cpu|bye)\b/i.test(team1) || /\b(cpu|bye)\b/i.test(team2)) return { ok: false, reason: 'cpu-or-bye', matchupKey: null };

  const gameKey = gameData.game || state?.leagueConfig?.game || 'madden';
  const leagueTag = _cleanChannelPart(gameData.leagueTag || state?.leagueConfig?.leagueName || '');
  const identity = {
    leagueId: gameData.leagueId || require('../league/spaceContext').current() || state?.leagueConfig?.leagueName || 'default',
    provider: gameData.provider || 'local',
    seasonId: gameData.seasonId || 'current',
  };
  const key = buildMatchupKey({ ...identity, week, teamA: team1, teamB: team2 });

  // ── Find-or-create step 1: live in-memory session ──
  const live = _findLiveGame(state, week, team1, team2, identity.leagueId);
  if (live) {
    const ch = guild.channels.cache.get(live.channelId);
    if (ch) return { ok: true, created: false, channel: ch, matchupKey: live.game.matchupKey || key };
  }
  // ── Step 2: durable session record (survives restart) ──
  const durable = gameSessions.findByMatchupKey(key);
  if (durable && durable.status === gameSessions.SESSION_STATUS.ACTIVE) {
    const ch = guild.channels.cache.get(durable.channelId);
    if (ch) {
      if (!state.games.has(ch.id)) gameSessions.rehydrate(guild, state, armReminders);
      return { ok: true, created: false, channel: ch, matchupKey: key };
    }
  }
  // ── Step 3: an unmanaged channel with the deterministic name under the weekly games category ──
  const chName = _gameChannelName(require('../league/spaceContext').current()?.slice(0,8) || leagueTag, week, team1, team2);
  const catName = _weeklyGamesCategoryName(gameKey);
  const existingNamed = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === chName && c.parent && /WEEK(LY)? GAMES/.test(String(c.parent.name || '')));
  // Owner policy is evaluated AFTER reuse checks so an existing channel is never duplicated because of a missing owner.
  const missing = [!user1Id ? team1 : null, !user2Id ? team2 : null].filter(Boolean);
  if (missing.length && !gameData.allowPendingOwners) {
    if (existingNamed) return { ok: true, created: false, channel: existingNamed, matchupKey: key };
    return { ok: false, reason: 'missing-owner', missing, matchupKey: key };
  }
  if (user1Id && user2Id && String(user1Id) === String(user2Id)) return { ok: false, reason: 'same-owner', matchupKey: key };

  const baseGame = { week, team1, team2, user1Id, user2Id, isPrimetime, isGotw, isOverseas, responded: new Set(), reminderCount: 0, finished: false, createdAt: Date.now(), reminderId: null, score: null, gameKey, leagueTag, matchupKey: key, ...identity };
  if (existingNamed) {
    state.games.set(existingNamed.id, baseGame);
    gameSessions.registerSession(existingNamed.id, baseGame, { ...identity, matchupKey: key, guildId: guild.id });
    armReminders(guild, existingNamed.id, baseGame);
    log.info(`adopted existing channel #${existingNamed.name} for ${key}`);
    return { ok: true, created: false, channel: existingNamed, matchupKey: key };
  }

  // V198 FIX: Use findOrCreateCategory instead of raw guild.channels.create
  const { findOrCreateCategory } = require('./baseInitService');
  const cat = await findOrCreateCategory(guild, catName).catch(() => null);
  if (!cat) return { ok: false, reason: 'category-unavailable', matchupKey: key };

  const overwrites = [
    { id:guild.roles.everyone.id, deny:[PermissionFlagsBits.ViewChannel] },
    { id:guild.members.me.id,     allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels] },
  ];
  if (user1Id) overwrites.push({ id:user1Id, allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory] });
  if (user2Id) overwrites.push({ id:user2Id, allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory] });

  let channel;
  try {
    channel = await guild.channels.create({ name:chName, type:ChannelType.GuildText, parent:cat.id, permissionOverwrites:overwrites });
  } catch (e) {
    log.error(`create failed for ${key}: ${e.message}`);
    return { ok: false, reason: 'create-failed', error: e.message, matchupKey: key };
  }

  // Race-safe double check: a parallel call may have created the same matchup while we awaited Discord.
  const raceLive = _findLiveGame(state, week, team1, team2, identity.leagueId);
  if (raceLive && raceLive.channelId !== channel.id) {
    await channel.delete('V202 race-safe: duplicate game channel removed').catch(() => null);
    const winner = guild.channels.cache.get(raceLive.channelId);
    if (winner) return { ok: true, created: false, channel: winner, matchupKey: key };
  }

  const u1 = user1Id ? `<@${user1Id}>` : `**${team1}** (owner TBD)`;
  const u2 = user2Id ? `<@${user2Id}>` : `**${team2}** (owner TBD)`;
  state.games.set(channel.id, baseGame);
  gameSessions.registerSession(channel.id, baseGame, { ...identity, matchupKey: key, guildId: guild.id });
  const mentionIds = [user1Id, user2Id].filter(Boolean);
  const pendingNote = missing.length ? `\n⚠️ Pending owner: ${missing.join(', ')} — the commissioner must assign the team before the deadline applies.` : '';
  await channel.send({ content:mentionIds.map(id => `<@${id}>`).join(' ') || undefined, embeds:[new EmbedBuilder()
    .setColor(isPrimetime||isGotw?0xffd700:isOverseas?0x00b4d8:0x1a73e8).setTitle(`🏈 Week ${week} — ${team1} vs ${team2}`)
    .addFields(
      {name:'🏠 Home',value:`**${team1}**\n${u1}`,inline:true},
      {name:'✈️ Away',value:`**${team2}**\n${u2}`,inline:true},
      {name:'📋 Instructions',value:'1. Schedule within **24 hours**\n2. Run `/respond` here\n3. Use `/report-result` when done\n4. Say "search" when looking for a game' + pendingNote}
    )
    .setFooter({text:'Both no-show = Fair Sim. One no-show = Force Loss.'}).setTimestamp()],
    allowedMentions:{users:mentionIds, roles:[], parse:[]}
  }).catch(e => log.warn(`intro post failed for #${channel.name}: ${e.message}`));
  const spotlightKey = isOverseas?'overseasGames':isGotw?'gotwChannel':isPrimetime?'primetimeGames':null;
  if (spotlightKey) {
    const spotCh = getCh(guild,spotlightKey);
    if (spotCh) {
      const label = isOverseas?'🌍 OVERSEAS GAME':isGotw?'🏆 GAME OF THE WEEK':'🌟 PRIMETIME MATCHUP';
      await spotCh.send({ content:mentionIds.map(id => `<@${id}>`).join(' ') || undefined, embeds:[new EmbedBuilder().setColor(isGotw?0xff6b00:isOverseas?0x00b4d8:0xffd700).setTitle(`${label} — WEEK ${week}`)
        .addFields(
          {name:'🏠 Home',value:`**${team1}**\n${u1}`,inline:true},
          {name:'✈️ Away',value:`**${team2}**\n${u2}`,inline:true},
          {name:'📺 Streaming',value:isPrimetime||isGotw?'**Required** — post in #livestreams before halftime':'Encouraged',inline:false},
          {name:'🎮 Channel',value:`${channel}`,inline:false}
        ).setTimestamp()],
        allowedMentions:{users:mentionIds, roles:[], parse:[]} }).catch(()=>null);
    }
  }
  armReminders(guild, channel.id, baseGame);
  await loggerConfigService.logToConfiguredChannel(guild, `🧩 Game channel created: #${channel.name} | Week ${week} | ${team1} vs ${team2}`);
  return { ok: true, created: true, channel, matchupKey: key };
}

/**
 * LEGACY SIGNATURE (compatibility wrapper — V202). Existing callers keep receiving a channel or null.
 * New code should call ensureGameChannel() and inspect the structured result.
 */
async function createGameChannel(guild, week, team1, user1, team2, user2, isPrimetime=false, isGotw=false, isOverseas=false, meta={}) {
  const result = await ensureGameChannel(guild, {
    week, team1, team2,
    user1Id: user1?.id || null, user2Id: user2?.id || null,
    isPrimetime, isGotw, isOverseas,
    game: meta.game, leagueTag: meta.leagueTag, leagueId: meta.leagueId, provider: meta.provider, seasonId: meta.seasonId,
    allowPendingOwners: !!meta.allowPendingOwners,
  });
  if (!result.ok) {
    log.info(`createGameChannel skipped week=${week} ${team1} vs ${team2} reason=${result.reason}${result.missing ? ' missing=' + result.missing.join(',') : ''}`);
    return null;
  }
  return result.channel;
}

/**
 * V202: restart-safe reminder/deadline arming. Uses a timeout chain aligned to createdAt so a rehydrated
 * session fires its next reminder at the correct wall-clock time instead of 7h after the restart.
 * Timer handles are process-local wake-ups only; createdAt/deadline intent lives in gameSessionService.
 */
function armReminders(guild, channelId, gameData) {
  const user1Id = gameData.user1Id, user2Id = gameData.user2Id;
  if (gameData.reminderId) { clearTimeout(gameData.reminderId); gameData.reminderId = null; }
  const scheduleNext = () => {
    if (gameData.finished) return;
    const elapsed = Date.now() - Number(gameData.createdAt || Date.now());
    const untilDeadline = TWENTY_FOUR_HOURS - elapsed;
    let delay;
    if (untilDeadline <= 0) delay = 5000;                                   // deadline already passed (restart after 24h)
    else delay = Math.min(untilDeadline, SEVEN_HOURS - (elapsed % SEVEN_HOURS)); // next 7h boundary, never past the deadline
    const id = setTimeout(async () => {
      try {
        if (gameData.finished) return;
        const channel = guild.channels.cache.get(channelId);
        if (!channel) { gameSessions.markDeleted(channelId); return; }
        const now = Date.now() - Number(gameData.createdAt || 0);
        if (now >= TWENTY_FOUR_HOURS) { await _handleDeadlineExpired(guild, channelId, gameData, user1Id, user2Id); return; }
        const pending=[user1Id&&!gameData.responded.has(user1Id)?`<@${user1Id}>`:null,user2Id&&!gameData.responded.has(user2Id)?`<@${user2Id}>`:null].filter(Boolean);
        if (!pending.length) return;
        gameData.reminderCount++;
        const h=Math.ceil((TWENTY_FOUR_HOURS-now)/3600000);
        await channel.send({ content:pending.join(' '), embeds:[new EmbedBuilder().setColor(h<=7?0xdc3545:0xff6b35).setTitle(`⏰ Reminder #${gameData.reminderCount}`)
          .setDescription(`~**${h} hour${h!==1?'s':''}** left. Run /respond here.`).setFooter({text:`${gameData.team1} vs ${gameData.team2} — Week ${gameData.week}`}).setTimestamp()] }).catch(()=>null);
        scheduleNext();
      } catch (e) { log.warn(`reminder tick failed for ${channelId}: ${e.message}`); scheduleNext(); }
    }, delay);
    if (typeof id.unref === 'function') id.unref();
    gameData.reminderId = id;
  };
  scheduleNext();
}

async function _handleDeadlineExpired(guild, channelId, gameData, user1Id, user2Id) {
  const { state, getCh } = _services;
  const { COMM_ROLE } = require('../config/env');
  const channel=guild.channels.cache.get(channelId), forceWinCh=getCh(guild,'forceLoss'), fairSimCh=getCh(guild,'fairSim'), warnCh=getCh(guild,'warningsLog');
  const u1Done=user1Id?gameData.responded.has(user1Id):true, u2Done=user2Id?gameData.responded.has(user2Id):true;
  if (!u1Done&&!u2Done) {
    const e=new EmbedBuilder().setColor(0x6c757d).setTitle('⚖️ FAIR SIM — Neither Responded').setDescription(`**${gameData.team1} vs ${gameData.team2} — Week ${gameData.week}**`)
      .addFields({name:'Team 1',value:`${user1Id?`<@${user1Id}>`:'TBD'} — ${gameData.team1}`,inline:true},{name:'Team 2',value:`${user2Id?`<@${user2Id}>`:'TBD'} — ${gameData.team2}`,inline:true}).setTimestamp();
    if (channel) await channel.send({embeds:[e]}).catch(()=>null);
    if (fairSimCh) await fairSimCh.send({embeds:[e]}).catch(()=>null);
    if (user1Id) await _issueInactivityWarning(guild,user1Id,gameData.team1,warnCh,COMM_ROLE);
    if (user2Id) await _issueInactivityWarning(guild,user2Id,gameData.team2,warnCh,COMM_ROLE);
  } else {
    const loserId=u1Done?user2Id:user1Id,winnerId=u1Done?user1Id:user2Id,loserTeam=u1Done?gameData.team2:gameData.team1,winnerTeam=u1Done?gameData.team1:gameData.team2;
    const e=new EmbedBuilder().setColor(0xdc3545).setTitle('👑 FORCE LOSS ISSUED').setDescription(`**${gameData.team1} vs ${gameData.team2} — Week ${gameData.week}**`)
      .addFields({name:'✅ Force Win',value:`${winnerId?`<@${winnerId}>`:winnerTeam} — **${winnerTeam}**`,inline:true},{name:'❌ Force Loss',value:`${loserId?`<@${loserId}>`:loserTeam} — **${loserTeam}**`,inline:true}).setTimestamp();
    if (channel) await channel.send({embeds:[e]}).catch(()=>null);
    if (forceWinCh) await forceWinCh.send({embeds:[e]}).catch(()=>null);
    if (loserId) await _issueInactivityWarning(guild,loserId,loserTeam,warnCh,COMM_ROLE);
  }
  gameData.finished=true;
  gameSessions.markFinished(channelId, { outcome: (!u1Done && !u2Done) ? 'fair-sim' : 'force-loss' });
}

async function _issueInactivityWarning(guild,userId,teamName,warnCh,COMM_ROLE) {
  const { state, getCh } = _services;
  if (!userId||!warnCh) return;
  const data=[...state.players.values()].find(p=>p.userId===userId);
  if (!data) return;
  data.inactivityWarnings=(data.inactivityWarnings||0)+1;
  const count=data.inactivityWarnings,boot=count>=3;
  const e=new EmbedBuilder().setColor(boot?0xdc3545:0xffc107).setTitle(boot?'🥾 BOOT THRESHOLD REACHED':'⚠️ Inactivity Warning')
    .addFields({name:'Player',value:`<@${userId}>`,inline:true},{name:'Team',value:teamName,inline:true},{name:'Count',value:`**${count}/3**`,inline:true}).setTimestamp();
  await warnCh.send({content:boot&&COMM_ROLE?`<@&${COMM_ROLE}>`:undefined,embeds:[e]}).catch(()=>null);
  if (boot) { const b=getCh(guild,'bootLog'); if(b&&COMM_ROLE) await b.send({content:`<@&${COMM_ROLE}> — Action required.`,embeds:[e]}).catch(()=>null); }
}

async function handleGameChannelMessage(message) {
  const { state, aiCall, MODELS } = _services;
  const game = state.games.get(message.channel.id);
  if (!game || game.finished) return;

  const ch = message.channel;
  const chId = ch.id;
  const text = (message.content || '').toLowerCase();
  await loggerConfigService.logToConfiguredChannel(message.guild, `💬 ${message.author.tag} in #${message.channel.name}: ${String(message.content || '').slice(0, 300)}`);
  const st = gameSearchState.get(chId) || { searching:false, deleteTimerId:null };

  if (st.searching && CANCEL_WORDS_RX.test(text)) {
    if (st.deleteTimerId) clearTimeout(st.deleteTimerId);
    gameSearchState.set(chId, { searching:false, deleteTimerId:null });
    await ch.send('⏸️ Search timer reset — postponed. Say **search** again when you are ready to lock in the game.').catch(()=>null);
    return;
  }

  const triggeredSearch = SEARCH_WORD_RX.test(text);
  const triggeredStart = GAME_START_RX.test(text);
  if (triggeredSearch || triggeredStart) {
    const prev = gameSearchState.get(chId);
    if (prev?.deleteTimerId) clearTimeout(prev.deleteTimerId);

    if (triggeredSearch) await ch.send({ embeds: [_buildSearchRulesEmbed(game)] }).catch(()=>null);
    if (triggeredStart) await ch.send({ embeds: [_buildGameStartEmbed(game)] }).catch(()=>null);

    try {
      const u1 = game.user1Id ? `<@${game.user1Id}>` : game.team1;
      const u2 = game.user2Id ? `<@${game.user2Id}>` : game.team2;
      const prompt = triggeredSearch
        ? `NOFUNLEAGUE Bot — ${u1} (${game.team1}) and ${u2} (${game.team2}) are searching for Week ${game.week}. Give 1-2 sentences of hype trash talk, tag both, keep it competitive, and remind them to schedule in this channel.`
        : `NOFUNLEAGUE Bot — ${u1} (${game.team1}) and ${u2} (${game.team2}) just sent the invite or are about to start Week ${game.week}. Give 1-2 sentences of hype trash talk, tag both, and tell them to finish the game and report the result.`;
      const res = await aiCall({ model: MODELS.FAST, max_tokens: 120, messages: [{ role: 'user', content: prompt }] });
      const out = res?.content?.[0]?.text?.trim();
      if (out) await ch.send(out).catch(()=>null);
    } catch {}

    const tid = setTimeout(async () => {
      const c = gameSearchState.get(chId);
      if (!c?.searching) return;
      await deleteGameChannel(ch, game, 'Auto-deleted 2 hours after search/game-start trigger.');
    }, TWO_HOURS_MS);

    gameSearchState.set(chId, { searching:true, deleteTimerId:tid, startTime:Date.now() });
  }
}


async function deleteGameChannel(channel, game, reason) {
  const { state } = _services;
  if (!channel) return;
  try {
    await channel.send(`🏁 **${game?.team1||''}${game?.team2?` vs ${game.team2}`:''}** — ${reason}`).catch(()=>null);
    await new Promise(r=>setTimeout(r,2000));
    await channel.delete(reason).catch(e=>console.error('[CH DELETE]',e.message));
    if (game) {
      if (game.reminderId) clearTimeout(game.reminderId);
      const st=gameSearchState.get(channel.id);
      if (st?.deleteTimerId) clearTimeout(st.deleteTimerId);
      gameSearchState.delete(channel.id);
      state.games.delete(channel.id);
    }
    gameSessions.markDeleted(channel.id);
    if (channel.guild) await loggerConfigService.logToConfiguredChannel(channel.guild, `🗑️ Game channel deleted: #${channel.name} | ${reason}`);
  } catch (e) { console.error('[deleteGameChannel]',e.message); throw e; }
}

/**
 * Delete weekly game channels.
 * @param {object} [opts]
 * @param {number} [opts.keepWeek]  V202: when set, channels whose managed session week === keepWeek are preserved
 *                                  (used by weekly automation so the CURRENT week is never cleared by a re-run).
 */
async function deleteAllGameChannels(guild, reason, opts = {}) {
  const { state } = _services;
  const cats = guild.channels.cache.filter(c=>c.type===ChannelType.GuildCategory&&(c.name.includes('WEEK GAMES')||c.name.includes('WEEKLY GAMES')));
  if (!cats.size) return 0;
  const keepWeek = opts.keepWeek != null ? Number(opts.keepWeek) : null;
  let n=0;
  for (const [,cat] of cats) {
    for (const [,ch] of guild.channels.cache.filter(c=>c.parentId===cat.id&&c.type===ChannelType.GuildText)) {
      const game = state.games.get(ch.id) || null;
      const owner = game || gameSessions.findByChannelId(ch.id);
      const targetLeague = opts.leagueId || require('../league/spaceContext').current();
      if (targetLeague && String(owner?.leagueId) !== String(targetLeague)) continue;
      if (!targetLeague && require('./activeLeagueService').listActiveLeagues().length > 1) throw new Error('Select a league before deleting game channels');
      if (keepWeek != null) {
        const week = game ? Number(game.week) : Number(gameSessions.findByChannelId(ch.id)?.week ?? NaN);
        if (week === keepWeek) continue;
      }
      await deleteGameChannel(ch,game,reason);
      await new Promise(r=>setTimeout(r,350)); n++;
    }
  }
  return n;
}

/**
 * V202: channels where a search/game-start trigger is active AND the game is still live (tracked, not finished).
 * A finished/reported or no-longer-tracked game never blocks the league advance, even while its 2h cleanup timer runs.
 */
function getActivelyPlayingChannelIds() {
  const games = _services?.state?.games;
  return [...gameSearchState.entries()]
    .filter(([id, st]) => st?.searching && games?.get?.(id) && !games.get(id).finished)
    .map(([id]) => id);
}

/**
 * V202 (/game-channels update): re-resolve both owners of a managed game channel from the team registry,
 * grant them channel access, and persist the owner ids. Never removes an existing member's access.
 * @returns {{ok:true, added:string[], owners:{user1Id,user2Id}}|{ok:false, reason:string}}
 */
async function refreshGameChannelOwners(guild, channel) {
  const { state } = _services;
  const game = state.games.get(channel?.id);
  if (!game) return { ok: false, reason: 'not-a-managed-game-channel' };
  const { getTeamDataByAnyName } = require('../utils/teamUtils');
  const owner1 = game.user1Id || getTeamDataByAnyName(game.team1, state.players)?.userId || null;
  const owner2 = game.user2Id || getTeamDataByAnyName(game.team2, state.players)?.userId || null;
  const added = [];
  for (const id of [owner1, owner2].filter(Boolean)) {
    if (channel.permissionOverwrites?.cache?.has?.(id)) continue;
    await channel.permissionOverwrites.edit(id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }, { reason: 'V202 game channel owner refresh' });
    added.push(id);
  }
  game.user1Id = owner1; game.user2Id = owner2;
  gameSessions.registerSession(channel.id, game, { matchupKey: game.matchupKey, guildId: guild.id, leagueId: game.leagueId, provider: game.provider, seasonId: game.seasonId });
  return { ok: true, added, owners: { user1Id: owner1, user2Id: owner2 } };
}

/** V202 (/game-channels delete): delete ONE weekly game channel. Refuses channels outside the weekly games categories. */
async function deleteSingleGameChannel(guild, channel, reason = 'Deleted by commissioner') {
  const { state } = _services;
  if (!channel || channel.type !== ChannelType.GuildText) return { ok: false, reason: 'not-a-text-channel' };
  const parentName = String(channel.parent?.name || '');
  const managed = state.games.has(channel.id) || !!gameSessions.findByChannelId(channel.id);
  if (!/WEEK(LY)? GAMES/.test(parentName) && !managed) return { ok: false, reason: 'not-a-weekly-game-channel' };
  await deleteGameChannel(channel, state.games.get(channel.id) || null, reason);
  return { ok: true };
}

module.exports = { init, createGameChannel, ensureGameChannel, armReminders, deleteGameChannel, deleteAllGameChannels, handleGameChannelMessage, getActivelyPlayingChannelIds, refreshGameChannelOwners, deleteSingleGameChannel };
