/*
 * NAVIGATION HEADER
 * FILE: src/utils/csv.js
 * LAYER: Utility/helper layer
 * PURPOSE: Small, tested RFC 4180 CSV parser (V202 / BUG-011). Handles quoted commas, escaped quotes ("")
 *          and newlines inside quoted fields. Replaces the naive line.split(',') parser that corrupted
 *          matchup rows such as "Kansas City, MO Chiefs".
 * LOOK HERE FIRST WHEN DEBUGGING: parseCsvRows() (raw rows) and parseCsvObjects() (header-keyed objects).
 * RELATED FLOW: scheduleRegistryService.parseCsv.
 * NOTE: Pure function, no I/O.
 */

'use strict';

/**
 * Parse CSV text into an array of rows (array of string cells).
 * - Fields may be quoted with ". Inside quotes, "" is a literal quote and , / \n are literal.
 * - CRLF and LF both terminate unquoted rows.
 * - Empty rows are dropped.
 */
function parseCsvRows(text, opts = {}) {
  const delimiter = opts.delimiter || ',';
  const src = String(text == null ? '' : text);
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  // strip BOM
  if (src.charCodeAt(0) === 0xfeff) i = 1;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; }
        else inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { row.push(cell); cell = ''; continue; }
    if (ch === '\r') { continue; }
    if (ch === '\n') {
      row.push(cell); cell = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return opts.trim === false ? rows : rows.map(r => r.map(c => c.trim()));
}

/**
 * Parse CSV text into objects keyed by the header row.
 * Missing trailing cells become ''. Extra cells beyond the header are ignored.
 */
function parseCsvObjects(text, opts = {}) {
  const rows = parseCsvRows(text, opts);
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h || '').trim());
  return rows.slice(1).map(cols => {
    const obj = {};
    headers.forEach((h, idx) => { if (h) obj[h] = cols[idx] ?? ''; });
    return obj;
  });
}

module.exports = { parseCsvRows, parseCsvObjects };
