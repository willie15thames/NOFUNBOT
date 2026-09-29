/*
 * NAVIGATION HEADER
 * FILE: src/services/botIdentityService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const serverSettings = require('./serverSettingsService');

function _serverImageUrl(guild) {
  if (!guild) return null;
  return guild.bannerURL?.({ extension: 'png', size: 1024 }) ||
         guild.iconURL?.({ extension: 'png', size: 1024 }) ||
         guild.splashURL?.({ extension: 'png', size: 1024 }) ||
         null;
}

async function _fetchAvatarBuffer(url) {
  if (!url) return null;
  // V202 (BUG-010): central intake — https only, no private destinations, 15s timeout, 8 MB cap, image/* only.
  const { fetchExternal } = require('../utils/httpIntake');
  const res = await fetchExternal({ url, timeoutMs: 15000, maxBytes: 8 * 1024 * 1024, expectedContentTypes: ['image/*'] });
  if (!res.ok) throw new Error(res.reason === 'unexpected-content-type' ? 'avatar_not_image' : `avatar_fetch_${res.status || res.reason}`);
  return res.buffer;
}

async function applyBotIdentity(client, guild) {
  try {
    const settings = serverSettings.getSettings();
    if (!client?.user) return { ok:false, reason:'client user unavailable' };

    const desiredName = String(settings.botName || 'CommishAI').trim().slice(0, 32) || 'CommishAI';
    let desiredAvatarUrl = null;
    const avatarMode = String(settings.avatarMode || '').toLowerCase();
    if (avatarMode === 'url' || avatarMode === 'emoji_url') desiredAvatarUrl = settings.avatarUrl || null;
    else desiredAvatarUrl = _serverImageUrl(guild);

    let usernameChanged = false;
    let nicknameChanged = false;
    let avatarChanged = false;
    let avatarError = null;
    let usernameError = null;
    let nicknameError = null;

    if (desiredName) {
      const beforeUsername = String(client.user.username || '');
      if (beforeUsername !== desiredName) {
        try {
          await client.user.setUsername(desiredName);
        } catch (err) {
          usernameError = err.message;
        }
      }
      const afterUsername = String(client.user.username || beforeUsername || '');
      usernameChanged = afterUsername === desiredName && beforeUsername !== afterUsername;

      let me = guild?.members?.me || (guild ? await guild.members.fetchMe().catch(() => null) : null);
      if (me) {
        const beforeNick = String(me.nickname || me.displayName || '');
        if (beforeNick !== desiredName) {
          try {
            await me.setNickname(desiredName, 'CommishAI bot identity sync');
          } catch (err) {
            nicknameError = err.message;
          }
          me = guild ? await guild.members.fetchMe().catch(() => me) : me;
        }
        const afterNick = String(me.nickname || me.displayName || beforeNick || '');
        nicknameChanged = afterNick === desiredName && beforeNick !== afterNick;
      }
    }

    if (desiredAvatarUrl && settings.lastAppliedAvatar !== desiredAvatarUrl) {
      try {
        const buf = await _fetchAvatarBuffer(desiredAvatarUrl);
        if (!buf) throw new Error('avatar_buffer_empty');
        await client.user.setAvatar(buf);
        avatarChanged = true;
      } catch (err) {
        avatarError = err.message;
      }
    }

    const liveMe = guild ? await guild.members.fetchMe().catch(() => guild?.members?.me || null) : null;
    const effectiveDisplayName = String(liveMe?.nickname || liveMe?.displayName || client.user.username || desiredName || settings.lastAppliedName || '');
    serverSettings.saveSettings({
      ...settings,
      lastAppliedName: desiredName || effectiveDisplayName,
      lastAppliedAvatar: avatarChanged ? desiredAvatarUrl : settings.lastAppliedAvatar || null,
    });

    const reasons = [avatarError, usernameError, nicknameError].filter(Boolean);
    return {
      ok: !reasons.length,
      reason: reasons[0] || null,
      nameChanged: usernameChanged || nicknameChanged,
      usernameChanged,
      nicknameChanged,
      avatarChanged,
      desiredName,
      desiredAvatar: desiredAvatarUrl,
      displayName: effectiveDisplayName,
    };
  } catch (err) {
    return { ok:false, reason: err.message };
  }
}

module.exports = { applyBotIdentity, _serverImageUrl, _fetchAvatarBuffer };
