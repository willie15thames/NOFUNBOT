'use strict';

// Narrow bridge that keeps message handlers independent from interactionRouter.
// The router registers the concrete renderer during init; callers depend only on this stable port.
let postMessage = null;

function register({ postSetupWizardMessage } = {}) {
  if (postSetupWizardMessage != null && typeof postSetupWizardMessage !== 'function') {
    const err = new TypeError('postSetupWizardMessage must be a function');
    err.code = 'INVALID_SETUP_WIZARD_PORT';
    throw err;
  }
  postMessage = postSetupWizardMessage || null;
}

async function post(guild, note = '', opts = {}) {
  if (!postMessage) {
    const err = new Error('Setup wizard renderer is not registered');
    err.code = 'SETUP_WIZARD_PORT_UNAVAILABLE';
    throw err;
  }
  return postMessage(guild, note, opts);
}

function resetForTests() { postMessage = null; }

module.exports = { register, post, resetForTests };
