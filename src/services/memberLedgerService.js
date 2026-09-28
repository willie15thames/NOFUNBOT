/*
 * NAVIGATION HEADER
 * FILE: src/services/memberLedgerService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
// src/services/memberLedgerService.js
// Persistent member memory. Survives kicks, bans, leaves, rejoins.
// Tracks: join/leave history, warnings, offenses, kick reasons, activity.
// The bot NEVER forgets a member.

const { EmbedBuilder } = require('discord.js');
const { saveJsonDebounced, loadJson } = require('../storage/jsonStore');
const { makeLogger } = require('../utils/logger');
const log = makeLogger('ledger');

const _savedLedger = loadJson('memberLedger.json', {});
const ledger = new Map(Object.entries(_savedLedger));

let _getCh, _state, _client;
function init({ getCh, state, client }) { _getCh = getCh; _state = state; _client = client; }

function _save() {
  const obj = {};
  for (const [k, v] of ledger) obj[k] = v;
  saveJsonDebounced('memberLedger.json', obj);

  // Dual-write changed entries to Prisma MemberLedger table (non-blocking)
  try {
    const { getGuildId } = require('./serverConfigBootstrap');
    const { prismaSafe } = require('../storage/prisma');
    const guildId = getGuildId();
    if (guildId) {
      for (const [userId, rec] of ledger) {
        prismaSafe(prisma => prisma.memberLedger.upsert({
          where: { guildId_userId: { guildId: String(guildId), userId: String(userId) } },
          create: {
            guildId: String(guildId),
            userId: String(userId),
            discordTag: rec.username || null,
            joinCount: (rec.joinHistory || []).filter(x => x.type === 'join').length,
            totalWarnings: rec.warnings?.total || 0,
            gameplayWarnings: rec.warnings?.gameplay || 0,
            closeAppWarnings: rec.warnings?.closeApp || 0,
            inactivityWarnings: rec.warnings?.inactivity || 0,
            isBanned: !!rec.isBanned,
            lastActivityAt: rec.lastMessageAt ? new Date(rec.lastMessageAt) : null,
            notes: rec.notes || [],
            kickHistory: rec.kickHistory || [],
            banHistory: rec.banHistory || [],
            teamHistory: rec.teamHistory || [],
          },
          update: {
            joinCount: (rec.joinHistory || []).filter(x => x.type === 'join').length,
            leaveCount: (rec.joinHistory || []).filter(x => x.type !== 'join').length,
            kickCount: (rec.kickHistory || []).length,
            banCount: (rec.banHistory || []).length,
            discordTag: rec.username || null,
            totalWarnings: rec.warnings?.total || 0,
            gameplayWarnings: rec.warnings?.gameplay || 0,
            closeAppWarnings: rec.warnings?.closeApp || 0,
            inactivityWarnings: rec.warnings?.inactivity || 0,
            isBanned: !!rec.isBanned,
            lastActivityAt: rec.lastMessageAt ? new Date(rec.lastMessageAt) : null,
            notes: rec.notes || [],
            kickHistory: rec.kickHistory || [],
            banHistory: rec.banHistory || [],
            teamHistory: rec.teamHistory || [],
            updatedAt: new Date(),
          },
        }), null).catch(() => null);
      }
    }
  } catch (_e) {}
}

function getRecord(userId) {
  if (!ledger.has(userId)) {
    ledger.set(userId, {
      userId, username: null, displayName: null,
      firstSeen: Date.now(), lastSeen: Date.now(), lastMessageAt: null,
      joinHistory: [],
      warnings: { gameplay: 0, closeApp: 0, inactivity: 0, total: 0 },
      offenses: [],
      kickHistory: [],
      banHistory: [],
      teamHistory: [],
      currentTeam: null, currentLeagueId: null,
      notes: [],
      isBanned: false,
      inactivityNotified: false,
    });
  }
  return ledger.get(userId);
}

function trackActivity(userId, username) {
  const rec = getRecord(userId);
  rec.lastSeen = Date.now();
  rec.lastMessageAt = Date.now();
  rec.inactivityNotified = false;
  if (username) rec.username = username;
  _save();
}

function recordJoin(member) {
  const rec = getRecord(member.id);
  rec.username = member.user.tag || member.user.username;
  rec.displayName = member.displayName || member.user.username;
  rec.lastSeen = Date.now();
  rec.joinHistory.push({ timestamp: Date.now(), type: 'join' });
  _save();
  return rec;
}

function recordLeave(member, type = 'leave', reason = null, by = null) {
  const rec = getRecord(member.id);
  rec.joinHistory.push({ timestamp: Date.now(), type });
  if (type === 'kick') rec.kickHistory.push({ timestamp: Date.now(), reason: reason || 'Not specified', by });
  if (type === 'ban') { rec.banHistory.push({ timestamp: Date.now(), reason: reason || 'Not specified', by }); rec.isBanned = true; }
  if (rec.currentTeam) {
    const hist = rec.teamHistory[rec.teamHistory.length - 1];
    if (hist && !hist.releasedAt) hist.releasedAt = Date.now();
    rec.currentTeam = null; rec.currentLeagueId = null;
  }
  _save();
  return rec;
}

function recordWarning(userId, type, reason) {
  const rec = getRecord(userId);
  const field = type === 'closeapp' ? 'closeApp' : type === 'inactivity' ? 'inactivity' : 'gameplay';
  rec.warnings[field] = (rec.warnings[field] || 0) + 1;
  rec.warnings.total = (rec.warnings.total || 0) + 1;
  rec.offenses.push({ type, reason: reason || 'Warning issued', timestamp: Date.now(), actionTaken: 'warning' });
  _save();
  return rec;
}

function recordTeamClaim(userId, teamName, leagueId) {
  const rec = getRecord(userId);
  rec.currentTeam = teamName; rec.currentLeagueId = leagueId || null;
  rec.teamHistory.push({ team: teamName, leagueId: leagueId || null, claimedAt: Date.now(), releasedAt: null });
  _save();
  return rec;
}

function recordTeamRelease(userId, leagueId = null) {
  const rec = getRecord(userId);
  const hist = [...rec.teamHistory].reverse().find(item => !item.releasedAt && (!leagueId || String(item.leagueId || '') === String(leagueId)));
  if (hist && !hist.releasedAt) hist.releasedAt = Date.now();
  const latest = [...rec.teamHistory].reverse().find(item => !item.releasedAt);
  rec.currentTeam = latest?.team || null; rec.currentLeagueId = latest?.leagueId || null;
  _save();
  return rec;
}

function isReturningMember(userId) {
  const rec = ledger.get(userId);
  return rec ? (rec.joinHistory.length > 1 || rec.kickHistory.length > 0 || rec.banHistory.length > 0) : false;
}

function buildProfileEmbed(userId) {
  const rec = ledger.get(userId);
  if (!rec) return new EmbedBuilder().setColor(0x95a5a6).setTitle('Unknown Member').setDescription('No records found.');
  const kicks = rec.kickHistory.length;
  const lastActive = rec.lastMessageAt ? `<t:${Math.floor(rec.lastMessageAt / 1000)}:R>` : 'Never';
  const embed = new EmbedBuilder()
    .setColor(rec.isBanned ? 0x8b0000 : kicks > 0 ? 0xff4500 : 0x3498db)
    .setTitle(`👤 ${rec.username || `<@${userId}>`}`)
    .addFields(
      { name: 'First Seen', value: `<t:${Math.floor(rec.firstSeen / 1000)}:D>`, inline: true },
      { name: 'Last Active', value: lastActive, inline: true },
      { name: 'Joins', value: String(rec.joinHistory.filter(h => h.type === 'join').length), inline: true },
      { name: 'Warnings', value: `GP: ${rec.warnings.gameplay} | App: ${rec.warnings.closeApp} | Inactive: ${rec.warnings.inactivity} | **Total: ${rec.warnings.total}**` },
    );
  if (kicks > 0) embed.addFields({ name: `Kicks (${kicks})`, value: rec.kickHistory.slice(-3).map(k => `• <t:${Math.floor(k.timestamp / 1000)}:d> — ${k.reason}`).join('\n') });
  if (rec.isBanned) embed.addFields({ name: 'Banned', value: rec.banHistory.slice(-1).map(b => b.reason).join(', ') || 'Yes' });
  if (rec.currentTeam) embed.addFields({ name: 'Current Team', value: rec.currentTeam, inline: true });
  if (rec.teamHistory.length > 0) embed.addFields({ name: `Teams (${rec.teamHistory.length})`, value: rec.teamHistory.slice(-3).map(t => `• **${t.team}** (${t.releasedAt ? 'released' : 'active'})`).join('\n') });
  if (rec.notes.length > 0) embed.addFields({ name: 'Notes', value: rec.notes.slice(-3).map(n => `• ${n.text}`).join('\n') });
  embed.setTimestamp();
  return embed;
}

function buildReturningAlert(member) {
  const rec = ledger.get(member.id);
  if (!rec) return null;
  const kicks = rec.kickHistory.length;
  const lastKick = rec.kickHistory[rec.kickHistory.length - 1];
  const embed = new EmbedBuilder()
    .setColor(kicks > 0 ? 0xff4500 : 0xf39c12)
    .setTitle(`🔄 RETURNING MEMBER — ${rec.username || member.user.tag}`)
    .setDescription(`**${member.user.tag}** just rejoined. The bot remembers everything.`)
    .addFields(
      { name: 'Total Warnings', value: String(rec.warnings.total), inline: true },
      { name: 'Times Kicked', value: String(kicks), inline: true },
      { name: 'Banned Before', value: rec.isBanned ? '⚠️ YES' : 'No', inline: true },
    );
  if (lastKick) embed.addFields({ name: 'Last Kick', value: `${lastKick.reason}\n*<t:${Math.floor(lastKick.timestamp / 1000)}:R>*` });
  if (rec.teamHistory.length > 0) embed.addFields({ name: 'Previous Team', value: rec.teamHistory[rec.teamHistory.length - 1].team, inline: true });
  embed.setFooter({ text: `ID: ${member.id} • /member-record history for full ledger` }).setTimestamp();
  return embed;
}

function addNote(userId, note, by = null) {
  const rec = getRecord(userId);
  rec.notes.push({ text: String(note || '').trim(), by, timestamp: Date.now() });
  _save();
  return rec;
}

function getInactiveMembers(days = 4) {
  const threshold = Date.now() - (days * 24 * 60 * 60 * 1000);
  const inactive = [];
  for (const [userId, rec] of ledger) {
    if (!rec.currentTeam) continue;
    if (rec.inactivityNotified) continue;
    const lastActive = rec.lastMessageAt || rec.lastSeen || rec.firstSeen;
    if (lastActive < threshold) {
      inactive.push({ userId, username: rec.username || userId, team: rec.currentTeam, lastActive, daysSince: Math.floor((Date.now() - lastActive) / (24 * 60 * 60 * 1000)) });
    }
  }
  return inactive.sort((a, b) => a.lastActive - b.lastActive);
}

function markInactivityNotified(userIds) {
  for (const id of userIds) { const rec = ledger.get(id); if (rec) rec.inactivityNotified = true; }
  _save();
}

async function runInactivityCheck(guild) {
  if (!_getCh) return;
  const inactive = getInactiveMembers(4);
  if (!inactive.length) return;
  const commCh = _getCh(guild, 'commAI') || _getCh(guild, 'adminHq');
  if (!commCh) return;
  const lines = inactive.map(m => `• **${m.username}** (${m.team}) — last active **${m.daysSince} days ago**`).join('\n');
  await commCh.send({ embeds: [new EmbedBuilder().setColor(0xf39c12).setTitle(`⏰ Inactivity Alert — ${inactive.length} member${inactive.length > 1 ? 's' : ''}`)
    .setDescription(`These league members have been silent for **4+ days**:\n\n${lines}\n\nUse \`/warn-player\` or \`/member-record history\` to review.`)
    .setFooter({ text: 'Checked daily • Resets when member sends a message' }).setTimestamp()] }).catch(e => log.error('Inactivity alert failed:', e.message));
  markInactivityNotified(inactive.map(m => m.userId));
  log.info(`Inactivity alert: ${inactive.length} members flagged.`);
}

function getLedgerSummary() {
  const total = ledger.size;
  const withTeams = [...ledger.values()].filter(r => r.currentTeam).length;
  const kicked = [...ledger.values()].filter(r => r.kickHistory.length > 0).length;
  const banned = [...ledger.values()].filter(r => r.isBanned).length;
  return `Members tracked: ${total} | Active: ${withTeams} | Prev. kicked: ${kicked} | Banned: ${banned}`;
}

function getAllRecords() { return [...ledger.values()]; }


function resetAll() {
  ledger.clear();
  _save();
}

// ── Ban List Management ─────────────────────────────────────────

/** Get all banned users from the bot's ledger */
function getBanList() {
  return [...ledger.values()]
    .filter(r => r.isBanned)
    .map(r => ({
      userId: r.userId,
      username: r.username || r.displayName || r.userId,
      bannedAt: r.banHistory.length ? r.banHistory[r.banHistory.length - 1].timestamp : null,
      reason: r.banHistory.length ? r.banHistory[r.banHistory.length - 1].reason : 'Unknown',
      totalKicks: r.kickHistory.length,
      totalWarnings: r.warnings.total,
    }))
    .sort((a, b) => (b.bannedAt || 0) - (a.bannedAt || 0));
}

