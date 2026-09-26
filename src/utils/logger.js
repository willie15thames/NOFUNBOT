/*
 * NAVIGATION HEADER
 * FILE: src/utils/logger.js
 * LAYER: Utility/helper layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: See nearby files in the same folder for related behavior.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_LEVEL = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;
const LOG_FORMAT = String(process.env.LOG_FORMAT || 'pretty').toLowerCase();

// RUN_ID: unique per process start — ties all logs from one boot together
const RUN_ID = process.env.RUN_ID || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// Active context — set per interaction/job to correlate logs
let _activeInteractionId = null;
let _activeJobId = null;

function setInteractionContext(interactionId) { _activeInteractionId = interactionId || null; }
function setJobContext(jobId) { _activeJobId = jobId || null; }
function clearContext() { _activeInteractionId = null; _activeJobId = null; }

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function normalizeArgs(args) {
  return args.map(value => {
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    if (typeof value === 'object' && value !== null) return value;
    return String(value);
  });
}

function log(level, module, ...args) {
  if (LEVELS[level] < LOG_LEVEL) return;
  const normalized = normalizeArgs(args);

  if (LOG_FORMAT === 'json') {
    const payload = {
      ts: new Date().toISOString(),
      runId: RUN_ID,
      ..._activeInteractionId ? { interactionId: _activeInteractionId } : {},
      ..._activeJobId ? { jobId: _activeJobId } : {},
      level,
      module,
      msg: normalized.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join(' '),
      data: normalized,
    };
    const line = JSON.stringify(payload);
    if (level === 'error') return console.error(line);
    if (level === 'warn') return console.warn(line);
    return console.log(line);
  }

  // Pretty format — include interaction/job IDs when present
  const ctxParts = [];
  if (_activeInteractionId) ctxParts.push(`ix=${_activeInteractionId}`);
  if (_activeJobId) ctxParts.push(`job=${_activeJobId}`);
  const ctx = ctxParts.length ? ` {${ctxParts.join(' ')}}` : '';
  const prefix = `[${timestamp()}] [${level.toUpperCase().padEnd(5)}] [${module}]${ctx}`;
  if (level === 'error') console.error(prefix, ...normalized);
  else if (level === 'warn') console.warn(prefix, ...normalized);
  else console.log(prefix, ...normalized);
}

function makeLogger(module) {
  return {
    info:  (...a) => log('info',  module, ...a),
    warn:  (...a) => log('warn',  module, ...a),
    error: (...a) => log('error', module, ...a),
    debug: (...a) => log('debug', module, ...a),
    child: (suffix) => makeLogger(`${module}:${suffix}`),
  };
}

module.exports = { makeLogger, RUN_ID, setInteractionContext, setJobContext, clearContext };
