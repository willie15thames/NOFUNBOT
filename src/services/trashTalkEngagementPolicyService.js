/*
 * R-mode Open House engagement policy.
 * Decides WHEN conversational member AI may join ambient banter. It never authorizes domain mutations.
 * Explicit @mentions/replies remain eligible regardless of Open House. Ambient engagement is limited to
 * commissioner-designated or clearly conversational channels and protected by cooldown/burst controls.
 */
'use strict';

const serverSettings = require('./serverSettingsService');
const { isExplicitBotMention } = require('./explicitMentionGateService');

const userCooldowns = new Map();
const channelCooldowns = new Map();
const channelBursts = new Map();
const SWEEP_MAX = 2000;

const ALWAYS_BLOCKED_CHANNEL_RX = /(?:setup|wizard|rules?|warning|boot-log|patch|admin|commish|score|provider|audit|log|announcements?|schedule|game-results?|active-check)/i;
const DEFAULT_SOCIAL_CHANNEL_RX = /(?:general|chat|trash|rival|banter|game-day|gameday|madden|nfl|sports|lounge|community)/i;
const BANTER_SIGNAL_RX = /(?:\b(?:trash|cooked|washed|fraud|bum|garbage|ass|bitch|shit|fuck|smoke|clown|choke|ring|super\s*bowl|playoffs?|madden|nfl|rival|score|beat|win|lost|loss|record|team|coach|qb|quarterback)\b|😂|🤣|💀|😭|🔥|🗑️)/i;
const DIRECT_BOT_REFERENCE_RX = /\b(?:bot|mybot|mynuts|tryagain)\b/i;

function _sweep(map, now) {
  if (map.size < SWEEP_MAX) return;
  for (const [key, value] of map) {
    const exp = typeof value === 'number' ? value : value?.expiresAt;
    if (!exp || exp <= now) map.delete(key);
  }
}

function _channelConfigured(settings, message) {
  const ids = Array.isArray(settings.rOpenHouseChannels) ? settings.rOpenHouseChannels.map(String) : [];
  if (ids.includes(String(message.channel?.id || ''))) return true;
  const name = String(message.channel?.name || '');
  if (ALWAYS_BLOCKED_CHANNEL_RX.test(name)) return false;
  return ids.length === 0 && DEFAULT_SOCIAL_CHANNEL_RX.test(name);
}

function _burstAllowed(channelId, now, settings) {
  const windowMs = Math.max(30_000, Number(settings.rOpenHouseBurstWindowMs || 300_000));
  const max = Math.max(1, Number(settings.rOpenHouseBurstLimit || 3));
  const row = channelBursts.get(channelId) || { times: [] };
  row.times = row.times.filter(ts => now - ts < windowMs);
  channelBursts.set(channelId, row);
  return row.times.length < max;
}

function _consume(message, settings, now) {
  const userMs = Math.max(5_000, Number(settings.rOpenHouseUserCooldownMs || 60_000));
  const channelMs = Math.max(5_000, Number(settings.rOpenHouseChannelCooldownMs || 45_000));
  userCooldowns.set(String(message.author.id), now + userMs);
  channelCooldowns.set(String(message.channel.id), now + channelMs);
  const row = channelBursts.get(String(message.channel.id)) || { times: [] };
  row.times.push(now);
  channelBursts.set(String(message.channel.id), row);
}

function shouldEngage(message, client, { consume = true } = {}) {
  if (!message?.guild || message.author?.bot) return { eligible:false, reason:'invalid-message' };
  if (isExplicitBotMention(message, client)) return { eligible:true, reason:'explicit' };

  const settings = serverSettings.getSettings();
  if (String(settings.audienceRating || '').toLowerCase() !== 'r') return { eligible:false, reason:'not-r-mode' };
  if (settings.rOpenHouseEnabled === false) return { eligible:false, reason:'disabled' };
  if ((settings.rOpenHouseOptOutUserIds || []).map(String).includes(String(message.author.id))) return { eligible:false, reason:'user-opt-out' };
  if (!_channelConfigured(settings, message)) return { eligible:false, reason:'channel-not-enabled' };

  const text = String(message.content || '');
  const hasMedia = !!message.attachments?.size || !!message.stickers?.size;
  let score = 0;
  if (BANTER_SIGNAL_RX.test(text)) score += 2;
  if (DIRECT_BOT_REFERENCE_RX.test(text)) score += 1;
  if (hasMedia) score += 1;
  if (message.mentions?.users?.size > 0) score += 1;
  if (text.length >= 20) score += 1;
  if (score < 2) return { eligible:false, reason:'low-signal', score };

  const now = Date.now();
  _sweep(userCooldowns, now); _sweep(channelCooldowns, now);
  if ((userCooldowns.get(String(message.author.id)) || 0) > now) return { eligible:false, reason:'user-cooldown', score };
  if ((channelCooldowns.get(String(message.channel.id)) || 0) > now) return { eligible:false, reason:'channel-cooldown', score };
  if (!_burstAllowed(String(message.channel.id), now, settings)) return { eligible:false, reason:'burst-cap', score };

  if (consume) _consume(message, settings, now);
  return { eligible:true, reason:'r-open-house', score };
}

function resetForTests() { userCooldowns.clear(); channelCooldowns.clear(); channelBursts.clear(); }

module.exports = { shouldEngage, resetForTests, ALWAYS_BLOCKED_CHANNEL_RX, DEFAULT_SOCIAL_CHANNEL_RX };
