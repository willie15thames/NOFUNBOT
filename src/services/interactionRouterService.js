/*
 * NAVIGATION HEADER
 * FILE: src/services/interactionRouterService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
const interactionExecution = require('./interactionExecutionContext');

const responseGuard = require('./responseGuardService');

function _isAckErr(err) {
  const msg = String(err?.message || err || '');
  return /already been acknowledged|Unknown interaction|Invalid Form Body|INTERACTION_NOT_REPLIED|40060|10062/i.test(msg);
}

function _normalizePayload(payload, mode = 'reply') {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const clone = { ...payload };
  const flags = clone.flags;
  const wantsEphemeral = flags === 64 || String(flags).toLowerCase() === 'ephemeral' || clone.ephemeral === true;

  if (wantsEphemeral) {
    clone.flags = 64;
    delete clone.ephemeral;
  }
  if (clone.content == null && !clone.embeds && !clone.components && !clone.files && !clone.attachments) {
    delete clone.content;
  }
  return clone;
}

function protectInteraction(interaction) {
  if (!interaction || interaction.__nofunSafeWrapped) return interaction;
  // Autocomplete is intentionally isolated: only respond() is legal there.
  if (interaction.isAutocomplete?.()) return interaction;
  interaction.__nofunSafeWrapped = true;
  // Force construction now so raw Discord methods are captured once by the canonical adapter.
  interactionExecution.for(interaction);
  return interaction;
}

async function safeInitialReply(interaction, payload) {
  if (interaction.replied || interaction.deferred) {
    return interactionExecution.for(interaction).followUp(_normalizePayload(payload, 'followUp'));
  }
  return interactionExecution.for(interaction).reply(_normalizePayload(payload, 'reply'));
}

async function safeDeferred(interaction, payload) {
  if (interaction.replied || interaction.deferred) {
    return true;
  }
  await interactionExecution.for(interaction).deferReply(typeof payload === 'object' ? _normalizePayload(payload, 'deferReply') : undefined);
  return true;
}

async function safeEdit(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    return interactionExecution.for(interaction).editReply(_normalizePayload(payload, 'editReply'));
  }
  return interactionExecution.for(interaction).reply(_normalizePayload(payload, 'reply'));
}


async function safeAcknowledge(interaction, opts = {}) {
  const preferUpdate = !!opts.preferUpdate;
  const ephemeral = opts.ephemeral !== false;
  if (!interaction || interaction.replied || interaction.deferred) return true;
  try {
    if (preferUpdate && interaction.deferUpdate) {
      await interactionExecution.for(interaction).deferUpdate();
      return true;
    }
    await interactionExecution.for(interaction).reply(ephemeral ? { content: '⏳ Working...', flags: 64 } : { content: '⏳ Working...' });
    return true;
  } catch (err) {
    if (_isAckErr(err)) return true;
    try {
      await interactionExecution.for(interaction).deferReply(ephemeral ? { flags: 64 } : undefined);
      return true;
    } catch (err2) {
      if (_isAckErr(err2)) return true;
      throw err2;
    }
  }
}


async function safeAutocompleteRespond(interaction, choices = []) {
  if (!interaction?.isAutocomplete?.() || typeof interaction.respond !== 'function') return false;
  const bounded = Array.isArray(choices) ? choices.slice(0, 25).map(choice => ({
    name: String(choice?.name ?? choice?.label ?? choice?.value ?? 'Option').slice(0, 100),
    value: String(choice?.value ?? '').slice(0, 100),
  })) : [];
  try {
    await interaction.respond(bounded);
    return true;
  } catch (err) {
    // Unknown/expired interactions cannot be recovered with reply/followUp.
    if (_isAckErr(err)) return false;
    throw err;
  }
}

module.exports = {
  protectInteraction,
  safeInitialReply,
  safeDeferred,
  safeEdit,
  safeAcknowledge,
  safeAutocompleteRespond,
};
