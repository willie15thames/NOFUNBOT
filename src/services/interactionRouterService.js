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
  // Autocomplete has a different acknowledgement contract: only respond() is valid.
  // Never bind chat-input reply methods onto autocomplete interactions.
  if (interaction.isAutocomplete?.()) return interaction;
  interaction.__nofunSafeWrapped = true;

  const bind = (name) => typeof interaction[name] === 'function' ? interaction[name].bind(interaction) : null;
  const orig = {
    reply: bind('reply'),
    followUp: bind('followUp'),
    editReply: bind('editReply'),
    deferReply: bind('deferReply'),
    update: bind('update'),
    deferUpdate: bind('deferUpdate'),
    showModal: bind('showModal'),
  };

  interaction.reply = async (payload) => {
    try {
      const normalized = _normalizePayload(payload, 'reply');
      if (responseGuard.isInteractionSettled(interaction)) return null;
      if (interaction.replied || interaction.deferred) {
        const out = await orig.followUp(normalized);
        interaction.__nofunFinalized = true;
        responseGuard.markInteractionSettled(interaction);
        return out;
      }
      const res = await orig.reply(normalized);
      interaction.__nofunFinalized = true;
      responseGuard.markInteractionSettled(interaction);
      return res;
    } catch (err) {
      if (_isAckErr(err)) return null;
      throw err;
    }
  };

  interaction.deferReply = async (payload) => {
    try {
      const normalized = _normalizePayload(payload, 'deferReply');
      if (responseGuard.isInteractionSettled(interaction) || interaction.replied || interaction.deferred) return true;
      const res = await orig.deferReply(normalized);
      interaction.__nofunAckType = 'deferReply';
      return res;
    } catch (err) {
      if (_isAckErr(err)) return true;
      throw err;
    }
  };

  interaction.editReply = async (payload) => {
    try {
      const normalized = _normalizePayload(payload, 'editReply');
      if (responseGuard.isInteractionSettled(interaction) && !(interaction.replied || interaction.deferred)) return null;
      if (interaction.replied || interaction.deferred) {
        const out = await orig.editReply(normalized);
        interaction.__nofunFinalized = true;
        return out;
      }
      const res = await orig.reply(normalized);
      interaction.__nofunFinalized = true;
      responseGuard.markInteractionSettled(interaction);
      return res;
    } catch (err) {
      if (_isAckErr(err)) return null;
      throw err;
    }
  };

  interaction.followUp = async (payload) => {
    try {
      const normalized = _normalizePayload(payload, 'followUp');
      if (responseGuard.isInteractionSettled(interaction)) return null;
      if (interaction.replied || interaction.deferred) {
        const out = await orig.followUp(normalized);
        interaction.__nofunFinalized = true;
        responseGuard.markInteractionSettled(interaction);
        return out;
      }
      const res = await orig.reply(normalized);
      responseGuard.markInteractionSettled(interaction);
      return res;
    } catch (err) {
      if (_isAckErr(err)) return null;
      throw err;
    }
  };

  if (orig.update) {
    interaction.update = async (payload) => {
      try {
        const normalized = _normalizePayload(payload, 'update');
        if (responseGuard.isInteractionSettled(interaction) && !(interaction.replied || interaction.deferred)) return null;
        if (interaction.replied || interaction.deferred) {
          const out = await orig.editReply(normalized);
          interaction.__nofunFinalized = true;
          return out;
        }
        const res = await orig.update(normalized);
        interaction.__nofunFinalized = true;
        responseGuard.markInteractionSettled(interaction);
        return res;
      } catch (err) {
        if (_isAckErr(err)) return null;
        throw err;
      }
    };
  }

  if (orig.deferUpdate) {
    interaction.deferUpdate = async () => {
      try {
        if (responseGuard.isInteractionSettled(interaction) || interaction.replied || interaction.deferred) return true;
        const res = await orig.deferUpdate();
        interaction.__nofunAckType = 'deferUpdate';
        return res;
      } catch (err) {
        if (_isAckErr(err)) return true;
        throw err;
      }
    };
  }

  if (orig.showModal) {
    interaction.showModal = async (payload) => {
      try {
        if (responseGuard.isInteractionSettled(interaction) || interaction.replied || interaction.deferred) return null;
        const res = await orig.showModal(payload);
        interaction.__nofunFinalized = true;
        responseGuard.markInteractionSettled(interaction);
        return res;
      } catch (err) {
        if (_isAckErr(err)) return null;
        throw err;
      }
    };
  }

  return interaction;
}

async function safeInitialReply(interaction, payload) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(_normalizePayload(payload, 'followUp'));
  }
  return interaction.reply(_normalizePayload(payload, 'reply'));
}

async function safeDeferred(interaction, payload) {
  if (interaction.replied || interaction.deferred) {
    return true;
  }
  await interaction.deferReply(typeof payload === 'object' ? _normalizePayload(payload, 'deferReply') : undefined);
  return true;
}

async function safeEdit(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(_normalizePayload(payload, 'editReply'));
  }
  return interaction.reply(_normalizePayload(payload, 'reply'));
}


async function safeAcknowledge(interaction, opts = {}) {
  const preferUpdate = !!opts.preferUpdate;
  const ephemeral = opts.ephemeral !== false;
  if (!interaction || interaction.replied || interaction.deferred) return true;
  try {
    if (preferUpdate && interaction.deferUpdate) {
      await interaction.deferUpdate();
      return true;
    }
    await interaction.reply(ephemeral ? { content: '⏳ Working...', flags: 64 } : { content: '⏳ Working...' });
    return true;
  } catch (err) {
    if (_isAckErr(err)) return true;
    try {
      await interaction.deferReply(ephemeral ? { flags: 64 } : undefined);
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
