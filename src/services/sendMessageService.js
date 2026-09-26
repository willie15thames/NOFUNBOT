/*
 * NAVIGATION HEADER
 * FILE: src/services/sendMessageService.js
 * LAYER: Service layer
 * PURPOSE: Handles outbound or inbound messaging behavior and response control.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { makeLogger } = require('../utils/logger');
const { safeUrlString } = require('../utils/safeUrl');
const log = makeLogger('messageSend');
const responseGuard = require('./responseGuardService');

function _isTransient(err) {
  const code = Number(err?.status || err?.code || 0);
  const msg = String(err?.message || err || '');
  return code === 429 || code >= 500 || /rate limit|timeout|timed out|ECONNRESET|service unavailable/i.test(msg);
}

function _isPermissionish(err) {
  const msg = String(err?.message || err || '');
  return /Missing Access|Missing Permissions|Cannot send messages|Unknown Channel|Unknown Message|archived thread|locked thread/i.test(msg);
}

function sanitizeEmbed(embed) {
  if (!embed) return null;
  const raw = typeof embed.toJSON === 'function' ? embed.toJSON() : { ...embed };
  if (raw.url) raw.url = safeUrlString(raw.url, { logger: log });
  if (raw.thumbnail?.url) raw.thumbnail.url = safeUrlString(raw.thumbnail.url, { logger: log });
  if (raw.image?.url) raw.image.url = safeUrlString(raw.image.url, { logger: log });
  if (raw.author?.icon_url) raw.author.icon_url = safeUrlString(raw.author.icon_url, { logger: log });
  if (raw.author?.url) raw.author.url = safeUrlString(raw.author.url, { logger: log });
  if (raw.footer?.icon_url) raw.footer.icon_url = safeUrlString(raw.footer.icon_url, { logger: log });
  if (Array.isArray(raw.fields)) {
    raw.fields = raw.fields
      .filter(Boolean)
      .map(f => ({
        name: String(f.name ?? '').slice(0, 256) || 'Info',
        value: String(f.value ?? '').slice(0, 1024) || '—',
        inline: !!f.inline,
      }))
      .slice(0, 25);
  }
  if (raw.title != null) raw.title = String(raw.title).slice(0, 256);
  if (raw.description != null) raw.description = String(raw.description).slice(0, 4096);
  return raw;
}

function sanitizePayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  const clean = { ...payload };
  if (Array.isArray(clean.embeds)) {
    clean.embeds = clean.embeds.map(sanitizeEmbed).filter(Boolean);
  }
  if (clean.content != null) clean.content = String(clean.content).slice(0, 2000);
  return clean;
}

async function preflight(channel, payload = {}) {
  if (!channel) return { ok: false, reason: 'missing-channel' };
  if (typeof channel.isTextBased === 'function' && !channel.isTextBased()) return { ok: false, reason: 'not-text-based' };
  const me = channel.guild?.members?.me;
  const perms = channel.permissionsFor?.(me);
  if (perms) {
    if (!perms.has('ViewChannel')) return { ok: false, reason: 'missing-view-channel' };
    if (!perms.has('SendMessages')) return { ok: false, reason: 'missing-send-messages' };
    if ((payload.embeds?.length || 0) > 0 && !perms.has('EmbedLinks')) return { ok: false, reason: 'missing-embed-links' };
    if ((payload.files?.length || 0) > 0 && !perms.has('AttachFiles')) return { ok: false, reason: 'missing-attach-files' };
  }
  if (channel.isThread?.() && (channel.archived || channel.locked)) return { ok: false, reason: 'thread-unavailable' };
  return { ok: true };
}

async function send(channel, payload, ctx = {}) {
  const safePayload = sanitizePayload(payload);
  const check = await preflight(channel, safePayload);
  if (!check.ok) {
    log.warn(`[send] blocked reason=${check.reason} ch=${channel?.id || 'none'} action=${ctx.action || 'send'}`);
    return { ok: false, reason: check.reason };
  }
  if (!responseGuard.claimSend(channel?.id, safePayload, ctx, 4000)) {
    log.warn(`[send] deduped ch=${channel?.id || 'none'} action=${ctx.action || 'send'}`);
    return { ok: false, reason: 'deduped-send' };
  }
  let tries = 0;
  let lastErr = null;
  while (tries < 3) {
    tries += 1;
    try {
      const message = await channel.send(safePayload);
      log.info(`[send] ok ch=${channel.id} action=${ctx.action || 'send'} tries=${tries}`);
      return { ok: true, message };
    } catch (err) {
      lastErr = err;
      log.warn(`[send] fail ch=${channel?.id || 'none'} action=${ctx.action || 'send'} tries=${tries} reason=${err?.message || err}`);
      if (_isPermissionish(err) || !_isTransient(err) || tries >= 3) break;
      await new Promise(r => setTimeout(r, 350 * tries));
    }
  }
  return { ok: false, reason: 'send-failed', error: lastErr, payload: safePayload };
}

module.exports = { preflight, send, sanitizePayload, sanitizeEmbed };
