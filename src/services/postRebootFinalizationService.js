/*
 * NAVIGATION HEADER
 * FILE: src/services/postRebootFinalizationService.js
 * LAYER: Service layer
 * PURPOSE: Finalizes reboot/install flows into a clean, deterministic state.
 * LOOK HERE FIRST WHEN DEBUGGING: Search for finalizeSetupLaneAfterReboot.
 * RELATED FLOW: /trash-the-bot, /initialize-server, setup-wizard recovery.
 */

'use strict';

const wizardStateService = require('./wizardStateService');
const singleMessageWizardService = require('./singleMessageWizardService');

async function finalizeSetupLaneAfterReboot(guild, wizardChannel, payloadBuilder, opts = {}) {
  // Validation gate
  let validationGate;
  try { validationGate = require('./validationGateService'); } catch {}
  if (validationGate) {
    const preflight = validationGate.preflightForFlow('reboot-finalization', { guild, channel: wizardChannel });
    if (!preflight.ok) {
      console.warn('[REBOOT-FINALIZE] preflight failed:', preflight.failures.join(', '));
      // Non-blocking — still attempt recovery
    }
  }

  if (!guild || !wizardChannel) return { ok: false, reason: 'missing-channel' };

  const guide = await singleMessageWizardService.reconcileOrRecreate(
    wizardChannel,
    payloadBuilder,
    {
      action: 'post-reboot-wizard',
      deleteUserMessages: !!opts.deleteUserMessages,
      limit: opts.limit || 100,
    }
  );
  if (guide?.id) {
    wizardStateService.patch({
      activeMessageId: guide.id,
      installationMode: true,
      currentStep: opts.currentStep || wizardStateService.getCurrentStep() || 'flow',
      lastAdvancedAt: Date.now(),
      lastReconciledAt: Date.now(),
    });
    await singleMessageWizardService.cleanupLane(wizardChannel, guide.id, {
      deleteUserMessages: !!opts.deleteUserMessages,
      limit: opts.limit || 100,
    });
  }

  const result = { ok: !!guide, guideMessageId: guide?.id || null, channelId: wizardChannel.id };

  // Observability
  try {
    require('./observabilityService').recordFlowOutcome('post-reboot-finalization', {
      outcome: result.ok ? 'success' : 'failed',
      guideMessageId: result.guideMessageId,
    });
  } catch {}

  return result;
}

module.exports = { finalizeSetupLaneAfterReboot };