/** Mark a user as banned in the ledger (called when bot or commissioner bans) */
function recordBan(userId, reason, by) {
  const rec = getRecord(userId);
  rec.isBanned = true;
  rec.banHistory.push({ timestamp: Date.now(), reason: reason || 'Banned by commissioner', by: by || null });
  _save();
  return rec;
}

/**
 * Unban a user in the bot's ledger AND remove the Discord server ban.
 * @param {Guild} guild - Discord guild to remove ban from
 * @param {string} userId - User ID to unban
 * @param {string} unbannedBy - Who unbanned them
 * @returns {{ success: boolean, username: string, reason?: string }}
 */
async function unbanUser(guild, userId, unbannedBy) {
  const rec = ledger.get(userId);
  if (!rec) return { success: false, reason: 'No record found for that user ID.' };
  if (!rec.isBanned) return { success: false, reason: `**${rec.username || userId}** is not on the ban list.` };

  // Clear ban flag in ledger
  rec.isBanned = false;
  rec.notes.push({ text: `Unbanned by ${unbannedBy} on ${new Date().toLocaleDateString()}`, timestamp: Date.now() });
  _save();

  // Remove Discord server ban
  try {
    await guild.members.unban(userId, `Unbanned by ${unbannedBy} via bot`);
  } catch (e) {
    // They might not have an active Discord ban (only ledger ban)
    log.warn(`Discord unban failed for ${userId}: ${e.message} — ledger cleared anyway.`);
  }

  return { success: true, username: rec.username || userId };
}

module.exports = { init, getRecord, trackActivity, recordJoin, recordLeave, recordWarning, recordTeamClaim, recordTeamRelease, isReturningMember, buildProfileEmbed, buildReturningAlert, addNote, getInactiveMembers, listInactiveMembers: getInactiveMembers, markInactivityNotified, runInactivityCheck, getLedgerSummary, getAllRecords, getBanList, recordBan, unbanUser, resetAll };
