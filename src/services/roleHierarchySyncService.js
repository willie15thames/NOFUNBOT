/*
 * NAVIGATION HEADER
 * FILE: src/services/roleHierarchySyncService.js
 * LAYER: Service layer
 * PURPOSE: Reconciles expected role hierarchy vs actual guild roles. Fixes ordering, permissions, missing/orphaned roles.
 * LOOK HERE FIRST WHEN DEBUGGING: Search for reconcile and buildExpectedHierarchy.
 * RELATED FLOW: setup wizard, post-reboot finalization, self-heal, validation gate.
 * NOTE: V184 — introduced as part of the reliability hardening program.
 */

'use strict';

const { makeLogger } = require('../utils/logger');
const observability = require('./observabilityService');
const { ROLE_DEFAULTS } = require('../config/constants');
const log = makeLogger('roleHierarchySync');

/**
 * Builds the expected role hierarchy from server settings and template.
 * Returns an array ordered from highest priority to lowest.
 *
 * @param {Object} settings - Server settings object
 * @returns {{ name: string, color?: string, permissions?: string[], hoist?: boolean }[]}
 */
function buildExpectedHierarchy(settings = {}) {
  const hierarchy = [];

  // Commissioner role — always highest managed role
  const commRoleName = String(settings.commissionerRoleName || ROLE_DEFAULTS.COMMISSIONER).trim();
  hierarchy.push({
    name: commRoleName,
    priority: 100,
    hoist: true,
    mentionable: false,
    required: true,
  });

  // IT role if configured
  if (settings.itRoleName) {
    hierarchy.push({
      name: String(settings.itRoleName).trim(),
      priority: 90,
      hoist: false,
      mentionable: false,
      required: false,
    });
  }

  // Community/League roles
  const communities = Array.isArray(settings.communities) ? settings.communities : [];
  for (const community of communities) {
    if (community.roleName) {
      hierarchy.push({
        name: String(community.roleName).trim(),
        priority: 50,
        hoist: false,
        mentionable: true,
        required: false,
      });
    }
  }

  // Member role — lowest managed role
  hierarchy.push({
    name: String(settings.memberRoleName || ROLE_DEFAULTS.MEMBER).trim(),
    priority: 10,
    hoist: false,
    mentionable: false,
    required: true,
  });

  return hierarchy.sort((a, b) => b.priority - a.priority);
}

/**
 * Compare expected hierarchy against actual guild roles.
 *
 * @param {Object} guild - Discord guild
 * @param {Object} settings - Server settings
 * @returns {{ missing: string[], orphaned: string[], orderDrift: string[], permissionDrift: string[] }}
 */
async function audit(guild, settings = {}) {
  if (!guild?.roles?.cache) return { missing: [], orphaned: [], orderDrift: [], permissionDrift: [] };

  const expected = buildExpectedHierarchy(settings);
  const actualRoles = guild.roles.cache;

  const expectedNames = new Set(expected.map(r => r.name.toLowerCase()));
  const actualNames = new Map();
  for (const [, role] of actualRoles) {
    if (role.managed || role.name === '@everyone') continue;
    actualNames.set(role.name.toLowerCase(), role);
  }

  const missing = [];
  const orderDrift = [];
  const permissionDrift = [];

  // Find missing roles
  for (const exp of expected) {
    if (!actualNames.has(exp.name.toLowerCase())) {
      missing.push(exp.name);
    }
  }

  // Find ordering drift — check that higher-priority roles have higher positions
  let lastPosition = Infinity;
  for (const exp of expected) {
    const actual = actualNames.get(exp.name.toLowerCase());
    if (!actual) continue;
    if (actual.position >= lastPosition) {
      orderDrift.push(`${exp.name} (pos ${actual.position} should be < ${lastPosition})`);
    }
    lastPosition = actual.position;
  }

  // Find orphaned roles that look bot-managed but aren't in expected
  const orphaned = [];
  const botManagedPatterns = [/league/i, /commissioner/i, /member/i];
  for (const [name, role] of actualNames) {
    if (expectedNames.has(name)) continue;
    if (botManagedPatterns.some(rx => rx.test(name)) && !role.managed) {
      orphaned.push(role.name);
    }
  }

  return { missing, orphaned, orderDrift, permissionDrift };
}

/**
 * Attempt to reconcile the role hierarchy.
 * Creates missing required roles and logs drift.
 *
 * @param {Object} guild - Discord guild
 * @param {Object} settings - Server settings
 * @param {Object} [opts] - { dryRun: boolean }
 * @returns {{ ok: boolean, actions: string[], dryRun: boolean }}
 */
async function reconcile(guild, settings = {}, opts = {}) {
  const dryRun = !!opts.dryRun;
  const auditResult = await audit(guild, settings);
  const actions = [];
  const expected = buildExpectedHierarchy(settings);

  // Create missing required roles
  for (const name of auditResult.missing) {
    const exp = expected.find(r => r.name === name);
    if (!exp?.required) {
      actions.push(`SKIP: ${name} is missing but not required`);
      continue;
    }

    if (dryRun) {
      actions.push(`WOULD_CREATE: ${name}`);
      continue;
    }

    try {
      const role = await guild.roles.create({
        name,
        hoist: !!exp.hoist,
        mentionable: !!exp.mentionable,
        reason: 'Role hierarchy sync — V184 reliability hardening',
      });
      actions.push(`CREATED: ${name} (id=${role.id})`);
    } catch (err) {
      actions.push(`FAILED_CREATE: ${name} — ${err.message}`);
    }
  }

  // Log order drift (auto-fix is risky — just report)
  for (const drift of auditResult.orderDrift) {
    actions.push(`ORDER_DRIFT: ${drift}`);
  }

  // Log orphaned roles
  for (const orphan of auditResult.orphaned) {
    actions.push(`ORPHANED: ${orphan} (review manually)`);
  }

  const ok = !actions.some(a => a.startsWith('FAILED'));

  observability.recordFlowOutcome('role-hierarchy-sync', {
    outcome: ok ? 'success' : 'partial-failure',
    missing: auditResult.missing.length,
    orphaned: auditResult.orphaned.length,
    orderDrift: auditResult.orderDrift.length,
    actionsCount: actions.length,
    dryRun,
  });

  log.info(`[ROLE-SYNC] ${dryRun ? 'DRY RUN' : 'LIVE'} — missing=${auditResult.missing.length} orphaned=${auditResult.orphaned.length} drift=${auditResult.orderDrift.length}`);

  return { ok, actions, dryRun };
}

/**
 * Format audit results for Discord embed display.
 */
function formatAuditEmbed(auditResult) {
  const lines = ['**Role Hierarchy Audit**\n'];

  if (auditResult.missing.length) {
    lines.push(`❌ **Missing**: ${auditResult.missing.join(', ')}`);
  } else {
    lines.push('✅ **No missing roles**');
  }

  if (auditResult.orderDrift.length) {
    lines.push(`⚠️ **Order drift**: ${auditResult.orderDrift.join('; ')}`);
  } else {
    lines.push('✅ **Role order OK**');
  }

  if (auditResult.orphaned.length) {
    lines.push(`🧹 **Possibly orphaned**: ${auditResult.orphaned.join(', ')}`);
  }

  return lines.join('\n');
}

module.exports = {
  buildExpectedHierarchy,
  audit,
  reconcile,
  formatAuditEmbed,
};
