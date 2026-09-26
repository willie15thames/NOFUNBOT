/*
 * NAVIGATION HEADER
 * FILE: src/services/accessPolicyService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { PermissionFlagsBits } = require('discord.js');
const state = require('../state');
const { COMM_ROLE, COMMISSIONER_IDS } = require('../config/env');

function normalizeId(value) {
  const clean = String(value || '').trim();
  return /^\d{15,20}$/.test(clean) ? clean : null;
}

function getCommissionerIds(extraIds = null) {
  const ids = new Set();
  for (const id of (COMMISSIONER_IDS || [])) {
    const clean = normalizeId(id);
    if (clean) ids.add(clean);
  }
  try {
    for (const id of (state?.commissionerIds || [])) {
      const clean = normalizeId(id);
      if (clean) ids.add(clean);
    }
  } catch {}
  for (const id of (extraIds || [])) {
    const clean = normalizeId(id);
    if (clean) ids.add(clean);
  }
  return ids;
}

function resolveCommissionerRoleId(guild, explicitRole = COMM_ROLE) {
  if (!guild?.roles?.cache) return null;
  const raw = String(explicitRole || '').trim();
  if (!raw) return null;
  if (guild.roles.cache.has(raw)) return raw;
  const byName = guild.roles.cache.find(role => String(role.name || '').toLowerCase() === raw.toLowerCase());
  return byName?.id || null;
}

function isCommissionerMember(member, opts = {}) {
  if (!member) return false;
  if (member.guild?.ownerId && String(member.id) === String(member.guild.ownerId)) return true;
  const commissionerIds = getCommissionerIds(opts.commissionerIds);
  if (commissionerIds.has(String(member.id))) return true;
  const commRoleId = opts.commRoleId === undefined ? COMM_ROLE : opts.commRoleId;
  const resolvedRoleId = resolveCommissionerRoleId(member.guild, commRoleId);
  if (resolvedRoleId && member.roles?.cache?.has?.(resolvedRoleId)) return true;
  return false;
}

function isElevatedMember(member, opts = {}) {
  if (!member) return false;
  if (isCommissionerMember(member, opts)) return true;
  if (opts.allowAdministrator !== false && member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  if (opts.allowManageGuild === true && member.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  return false;
}

function getStaffRoles(guild, opts = {}) {
  if (!guild?.roles?.cache) return new Map();
  const includeAdministrator = opts.includeAdministrator !== false;
  const includeManageGuild = opts.includeManageGuild === true;
  const includeRoleNameFallback = opts.includeRoleNameFallback === true;
  const resolvedCommRoleId = resolveCommissionerRoleId(guild, opts.commRoleId === undefined ? COMM_ROLE : opts.commRoleId);
  const ids = new Set();
  if (resolvedCommRoleId) ids.add(resolvedCommRoleId);
  for (const role of guild.roles.cache.values()) {
    if (!role || role.id === guild.roles.everyone.id) continue;
    if (includeAdministrator && role.permissions?.has?.(PermissionFlagsBits.Administrator)) ids.add(role.id);
    if (includeManageGuild && role.permissions?.has?.(PermissionFlagsBits.ManageGuild)) ids.add(role.id);
    if (includeRoleNameFallback && /(^|\b)(commissioner|commish|co-comm|co comm|admin)(\b|$)/i.test(String(role.name || ''))) ids.add(role.id);
  }
  return guild.roles.cache.filter(role => ids.has(role.id));
}

module.exports = {
  getCommissionerIds,
  resolveCommissionerRoleId,
  isCommissionerMember,
  isElevatedMember,
  getStaffRoles,
};
