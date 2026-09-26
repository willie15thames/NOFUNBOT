/*
 * NAVIGATION HEADER
 * FILE: src/services/workflowRegistryService.js
 * LAYER: Service layer
 * PURPOSE: Registers all high-value flows. Enables auditing, release impact analysis, and patch-note obligation tracking.
 * LOOK HERE FIRST WHEN DEBUGGING: Search for registerWorkflow and CORE_WORKFLOWS.
 * RELATED FLOW: release orchestration, validation, recovery, audits, persona arbiter.
 * NOTE: V184 — expanded with new flows from reliability hardening program.
 */

'use strict';

const registry = new Map();

const CORE_WORKFLOWS = [
  // P0 — Stop the bleeding
  { name: 'distributed-event-claim',      owner: 'eventClaimService',            trigger: 'messageCreate / messageUpdate / interactionCreate', notesRequired: false, priority: 'P0' },
  { name: 'persona-arbitration',           owner: 'personaArbiterService',        trigger: 'AI inbound route (messageCreate)', notesRequired: false, priority: 'P0' },
  { name: 'response-lifecycle',            owner: 'responseLifecycleService',     trigger: 'persona arbiter winner selected', notesRequired: false, priority: 'P0' },
  { name: 'response-guard',               owner: 'responseGuardService',         trigger: 'any AI route or interaction execution', notesRequired: false, priority: 'P0' },
  { name: 'setup-wizard-single-message',   owner: 'singleMessageWizardService',  trigger: 'wizard render / reboot / recovery', notesRequired: true, priority: 'P0' },
  { name: 'post-reboot-finalization',      owner: 'postRebootFinalizationService', trigger: 'trash-the-bot / initialize-server', notesRequired: true, priority: 'P0' },
  { name: 'release-orchestration',         owner: 'releaseOrchestrationService', trigger: 'patch complete', notesRequired: true, priority: 'P0' },

  // P1 — Make flows complete
  { name: 'validation-gate',              owner: 'validationGateService',        trigger: 'any flow preflight', notesRequired: false, priority: 'P1' },
  { name: 'recovery-self-heal',            owner: 'recoverySelfHealService',     trigger: 'missing tracked asset / startup', notesRequired: true, priority: 'P1' },
  { name: 'role-hierarchy-sync',           owner: 'roleHierarchySyncService',    trigger: 'setup complete / on-demand / schedule', notesRequired: true, priority: 'P1' },
  { name: 'state-ownership-audit',         owner: 'stateOwnershipMapService',    trigger: 'startup / on-demand', notesRequired: false, priority: 'P1' },

  // P1 — Prove operations
  { name: 'observability',                owner: 'observabilityService',         trigger: 'all flow outcomes', notesRequired: false, priority: 'P1' },
  { name: 'health-report',                owner: 'observabilityService',         trigger: 'on-demand / /health-report command', notesRequired: false, priority: 'P1' },
  { name: 'escalation',                   owner: 'escalationService',            trigger: 'critical failure / security event / threshold breach', notesRequired: false, priority: 'P1' },

  // V191 — Full workflow definitions (executable via workflowEngineService.run())
  { name: 'member-onboarding',            owner: 'flowDefinitions',              trigger: 'guildMemberAdd', notesRequired: false, priority: 'P1', executable: true },
  { name: 'member-departure',             owner: 'flowDefinitions',              trigger: 'guildMemberRemove', notesRequired: false, priority: 'P1', executable: true },
  { name: 'content-moderation',           owner: 'flowDefinitions',              trigger: 'messageCreate (every non-bot message)', notesRequired: false, priority: 'P1', executable: true },
  { name: 'community-provision',          owner: 'flowDefinitions',              trigger: '/setup-community slash command', notesRequired: true, priority: 'P1', executable: true },
  { name: 'scheduled-maintenance',        owner: 'flowDefinitions',              trigger: 'periodic timer (every 30 minutes)', notesRequired: false, priority: 'P1', executable: true },
  { name: 'role-sync',                    owner: 'flowDefinitions',              trigger: 'post-build / on-demand / scheduled', notesRequired: true, priority: 'P1', executable: true },
  { name: 'release-publish',              owner: 'flowDefinitions',              trigger: 'patch complete', notesRequired: true, priority: 'P1', executable: true },
  { name: 'server-build',                 owner: 'flowDefinitions',              trigger: 'bot_setup_initialize button', notesRequired: true, priority: 'P0', executable: true },
  { name: 'security-response',            owner: 'flowDefinitions',              trigger: 'injection/probe detection', notesRequired: false, priority: 'P0', executable: true },
  { name: 'post-build',                   owner: 'workflowEngineService',        trigger: 'after server build completes', notesRequired: false, priority: 'P0', executable: true },
  { name: 'post-trash',                   owner: 'workflowEngineService',        trigger: 'after trash-the-bot completes', notesRequired: false, priority: 'P0', executable: true },
  { name: 'post-league-reset',            owner: 'workflowEngineService',        trigger: 'after league reset completes', notesRequired: false, priority: 'P1', executable: true },

  // V195 — New flow definitions
  { name: 'active-check-cycle',           owner: 'flowDefinitions',              trigger: 'periodic timer (every hour)', notesRequired: false, priority: 'P1', executable: true },
  { name: 'member-warning',               owner: 'flowDefinitions',              trigger: '/warn-player, content moderation, active check miss', notesRequired: false, priority: 'P1', executable: true },
  { name: 'member-boot',                  owner: 'flowDefinitions',              trigger: '/ban, auto-boot, commissioner action', notesRequired: false, priority: 'P1', executable: true },
  { name: 'poll-lifecycle',               owner: 'flowDefinitions',              trigger: '/create-poll', notesRequired: false, priority: 'P1', executable: true },
  { name: 'reward-refresh',               owner: 'flowDefinitions',              trigger: '/refresh-rewards, post-game-result, periodic', notesRequired: false, priority: 'P1', executable: true },
  { name: 'schedule-advance',             owner: 'flowDefinitions',              trigger: '/advance-week, weekly automation timer', notesRequired: false, priority: 'P1', executable: true },
  { name: 'record-transaction',           owner: 'flowDefinitions',              trigger: '/transaction command', notesRequired: false, priority: 'P1', executable: true },
  { name: 'broadcast-send',               owner: 'flowDefinitions',              trigger: '/broadcasts command', notesRequired: false, priority: 'P1', executable: true },

  // V195 — Component flows
  { name: 'component-toggle',             owner: 'flowDefinitions',              trigger: '/toggle-feature command', notesRequired: false, priority: 'P1', executable: true },
  { name: 'mvp-vote',                     owner: 'flowDefinitions',              trigger: 'comp_mvp:: interaction', notesRequired: false, priority: 'P1', executable: true },
  { name: 'availability-update',          owner: 'flowDefinitions',              trigger: 'comp_avail:: interaction', notesRequired: false, priority: 'P1', executable: true },
  { name: 'game-result-submission',       owner: 'flowDefinitions',              trigger: 'comp_game_result_modal interaction', notesRequired: false, priority: 'P1', executable: true },
  { name: 'prediction-scoring',           owner: 'flowDefinitions',              trigger: 'week advance chain', notesRequired: false, priority: 'P1', executable: true },
];

