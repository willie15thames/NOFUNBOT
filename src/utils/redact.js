/*
 * Shared secret redaction boundary for logs, incidents, and optional Discord logging.
 * This is intentionally conservative: false-positive redaction is preferable to leaking a secret.
 */
'use strict';

const SECRET_KEY_RX = /(?:api[_-]?key|token|secret|password|authorization|cookie|webhook[_-]?secret|provider[_-]?secret|database[_-]?url|redis[_-]?url)/i;

function redactString(value, max = 4000) {
  let s = String(value ?? '');
  s = s
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/rediss?:\/\/[^\s"'`]+/gi, '[REDACTED_REDIS_URL]')
    .replace(/(authorization\s*[:=]\s*)(bearer\s+)?[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password|webhook[_-]?secret|provider[_-]?secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_KEY]')
    .replace(/\b[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_TOKEN]');
  return max ? s.slice(0, max) : s;
}

function redactValue(value, { depth = 0, maxDepth = 6, seen = new WeakSet() } = {}) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value;
  if (value instanceof Error) {
    return { name: redactString(value.name, 120), message: redactString(value.message, 1000), stack: redactString(value.stack || '', 4000) };
  }
  if (typeof value !== 'object') return redactString(value);
  if (depth >= maxDepth) return '[TRUNCATED_OBJECT]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) return value.slice(0, 100).map(v => redactValue(v, { depth: depth + 1, maxDepth, seen }));
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SECRET_KEY_RX.test(key) ? '[REDACTED]' : redactValue(v, { depth: depth + 1, maxDepth, seen });
  }
  return out;
}

module.exports = { redactString, redactValue, SECRET_KEY_RX };
