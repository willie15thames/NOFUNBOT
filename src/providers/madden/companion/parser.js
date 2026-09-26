/*
 * NAVIGATION HEADER
 * FILE: src/providers/madden/companion/parser.js
 * LAYER: Provider adapter layer (V202, spec §8)
 * PURPOSE: Parse a raw Madden Companion export body (JSON) into a plain object. The export is UNTRUSTED input:
 *          size is capped by the gateway, JSON is parsed strictly, and only the shapes we can normalize are kept.
 * LOOK HERE FIRST WHEN DEBUGGING: parseExportBody().
 * NOTE: The Companion App posts several export stages (league info, team info, schedule per week, stats).
 *       Stage detection is by content, never by trusting a client-declared label alone.
 */

'use strict';

function parseExportBody(body, contentType = '') {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body ?? '');
  if (!text.trim()) return { ok: false, reason: 'empty-body' };
  const ct = String(contentType || '').toLowerCase();
  if (ct && !/json|text\/plain|octet-stream/.test(ct)) return { ok: false, reason: 'unsupported-content-type', contentType: ct };
  let data;
  try { data = JSON.parse(text); }
  catch (e) { return { ok: false, reason: 'invalid-json', error: e.message }; }
  if (!data || typeof data !== 'object') return { ok: false, reason: 'not-an-object' };
  const stage = detectStage(data);
  return { ok: true, data, stage };
}

/** Best-effort stage detection by content keys (Companion export families). */
function detectStage(data) {
  const keys = Object.keys(data || {}).map(k => k.toLowerCase());
  const has = k => keys.includes(k.toLowerCase());
  if (has('gameScheduleInfoList') || has('schedule') || has('games') || has('weeks')) return 'schedule';
  if (has('leagueTeamInfoList') || has('teams') || has('teamInfoList')) return 'teams';
  if (has('playerPassingStatInfoList') || has('playerRushingStatInfoList') || has('teamStatInfoList') || has('stats')) return 'stats';
  if (has('leagueInfo') || has('league')) return 'league';
  if (has('rosterInfoList') || has('roster') || has('players')) return 'roster';
  return 'unknown';
}

module.exports = { parseExportBody, detectStage };
