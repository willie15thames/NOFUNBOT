/*
 * NAVIGATION HEADER
 * FILE: src/services/ai/aiRuntimeOrchestrator.js
 * LAYER: AI runtime / availability boundary
 * PURPOSE: Owns AI attempt timeouts, cancellation, retry eligibility, and attempt metadata.
 * INVARIANT: There is exactly one NOFUNBOT timeout owner for an AI attempt. Callers do not Promise.race
 *            a second timeout against the SDK request.
 */
'use strict';

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function isRetryableAIError(err) {
  if (!err) return false;
  if (err.code === 'AI_TIMEOUT' || err.name === 'AbortError') return false;
  return err.status === 429 || err.status === 529 || /overloaded|rate\s*limit/i.test(String(err.message || ''));
}

async function runAIAttempt({ request, timeoutMs, attempt = 1, requestId = null }) {
  if (typeof request !== 'function') throw new TypeError('request must be a function');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('AI_TIMEOUT'));
  }, timeoutMs);
  timer.unref?.();

  try {
    return await request({ signal: controller.signal, attempt, requestId });
  } catch (err) {
    if (timedOut || err?.name === 'AbortError' || controller.signal.aborted) {
      const timeout = new Error(`AI_TIMEOUT: call exceeded ${timeoutMs}ms budget`);
      timeout.code = 'AI_TIMEOUT';
      timeout.cause = err;
      timeout.attempt = attempt;
      timeout.requestId = requestId;
      throw timeout;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function runWithAIRetry({ request, timeoutMs, attempts = 2, retryDelayMs = 1500, requestId = null }) {
  const maxAttempts = Math.max(1, Number(attempts) || 1);
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await runAIAttempt({ request, timeoutMs, attempt, requestId });
    } catch (err) {
      lastError = err;
      if (!isRetryableAIError(err) || attempt >= maxAttempts) throw err;
      await sleep(retryDelayMs);
    }
  }
  throw lastError || new Error('AI_EXHAUSTED: all attempts failed');
}

module.exports = { runAIAttempt, runWithAIRetry, isRetryableAIError };
