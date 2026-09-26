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
const AI_READY = AI_ENABLED && AI_PROVIDER === 'anthropic' && !!ANTHROPIC_API_KEY;
const client = AI_READY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: RAILWAY_TIMEOUT_MS, maxRetries: 1 }) : null;
const MODELS = { FAST: ANTHROPIC_MODEL_FAST, SMART: ANTHROPIC_MODEL_SMART };

function getAIStatus() {
  if (!AI_ENABLED) return { ready: false, provider: AI_PROVIDER, reason: 'disabled_by_config' };
  if (AI_PROVIDER !== 'anthropic') return { ready: false, provider: AI_PROVIDER, reason: 'unsupported_provider' };
  if (!ANTHROPIC_API_KEY) return { ready: false, provider: AI_PROVIDER, reason: 'missing_api_key' };
  return { ready: true, provider: AI_PROVIDER, reason: 'ready' };
}

function isAIReady() {
  return AI_READY;
}

async function aiCall(params, retries = 2) {
  if (!client) {
    const status = getAIStatus();
    const err = new Error(`AI_DISABLED: ${status.reason}`);
    err.code = 'AI_DISABLED';
    throw err;
  }
  for (let i = 0; i < retries; i += 1) {
    try {
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('AI_TIMEOUT: call exceeded Railway budget')), RAILWAY_TIMEOUT_MS));
      return await Promise.race([client.messages.create(params), timeoutPromise]);
    } catch (err) {
      const isTimeout = err?.message?.startsWith('AI_TIMEOUT');
      const isOverload = err?.status === 529 || err?.status === 429 || err?.message?.includes('overloaded');
      if (isOverload && !isTimeout && i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        continue;
      }
      throw err;
    }
  }
  // Should never reach here — throw so callers don't crash on null.content[0]
  throw new Error('AI_EXHAUSTED: all retries failed without a result');
}

module.exports = { aiCall, MODELS, RAILWAY_TIMEOUT_MS, isAIReady, getAIStatus };
