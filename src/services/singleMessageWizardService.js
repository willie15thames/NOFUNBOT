/*
 * NAVIGATION HEADER
 * FILE: src/services/singleMessageWizardService.js
 * LAYER: Service layer
 * PURPOSE: Enforces the single-message wizard contract and heals the setup lane when messages drift.
 * LOOK HERE FIRST WHEN DEBUGGING: Search for ensureSingleMessage and cleanupLane.
 * RELATED FLOW: setup wizard, post-reboot finalization, recovery/self-heal.
 */

'use strict';

const wizardStateService = require('./wizardStateService');
const sendMessageService = require('./sendMessageService');

const DEFAULT_MATCHER = /Setup Flow Guide|myBot Setup Wizard|Setup Wizard Ready|Start Setup/i;

function _getTitle(msg) {
  return String(msg?.embeds?.[0]?.title || '');
}

function _isGuideLike(msg, matcher = DEFAULT_MATCHER) {
  if (!msg?.author?.bot) return false;
  const title = _getTitle(msg);
  const content = String(msg?.content || '');
  return matcher.test(`${title} ${content}`);
}

async function resolveExistingGuide(channel, matcher = DEFAULT_MATCHER) {
  if (!channel?.messages?.fetch) return null;
  const activeId = wizardStateService.getActiveMessageId();
  if (activeId) {
    const active = await channel.messages.fetch(activeId).catch(() => null);
    if (active) return active;
  }
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!recent) return null;
  const found = [...recent.values()].find(msg => _isGuideLike(msg, matcher));
  if (found?.id) wizardStateService.setActiveMessageId(found.id);
  return found || null;
}

async function cleanupLane(channel, preserveMessageId, opts = {}) {
  if (!channel?.messages?.fetch) return null;
  const keep = new Set([String(preserveMessageId || ''), String(wizardStateService.getActiveMessageId() || '')].filter(Boolean));
  const recent = await channel.messages.fetch({ limit: Number(opts.limit || 100) }).catch(() => null);
  if (!recent) return null;
  for (const msg of recent.values()) {
    if (keep.has(String(msg.id))) continue;
    if (msg.pinned && !opts.deletePinned) continue;
    const shouldDeleteBot = msg.author?.bot;
    const shouldDeleteUser = !!opts.deleteUserMessages;
    if (shouldDeleteBot || shouldDeleteUser) {
      await msg.delete().catch(() => null);
    }
  }
  return preserveMessageId || null;
}

async function ensureSingleMessage(channel, payload, opts = {}) {
  if (!channel) return null;
  const matcher = opts.matcher || DEFAULT_MATCHER;
  const existing = await resolveExistingGuide(channel, matcher);
  const cleanPayload = { ...(payload || {}) };
  delete cleanPayload.files;
  let message = existing || null;
  if (message?.editable) {
    await message.edit(cleanPayload).catch(() => null);
  } else {
    const sentResult = await sendMessageService.send(channel, cleanPayload, { action: opts.action || 'wizard-single-message' });
    message = sentResult?.message || null;
  }
  if (message?.id) {
    wizardStateService.setActiveMessageId(message.id);
    await cleanupLane(channel, message.id, { deletePinned: false, deleteUserMessages: !!opts.deleteUserMessages, limit: opts.limit || 100 });
  }
  return message;
}

async function reconcileOrRecreate(channel, payloadBuilder, opts = {}) {
  if (!channel) return null;
  const payload = typeof payloadBuilder === 'function' ? await payloadBuilder() : (payloadBuilder || {});
  return ensureSingleMessage(channel, payload, opts);
}

module.exports = {
  DEFAULT_MATCHER,
  resolveExistingGuide,
  cleanupLane,
  ensureSingleMessage,
  reconcileOrRecreate,
};
