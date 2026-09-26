/*
 * NAVIGATION HEADER
 * FILE: src/microservices/serverOperatingSystemMicroservice.js
 * LAYER: Operational microservice layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually coordinates larger multi-step operations and touches several services.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

module.exports = {
  key: 'serverOperatingSystem',
  label: 'Phase 2 · Server Operating System',
  async start({ guild, logger }) {
    logger.info('Starting Phase 2 · Server Operating System');
    const wizardPrefs = require('../services/wizardPreferencesService');
    const wizardStateService = require('../services/wizardStateService');
    const router = require('../routing/interactionRouter');
    const prefs = wizardPrefs.getPrefs();
    const wizardState = wizardStateService.getState();

    await require('../services/patchNotesService').publishPatchNotes(guild).catch(() => null);

    let wizardChannel = null;
    if (wizardState.installationMode) {
      const starterChannel = await router.ensureSetupWizardChannel(guild, { reveal: true }).catch(() => null);
      await router.ensureSetupWizardStarterMessage?.(starterChannel, 'Installation mode detected on startup. Setup is waiting in this lane.').catch(() => null);
      wizardChannel = await router.postSetupWizardMessage(guild, 'Installation mode detected on startup. The setup wizard was refreshed automatically.').catch(() => null);
    }

    logger.info(`Phase 2 complete ✅ installationMode=${wizardState.installationMode ? 'yes' : 'no'}`);
    return { prefs, wizardState, wizardChannel };
  },
};
