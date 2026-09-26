/*
 * NAVIGATION HEADER
 * FILE: src/actions/actionValidator.js
 * LAYER: AI action layer (V202, audit §28 "output format" + "silent unknown action")
 * PURPOSE: One strict contract for AI output and actions.
 *   parseModelOutput(text): accepted forms are EXACTLY (a) a raw JSON object, or (b) one ```json fenced JSON object.
 *     Pure prose with no "{" is treated as a conversation reply with ZERO actions (deterministic fallback — nothing
 *     can execute). Anything else is 'invalid' and nothing executes.
 *   validatePlan(obj): top-level { actions:[], reply:"", requiresConfirmation:false }. Legacy fields (thoughts,
 *     confidence) are ignored — never used for execution or authorization (rule 33/34).
 *   validateAction(raw): type must be registered; fields must match the catalog schema; unknown fields are
 *     rejected with a structured 'invalid_fields' result; unregistered types return 'unsupported_action'.
 * LOOK HERE FIRST WHEN DEBUGGING: validateAction(), validatePlan(), parseModelOutput().
 */

'use strict';

const catalog = require('./actionCatalog');

const MAX_ACTIONS_PER_PLAN = 5;
const MAX_REPLY = 1900;

function _sanitizeString(v, max) {
  let s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (max) s = s.slice(0, max);
  return s.trim();
}

function _checkField(name, spec, value) {
  if (spec.type === 'string') {
    if (typeof value !== 'string') return `${name} must be a string`;
    const v = _sanitizeString(value, spec.maxLength ? spec.maxLength + 1 : 4000);
    if (spec.maxLength && v.length > spec.maxLength) return `${name} exceeds ${spec.maxLength} characters`;
    if (spec.required && !v) return `${name} is empty`;
    if (spec.pattern && v && !spec.pattern.test(v)) return `${name} has an invalid format`;
    return { value: v };
  }
  if (spec.type === 'integer') {
    const n = typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : value;
    if (!Number.isInteger(n)) return `${name} must be an integer`;
    if (spec.min != null && n < spec.min) return `${name} must be ≥ ${spec.min}`;
    if (spec.max != null && n > spec.max) return `${name} must be ≤ ${spec.max}`;
    return { value: n };
  }
  if (spec.type === 'boolean') {
    if (typeof value !== 'boolean') return `${name} must be true or false`;
    return { value };
  }
  return `${name} has an unsupported schema type`;
}

/**
 * @returns {{ok:true, action:{type:string, fields:object}, def:object}|{ok:false, code:'unsupported_action'|'invalid_fields'|'invalid_action', type:string|null, reason:string}}
 */
function validateAction(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: 'invalid_action', type: null, reason: 'action must be an object' };
  const type = typeof raw.type === 'string' ? raw.type.trim() : '';
  const def = catalog.getAction(type);
  if (!def) return { ok: false, code: 'unsupported_action', type: type || null, reason: `"${type || '(missing type)'}" is not a registered action` };
  const specs = def.fields || {};
  const errors = [];
  const fields = {};
  for (const key of Object.keys(raw)) {
    if (key === 'type') continue;
    if (!specs[key]) { errors.push(`unknown field "${key}"`); continue; }
    if (raw[key] === null || raw[key] === undefined) continue;
    const r = _checkField(key, specs[key], raw[key]);
    if (typeof r === 'string') errors.push(r); else fields[key] = r.value;
  }
  for (const [key, spec] of Object.entries(specs)) {
    if (spec.required && (fields[key] === undefined || fields[key] === '')) errors.push(`missing required field "${key}"`);
  }
  for (const group of def.requireOneOf || []) {
    if (!group.some(k => fields[k] !== undefined && fields[k] !== '')) errors.push(`one of [${group.join(', ')}] is required`);
  }
  if (errors.length) return { ok: false, code: 'invalid_fields', type, reason: errors.join('; ') };
  return { ok: true, action: { type, fields }, def };
}

function validatePlan(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, reason: 'output is not a JSON object' };
  const actions = obj.actions === undefined ? [] : obj.actions;
  if (!Array.isArray(actions)) return { ok: false, reason: '"actions" must be an array' };
  if (actions.length > MAX_ACTIONS_PER_PLAN) return { ok: false, reason: `too many actions (${actions.length} > ${MAX_ACTIONS_PER_PLAN})` };
  if (obj.reply !== undefined && typeof obj.reply !== 'string') return { ok: false, reason: '"reply" must be a string' };
  if (obj.requiresConfirmation !== undefined && typeof obj.requiresConfirmation !== 'boolean') return { ok: false, reason: '"requiresConfirmation" must be a boolean' };
  const valid = [];
  const rejected = [];
  for (const raw of actions) {
    const r = validateAction(raw);
    if (r.ok) valid.push(r); else rejected.push(r);
  }
  return { ok: true, reply: _sanitizeString(obj.reply || '', MAX_REPLY), requiresConfirmation: obj.requiresConfirmation === true, valid, rejected };
}

/** @returns {{kind:'json', value:object}|{kind:'prose', reply:string}|{kind:'invalid', reason:string}} */
function parseModelOutput(text) {
  let raw = String(text == null ? '' : text).trim();
  if (!raw) return { kind: 'invalid', reason: 'empty output' };
  const fence = raw.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fence) raw = fence[1].trim();
  if (!raw.includes('{')) return { kind: 'prose', reply: _sanitizeString(raw, MAX_REPLY) };
  if (!(raw.startsWith('{') && raw.endsWith('}'))) return { kind: 'invalid', reason: 'output mixes prose and JSON' };
  try {
    const value = JSON.parse(raw);
    return { kind: 'json', value };
  } catch (e) {
    return { kind: 'invalid', reason: `invalid JSON: ${e.message}` };
  }
}

module.exports = { MAX_ACTIONS_PER_PLAN, MAX_REPLY, validateAction, validatePlan, parseModelOutput };
