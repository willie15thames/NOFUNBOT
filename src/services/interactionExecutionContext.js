'use strict';

// Canonical Discord interaction acknowledgement/settlement adapter.
// Autocomplete remains isolated and must use interaction.respond() via safeAutocompleteRespond.
const responseGuard = require('./responseGuardService');
const contexts = new WeakMap();

function isAckError(err) {
  const msg = String(err?.message || err || '');
  return /already been acknowledged|Unknown interaction|Invalid Form Body|INTERACTION_NOT_REPLIED|40060|10062/i.test(msg);
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const clone = { ...payload };
  const flags = clone.flags;
  if (flags === 64 || String(flags).toLowerCase() === 'ephemeral' || clone.ephemeral === true) {
    clone.flags = 64;
    delete clone.ephemeral;
  }
  if (clone.content == null && !clone.embeds && !clone.components && !clone.files && !clone.attachments) delete clone.content;
  return clone;
}

class InteractionExecutionContext {
  constructor(interaction) {
    if (!interaction || (typeof interaction !== 'object' && typeof interaction !== 'function')) {
      const err = new TypeError('interaction object required'); err.code = 'INVALID_INTERACTION'; throw err;
    }
    this.interaction = interaction;
    this.raw = Object.freeze({
      reply: typeof interaction.reply === 'function' ? interaction.reply.bind(interaction) : null,
      followUp: typeof interaction.followUp === 'function' ? interaction.followUp.bind(interaction) : null,
      editReply: typeof interaction.editReply === 'function' ? interaction.editReply.bind(interaction) : null,
      deferReply: typeof interaction.deferReply === 'function' ? interaction.deferReply.bind(interaction) : null,
      update: typeof interaction.update === 'function' ? interaction.update.bind(interaction) : null,
      deferUpdate: typeof interaction.deferUpdate === 'function' ? interaction.deferUpdate.bind(interaction) : null,
      showModal: typeof interaction.showModal === 'function' ? interaction.showModal.bind(interaction) : null,
    });
    this.initialKind = interaction.deferred ? 'deferred' : interaction.replied ? 'replied' : null;
    this.settledAt = this.initialKind ? Date.now() : null;
  }
  _mark(kind, terminal = false) {
    if (!this.initialKind) this.initialKind = kind;
    this.settledAt = Date.now();
    if (terminal) { this.interaction.__nofunFinalized = true; responseGuard.markInteractionSettled(this.interaction); }
  }
  _acknowledged() { return !!(this.interaction.deferred || this.interaction.replied || this.initialKind); }
  state() { return Object.freeze({ acknowledged:this._acknowledged(), deferred:!!this.interaction.deferred, replied:!!this.interaction.replied, initialKind:this.initialKind, settledAt:this.settledAt }); }

  async reply(payload) {
    try {
      const body=normalizePayload(payload);
      if (responseGuard.isInteractionSettled(this.interaction)) return null;
      if (this._acknowledged() && this.raw.followUp) { const out=await this.raw.followUp(body); this._mark(this.initialKind||'followUp',true); return out; }
      if (!this.raw.reply) return null;
      const out=await this.raw.reply(body); this._mark('reply',true); return out;
    } catch(e){ if(isAckError(e)) return null; throw e; }
  }
  async deferReply(options) {
    try {
      if (responseGuard.isInteractionSettled(this.interaction) || this._acknowledged()) return true;
      if (!this.raw.deferReply) return true;
      const out=await this.raw.deferReply(normalizePayload(options)); this.interaction.__nofunAckType='deferReply'; this._mark('deferReply'); return out;
    } catch(e){ if(isAckError(e)) return true; throw e; }
  }
  async deferUpdate() {
    try {
      if (responseGuard.isInteractionSettled(this.interaction) || this._acknowledged()) return true;
      if (!this.raw.deferUpdate) return true;
      const out=await this.raw.deferUpdate(); this.interaction.__nofunAckType='deferUpdate'; this._mark('deferUpdate'); return out;
    } catch(e){ if(isAckError(e)) return true; throw e; }
  }
  async editReply(payload) {
    try {
      const body=normalizePayload(payload);
      if (this._acknowledged() && this.raw.editReply) { const out=await this.raw.editReply(body); this._mark(this.initialKind||'editReply'); return out; }
      return this.reply(body);
    } catch(e){ if(isAckError(e)) return null; throw e; }
  }
  async update(payload) {
    try {
      const body=normalizePayload(payload);
      if (this._acknowledged() && this.raw.editReply) { const out=await this.raw.editReply(body); this._mark(this.initialKind||'update'); return out; }
      if (!this.raw.update) return this.reply(body);
      const out=await this.raw.update(body); this._mark('update',true); return out;
    } catch(e){ if(isAckError(e)) return null; throw e; }
  }
  async followUp(payload) {
    try {
      const body=normalizePayload(payload);
      if (responseGuard.isInteractionSettled(this.interaction)) return null;
      if (this._acknowledged() && this.raw.followUp) { const out=await this.raw.followUp(body); this._mark(this.initialKind||'followUp',true); return out; }
      return this.reply(body);
    } catch(e){ if(isAckError(e)) return null; throw e; }
  }
  async showModal(payload) {
    try {
      if (responseGuard.isInteractionSettled(this.interaction) || this._acknowledged() || !this.raw.showModal) return null;
      const out=await this.raw.showModal(payload); this._mark('showModal',true); return out;
    } catch(e){ if(isAckError(e)) return null; throw e; }
  }
}

function forInteraction(interaction) { let ctx=contexts.get(interaction); if(!ctx){ctx=new InteractionExecutionContext(interaction);contexts.set(interaction,ctx);} return ctx; }
module.exports = { InteractionExecutionContext, for: forInteraction, isAckError, normalizePayload };