for (const item of CORE_WORKFLOWS) registry.set(item.name, item);

function registerWorkflow(def = {}) {
  if (!def?.name) return false;
  registry.set(String(def.name), { ...def });
  return true;
}

function getWorkflow(name) {
  return registry.get(String(name)) || null;
}

function listWorkflows() {
  return [...registry.values()];
}

function listByPriority(priority) {
  return [...registry.values()].filter(w => w.priority === priority);
}

/**
 * Impact analysis: given a list of affected service names, return which workflows are impacted.
 */
function impactAnalysis(affectedServices = []) {
  const set = new Set(affectedServices.map(s => s.toLowerCase()));
  return [...registry.values()].filter(w => set.has(w.owner.toLowerCase()));
}

/**
 * Format the registry for Discord embed display.
 */
function formatRegistryEmbed() {
  const lines = ['**Workflow Registry**\n'];
  const byPriority = {};
  for (const w of registry.values()) {
    const p = w.priority || 'unset';
    if (!byPriority[p]) byPriority[p] = [];
    byPriority[p].push(w);
  }
  for (const p of ['P0', 'P1', 'P2', 'unset']) {
    if (!byPriority[p]?.length) continue;
    lines.push(`\n**${p}**`);
    for (const w of byPriority[p]) {
      lines.push(`▸ **${w.name}** → ${w.owner} | trigger: ${w.trigger} | notes: ${w.notesRequired ? '✅' : '—'}`);
    }
  }
  return lines.join('\n');
}

module.exports = { registerWorkflow, getWorkflow, listWorkflows, listByPriority, impactAnalysis, formatRegistryEmbed, CORE_WORKFLOWS };
