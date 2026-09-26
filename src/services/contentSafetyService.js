/*
 * NAVIGATION HEADER
 * FILE: src/services/contentSafetyService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

// Hard slurs — blocked from persistence at all times, no exceptions.
// THIS IS THE SINGLE SOURCE OF TRUTH — import this everywhere.
// memberMentionHandler and contentScanService import from here.
const HARD_SLUR_RX = /\b(?:nigg[e3]r|fagg?ot|fag\b|kike|spic|chink|gook|tranny|wetback|raghead)\b/i;
// Soft slurs — only blocked below R rating
const SOFT_SLUR_RX = /\bnigga\b/i;
const DOXX_RX = /\b(?:ssn|social security|date of birth|dob|driver'?s license|home address|routing number|account number|passport number)\b/i;
const SECRET_RX = /\b(?:password|passcode|2fa|mfa code|otp|secret key|api key|token|private key|seed phrase)\b/i;
const EMAIL_RX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RX = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/;
const IP_RX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const STREET_RX = /\b\d{1,6}\s+[A-Za-z0-9.'-]+\s(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|court|ct|drive|dr|way)\b/i;

function classifyUnsafeText(text, opts) {
  const audienceRating = (opts && opts.audienceRating) ? opts.audienceRating : '';
  const value = String(text || '').trim();
  if (!value) return null;
  const isR = String(audienceRating).toLowerCase() === 'r';
  if (HARD_SLUR_RX.test(value)) return 'hateful_slur';
  if (!isR && SOFT_SLUR_RX.test(value)) return 'soft_slur';
  if (DOXX_RX.test(value)) return 'doxx_pattern';
  if (SECRET_RX.test(value)) return 'secret_pattern';
  if (EMAIL_RX.test(value) && PHONE_RX.test(value)) return 'contact_bundle';
  if (PHONE_RX.test(value) && STREET_RX.test(value)) return 'doxx_pattern';
  if (IP_RX.test(value) && /address|location|house|home/i.test(value)) return 'doxx_pattern';
  return null;
}

function isSafeToPersist(text, opts) {
  return !classifyUnsafeText(text, opts || {});
}

function filterSafeTextList(items, opts) {
  return (Array.isArray(items) ? items : []).filter(function(item) { return isSafeToPersist(item, opts || {}); });
}

module.exports = {
  classifyUnsafeText,
  isSafeToPersist,
  filterSafeTextList,
  HARD_SLUR_RX,
  SOFT_SLUR_RX,
};
