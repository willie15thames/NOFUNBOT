/*
 * NAVIGATION HEADER
 * FILE: src/services/leagueMemberOnboardingService.js
 * LAYER: Service layer
 * PURPOSE: League-scoped member onboarding after self-join or commissioner placement.
 * DESIGN: League/team identity stays league-scoped; guild nickname only carries timezone.
 */
'use strict';

const { EmbedBuilder } = require('discord.js');
const activeLeagueService = require('./activeLeagueService');
const leagueNaming = require('./leagueNamingService');
const timezoneGateService = require('./timezoneGateService');
const memberProfiles = require('./memberProfileService');

function getLeague(leagueId) {
  return activeLeagueService.getLeague(leagueId) || null;
}

function findLeagueChannel(guild, league, keys = ['general', 'open-teams', 'announcements']) {
  if (!guild || !league) return null;
  const channels = (league.builtChannelIds || []).map(id => guild.channels.cache.get(id)).filter(Boolean);
  for (const key of keys) {
    const found = channels.find(ch => leagueNaming.matchesLeagueChannelKey(ch.name, key));
    if (found) return found;
  }
  return channels.find(ch => ch?.isTextBased?.()) || null;
}

function buildTimezoneRow(leagueId, userId) {
  return timezoneGateService.buildTimezoneSelectRow(`league_member_timezone::${leagueId}::${userId}`);
}

function _profileLeagueState(userId, leagueId) {
  const profile = memberProfiles.getProfile(userId) || {};
  return profile.leagueOnboarding?.[String(leagueId)] || null;
}

function markOnboarding(userId, leagueId, patch = {}) {
  const profile = memberProfiles.getProfile(userId) || {};
  const leagueOnboarding = { ...(profile.leagueOnboarding || {}) };
  leagueOnboarding[String(leagueId)] = {
    ...(leagueOnboarding[String(leagueId)] || {}),
    ...patch,
    leagueId: String(leagueId),
    updatedAt: Date.now(),
  };
  return memberProfiles.upsertProfile(userId, { leagueOnboarding });
}

async function notifyMemberAdded({ guild, member, leagueId, teamName = null, actorId = null, source = 'commissioner' }) {
  const league = getLeague(leagueId);
  if (!guild || !member || !league) return { ok:false, reason:'missing-context' };

  const prior = _profileLeagueState(member.id, leagueId);
  const sameTeam = String(prior?.teamName || '') === String(teamName || '');
  const recentlyNotified = prior?.notifiedAt && (Date.now() - Number(prior.notifiedAt) < 5 * 60 * 1000);
  if (sameTeam && recentlyNotified && prior?.status !== 'complete') {
    return { ok:true, skipped:true, reason:'recent-onboarding-already-sent' };
  }

  const channel = findLeagueChannel(guild, league);
  const teamText = teamName ? `**Team:** ${teamName}` : '**Team:** not selected yet';
  const nextText = teamName
    ? 'Choose your timezone below. Once saved, your server nickname gets a timezone suffix and scheduling is ready.'
    : 'Choose your timezone below, then use `/select-team` to claim an available team in this league.';

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`👋 Welcome to ${league.leagueName}`)
    .setDescription(`You have been added to **${league.leagueName}**.\n\n${teamText}\n\n${nextText}`)
    .addFields(
      { name:'League', value:String(league.leagueName || league.id), inline:true },
      { name:'Onboarding status', value:'Waiting for your timezone selection', inline:true },
    )
    .setFooter({ text:'Timezone is server-wide. Team identity remains league-specific so multi-league membership stays clean.' })
    .setTimestamp();

  let message = null;
  if (channel) {
    message = await channel.send({
      content:`<@${member.id}>`,
      embeds:[embed],
      components:[buildTimezoneRow(league.id, member.id)],
      allowedMentions:{ users:[member.id], parse:[] },
    }).catch(() => null);
  }

  // DM is supplemental only. The league channel message remains canonical because its select menu
  // runs with guild/member context and works even when DMs are disabled.
  await member.send?.({
    content:`You were added to **${league.leagueName}**${teamName ? ` as **${teamName}**` : ''}. Open the league in **${guild.name}** and choose your timezone on the welcome card.`,
    allowedMentions:{ parse:[] },
  }).catch(() => null);

  markOnboarding(member.id, league.id, {
    status:'awaiting-timezone',
    teamName: teamName || null,
    notifiedAt:Date.now(),
    messageId:message?.id || null,
    channelId:message?.channelId || channel?.id || null,
    actorId:actorId || null,
    source,
  });

  return { ok:true, league, channel, message };
}

function markTimezoneComplete(userId, leagueId, timezone, nicknameResult = null) {
  return markOnboarding(userId, leagueId, {
    status:'complete',
    timezone,
    completedAt:Date.now(),
    nicknameResult:nicknameResult || null,
  });
}

module.exports = {
  getLeague,
  findLeagueChannel,
  buildTimezoneRow,
  notifyMemberAdded,
  markOnboarding,
  markTimezoneComplete,
};
