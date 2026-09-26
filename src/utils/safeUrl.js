/*
 * NAVIGATION HEADER
 * FILE: src/utils/safeUrl.js
 * LAYER: Utility/helper layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: See nearby files in the same folder for related behavior.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

function normalizeCandidate(input) {
  if (input == null) return null;
  let value = String(input).trim();
  if (!value) return null;
  if (/^\/\//.test(value)) value = `https:${value}`;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    if (/^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(value)) value = `https://${value}`;
    else return null;
  }
  return value;
}

function safeUrl(input, opts = {}) {
  const candidate = normalizeCandidate(input);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    const allowedProtocols = opts.allowedProtocols || new Set(['http:', 'https:']);
    if (!allowedProtocols.has(url.protocol)) return null;
    return url;
  } catch (err) {
    if (opts.logger) {
      opts.logger.warn(`[safeUrl] rejected input=${JSON.stringify(String(input))} reason=${err?.message || err}`);
    }
    return null;
  }
}

function safeUrlString(input, opts = {}) {
  const url = safeUrl(input, opts);
  return url ? url.toString() : null;
}

module.exports = { safeUrl, safeUrlString, normalizeCandidate };
