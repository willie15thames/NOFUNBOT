/*
 * NAVIGATION HEADER
 * FILE: src/services/timezoneService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const ALIASES = {
  PST: 'America/Los_Angeles',
  PDT: 'America/Los_Angeles',
  MST: 'America/Denver',
  MDT: 'America/Denver',
  CST: 'America/Chicago',
  CDT: 'America/Chicago',
  EST: 'America/New_York',
  EDT: 'America/New_York',
  AKST: 'America/Anchorage',
  AKDT: 'America/Anchorage',
  HST: 'Pacific/Honolulu',
  GMT: 'Etc/GMT',
  UTC: 'UTC',
};

function normalizeTimezone(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const alias = ALIASES[raw.toUpperCase()];
  if (alias) return alias;

  // convert spaces to underscores for common user input
  const candidate = raw.replace(/\s+/g, '_');

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {}

  return null;
}

function extractTimezoneFromText(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const patterns = [
    /\b(?:my\s+)?time\s*zone\s*(?:is|=|:|to)\s*([A-Za-z_\/+-]{2,40})\b/i,
    /\b(?:set|save|make|update)\s+(?:my\s+)?time\s*zone\s*(?:to|as|=|:)\s*([A-Za-z_\/+-]{2,40})\b/i,
    /\btimezone\s*(?:is|=|:|to)\s*([A-Za-z_\/+-]{2,40})\b/i,
    /\btz\s*(?:is|=|:|to)\s*([A-Za-z_\/+-]{2,40})\b/i,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m?.[1]) {
      const normalized = normalizeTimezone(m[1]);
      if (normalized) return normalized;
    }
  }
  const aliases = raw.match(/\b(PST|PDT|MST|MDT|CST|CDT|EST|EDT|AKST|AKDT|HST|GMT|UTC)\b/i);
  if (aliases?.[1]) return normalizeTimezone(aliases[1]);
  return null;
}

module.exports = {
  normalizeTimezone,
  extractTimezoneFromText,
  ALIASES,
};
