/*
 * NAVIGATION HEADER
 * FILE: src/services/ai/anthropicService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
const Anthropic = require('@anthropic-ai/sdk');
const { ANTHROPIC_API_KEY, AI_PROVIDER, AI_ENABLED, ANTHROPIC_MODEL_FAST, ANTHROPIC_MODEL_SMART, AI_TIMEOUT_MS } = require('../../config/env');

const RAILWAY_TIMEOUT_MS = Number.isFinite(AI_TIMEOUT_MS) && AI_TIMEOUT_MS > 0 ? AI_TIMEOUT_MS : 22000;
function isPlaceholderApiKey(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return false;
  return ['your_anthropic_api_key', 'anthropic_api_key', 'replace_me', 'changeme', 'change_me'].includes(v)
    || v.includes('your-anthropic-api-key');
}
const EFFECTIVE_API_KEY = isPlaceholderApiKey(ANTHROPIC_API_KEY) ? null : ANTHROPIC_API_KEY;
const AI_READY = AI_ENABLED && AI_PROVIDER === 'anthropic' && !!EFFECTIVE_API_KEY;
// NOFUNBOT owns retry/cancellation so SDK-level retries cannot overlap an application retry.
const client = AI_READY ? new Anthropic({ apiKey: EFFECTIVE_API_KEY, timeout: RAILWAY_TIMEOUT_MS, maxRetries: 0 }) : null;
const { runWithAIRetry } = require('./aiRuntimeOrchestrator');
const MODELS = { FAST: ANTHROPIC_MODEL_FAST, SMART: ANTHROPIC_MODEL_SMART };

function getAIStatus() {
  if (!AI_ENABLED) return { ready: false, provider: AI_PROVIDER, reason: 'disabled_by_config' };
  if (AI_PROVIDER !== 'anthropic') return { ready: false, provider: AI_PROVIDER, reason: 'unsupported_provider' };
  if (isPlaceholderApiKey(ANTHROPIC_API_KEY)) return { ready: false, provider: AI_PROVIDER, reason: 'placeholder_api_key' };
  if (!ANTHROPIC_API_KEY) return { ready: false, provider: AI_PROVIDER, reason: 'missing_api_key' };
  return { ready: true, provider: AI_PROVIDER, reason: 'ready' };
}

function isAIReady() {
  return AI_READY;
}

async function aiCall(params, retries = 2, runtime = {}) {
  if (!client) {
    const status = getAIStatus();
    const err = new Error(`AI_DISABLED: ${status.reason}`);
    err.code = 'AI_DISABLED';
    throw err;
  }
  const attempts = Math.max(1, Number(retries) || 1);
  return runWithAIRetry({
    timeoutMs: RAILWAY_TIMEOUT_MS,
    attempts,
    requestId: runtime.requestId || null,
    request: ({ signal }) => client.messages.create(params, { signal }),
  });
}

module.exports = { aiCall, MODELS, RAILWAY_TIMEOUT_MS, isAIReady, getAIStatus, isPlaceholderApiKey };
