/*
 * NAVIGATION HEADER
 * FILE: src/services/fileIntakeService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { loadJson, saveJson } = require('../storage/jsonStore');
const scheduleRegistry = require('./scheduleRegistryService');

const STORE_FILE = 'importedLeagueData.json';

function getStore() {
  const raw = loadJson(STORE_FILE, null);
  return raw && typeof raw === 'object' ? raw : { imports: [], lastImportAt: null };
}

function saveStore(next) {
  const out = { ...getStore(), ...(next || {}), lastImportAt: Date.now() };
  saveJson(STORE_FILE, out);
  return out;
}

function extOf(filename = '') {
  return path.extname(String(filename || '')).toLowerCase();
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
// SECURITY FIX (MED-07): removed .html (XSS risk), .xml, .rtf, .odt, .ods (not needed by league data ingest)
const TEXT_EXTS = new Set(['.csv', '.tsv', '.json', '.txt', '.md', '.log', '.doc', '.docx', '.xls', '.xlsx', '.xlsm', '.pdf']);

function isImageExt(ext) {
  return IMAGE_EXTS.has(ext);
}

function isSupportedFile(filename = '', contentType = '') {
  const ext = extOf(filename);
  if (isImageExt(ext)) return true;
  return TEXT_EXTS.has(ext) || String(contentType || '').startsWith('image/');
}

// SECURITY FIX (CIA-03): Only fetch from Discord CDN domains.
const ALLOWED_FETCH_HOSTS_FI = new Set([
  'cdn.discordapp.com', 'media.discordapp.net', 'attachments.discord.com',
  'images-ext-1.discordapp.net', 'images-ext-2.discordapp.net',
]);

async function fetchBuffer(url) {
  try {
    const hostname = (require('../utils/safeUrl').safeUrl(url)?.hostname || '');
    if (!ALLOWED_FETCH_HOSTS_FI.has(hostname)) {
      throw new Error(`SSRF_BLOCKED: fetchBuffer rejected non-CDN URL: ${hostname}`);
    }
  } catch (e) {
    if (e.message.startsWith('SSRF_BLOCKED')) throw e;
    throw new Error(`Invalid URL: ${url}`);
  }
  // V202 (BUG-010): central intake enforces timeout + size cap on top of the CDN allowlist above.
  const { fetchExternal } = require('../utils/httpIntake');
  const res = await fetchExternal({ url, allowedHosts: ALLOWED_FETCH_HOSTS_FI, timeoutMs: 20000, maxBytes: 12 * 1024 * 1024 });
  if (!res.ok) throw new Error(`Failed to fetch attachment: ${res.reason}${res.status ? ` (${res.status})` : ''}`);
  return res.buffer;
}

function csvToRows(text = '') {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  return lines.map(line => {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (ch === ',' && !inQuotes) {
        cells.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  });
}

function tableTextFromRows(rows = [], maxRows = 80) {
  return rows.slice(0, maxRows).map(r => r.join(' | ')).join('\n');
}

function _xmlText(str = '') {
  return String(str || '')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDocxText(buffer) {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw new Error('DOCX document.xml missing');
  const xml = entry.getData().toString('utf8');
  const paras = xml.split(/<w:p[^>]*>/i).slice(1).map(part => _xmlText(part.replace(/<\/w:p>.*/is, ''))).filter(Boolean);
  return paras.join('\n');
}

function extractXlsxText(buffer) {
  const zip = new AdmZip(buffer);
  const sharedEntry = zip.getEntry('xl/sharedStrings.xml');
  let shared = [];
  if (sharedEntry) {
    const xml = sharedEntry.getData().toString('utf8');
    shared = [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  }
  const sheets = zip.getEntries().filter(e => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.entryName));
  const chunks = [];
  for (const sheet of sheets) {
    const xml = sheet.getData().toString('utf8');
    chunks.push(`# ${path.basename(sheet.entryName, '.xml')}`);
    const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(m => {
      const cells = [...m[1].matchAll(/<c[^>]*?(?:t="([^"]+)")?[^>]*>([\s\S]*?)<\/c>/g)].map(cell => {
        const t = cell[1] || '';
        const inner = cell[2] || '';
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [,''])[1];
        if (t === 's') return shared[Number(v)] || '';
        return v;
      });
      return cells;
    });
    chunks.push(tableTextFromRows(rows));
  }
  return chunks.join('\n\n').trim();
}


function extractPdfishText(buffer) {
  return buffer.toString('latin1')
    .replace(/\r/g, '\n')
    .replace(/\([^)]{1,200}\)/g, m => ` ${m.slice(1, -1)} `)
    .replace(/[^\x20-\x7E\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBinaryishText(buffer) {
  const latin = buffer.toString('latin1');
  return latin.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ').replace(/\s+/g, ' ').trim();
}

function summarizeTextType(text, filename) {
  const ext = extOf(filename);
  if (ext === '.csv' || ext === '.tsv') {
    const normalized = ext === '.tsv' ? String(text || '').replace(/	/g, ',') : text;
    const rows = csvToRows(normalized);
    return { kind: 'table', rows, previewText: tableTextFromRows(rows), metadata: { rowCount: rows.length, columns: rows[0]?.length || 0 } };
  }
  if (ext === '.json') {
    const parsed = JSON.parse(text);
    return { kind: 'json', json: parsed, previewText: JSON.stringify(parsed, null, 2).slice(0, 8000), metadata: { topLevel: Array.isArray(parsed) ? 'array' : typeof parsed } };
  }
  return { kind: 'text', previewText: String(text || '').slice(0, 8000), metadata: { chars: String(text || '').length } };
}

async function parseAttachment(attachment, { aiCall, MODELS } = {}) {
  const filename = attachment?.name || 'attachment';
  const ext = extOf(filename);
  if (!isSupportedFile(filename, attachment?.contentType)) {
    throw new Error(`Unsupported file type: ${ext || attachment?.contentType || 'unknown'}`);
  }
  const buffer = await fetchBuffer(attachment.url);
  if (isImageExt(ext) || String(attachment?.contentType || '').startsWith('image/')) {
    if (!aiCall || !MODELS?.SMART) throw new Error('Vision intake is unavailable right now.');
    const mediaType = String(attachment?.contentType || '').split(';')[0] || 'image/png';
    const base64 = buffer.toString('base64');
    const prompt = `Read this uploaded league image and return strict JSON only:\n{\n  "detectedType": "schedule|standings|stats|records|notes|unknown",\n  "summary": "short readable summary",\n  "scheduleRows": [{"week":1,"team1":"","team2":""}],\n  "standings": [{"team":"","wins":0,"losses":0}],\n  "statLines": [{"player":"","team":"","stat":"","value":""}],\n  "records": [{"team":"","field":"","value":""}],\n  "notes": []\n}`;
    const res = await aiCall({
      model: MODELS.SMART,
      max_tokens: 900,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: prompt },
      ] }],
    });
    const raw = String(res?.content?.[0]?.text || '').trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
    const parsed = JSON.parse(raw);
    return { filename, kind: 'vision', parsed, previewText: parsed.summary || 'Image data processed.' };
  }
  let text = '';
  if (ext === '.docx' || ext === '.odt') text = extractDocxText(buffer);
  else if (ext === '.xlsx' || ext === '.xlsm' || ext === '.ods') text = extractXlsxText(buffer);
  else if (ext === '.pdf') text = extractPdfishText(buffer);
  else if (ext === '.doc' || ext === '.xls' || ext === '.rtf') text = extractBinaryishText(buffer);
  else text = buffer.toString('utf8');
  return { filename, ...summarizeTextType(text, filename) };
}

function classifyTarget(input = 'auto') {
  const val = String(input || 'auto').toLowerCase();
  return ['auto', 'schedule', 'standings', 'stats', 'records', 'notes'].includes(val) ? val : 'auto';
}

function mergeParsedIntoStore(parsed, target = 'auto') {
  const store = getStore();
  const imports = Array.isArray(store.imports) ? store.imports : [];
  const entry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    importedAt: Date.now(),
    filename: parsed.filename,
    kind: parsed.kind,
    target,
    previewText: parsed.previewText || '',
    metadata: parsed.metadata || {},
    parsed: parsed.parsed || parsed.json || null,
  };
  imports.unshift(entry);
  saveStore({ imports: imports.slice(0, 50) });
  return entry;
}

function applyParsedToBotState(parsed, state, target = 'auto') {
  const outcome = { applied: [], notes: [] };
  const chosen = classifyTarget(target === 'auto' ? (parsed?.parsed?.detectedType || parsed.kind) : target);
  if (chosen === 'schedule') {
    if (parsed.kind === 'table') {
      const rows = parsed.rows || [];
      const payload = { weeks: {}, teams: [] };
      rows.slice(1).forEach((r, idx) => {
        const [week, team1, team2] = r;
        const wk = Number(week) || 1;
        if (!payload.weeks[wk]) payload.weeks[wk] = [];
        if (team1 && team2) payload.weeks[wk].push({ team1, team2, week: wk, row: idx + 2 });
        if (team1 && !payload.teams.includes(team1)) payload.teams.push(team1);
        if (team2 && !payload.teams.includes(team2)) payload.teams.push(team2);
      });
      Object.entries(payload.weeks).forEach(([week, games]) => scheduleRegistry.upsertWeek(Number(week), games, { source: 'league_data_ingest', importedAt: Date.now() }));
      outcome.applied.push(`Stored schedule weeks: ${Object.keys(payload.weeks).length}`);
    } else if (parsed.kind === 'vision' && Array.isArray(parsed.parsed?.scheduleRows)) {
      const grouped = {};
      for (const row of parsed.parsed.scheduleRows) {
        const wk = Number(row.week) || 1;
        if (!grouped[wk]) grouped[wk] = [];
        grouped[wk].push(row);
      }
      Object.entries(grouped).forEach(([week, games]) => scheduleRegistry.upsertWeek(Number(week), games, { source: 'vision_ingest', importedAt: Date.now() }));
      outcome.applied.push(`Stored schedule weeks: ${Object.keys(grouped).length}`);
    } else {
      outcome.notes.push('Schedule target selected, but the file did not parse into schedule rows cleanly.');
    }
  }
  if (chosen === 'standings' && parsed.kind === 'vision' && Array.isArray(parsed.parsed?.standings)) {
    state.hubWeeklyData = state.hubWeeklyData || {};
    state.hubWeeklyData.standings = parsed.parsed.standings;
    outcome.applied.push(`Standings rows: ${parsed.parsed.standings.length}`);
  }
  if (chosen === 'stats') {
    state.hubWeeklyData = state.hubWeeklyData || {};
    if (parsed.kind === 'vision' && Array.isArray(parsed.parsed?.statLines)) {
      state.hubWeeklyData.statLines = parsed.parsed.statLines;
      outcome.applied.push(`Stat lines: ${parsed.parsed.statLines.length}`);
    } else {
      outcome.notes.push('Stats target selected, but this file did not contain structured stat lines.');
    }
  }
  if (chosen === 'records') {
    state.leagueMemory = state.leagueMemory || {};
    state.leagueMemory.importedRecords = parsed.parsed?.records || parsed.json || parsed.rows || parsed.previewText || '';
    outcome.applied.push('Saved imported records snapshot.');
  }
  if (chosen === 'notes') {
    state.leagueMemory = state.leagueMemory || {};
    state.leagueMemory.importedNotes = parsed.previewText || '';
    outcome.applied.push('Saved imported notes snapshot.');
  }
  return { chosen, ...outcome };
}

async function importLeagueDataFromAttachment(attachment, { aiCall, MODELS, state, target = 'auto' } = {}) {
  const parsed = await parseAttachment(attachment, { aiCall, MODELS });
  const stored = mergeParsedIntoStore(parsed, target);
  const applied = applyParsedToBotState(parsed, state, target);
  return { parsed, stored, applied };
}

async function tryHandleLeagueDataIntakeMessage(message, deps = {}) {
  if (!message?.attachments?.size) return false;
  const attachment = message.attachments.first();
  if (!attachment || !isSupportedFile(attachment.name, attachment.contentType)) return false;
  const _msgContent = message.content || '';
  let target = 'auto';
  if (/standings/.test(_msgContent))      target = 'standings';
  else if (/stats?/.test(_msgContent))    target = 'stats';
  else if (/record/.test(_msgContent))    target = 'records';
  else if (/schedule|week/.test(_msgContent)) target = 'schedule';
  const result = await importLeagueDataFromAttachment(attachment, { ...deps, target });
  const appliedBits = result.applied.applied.length ? result.applied.applied.join(' • ') : 'Saved for later use.';
  await message.reply(`📥 Imported **${attachment.name}** as **${result.applied.chosen}** data. ${appliedBits}`).catch(() => null);
  return true;
}

module.exports = {
  STORE_FILE,
  getStore,
  saveStore,
  isSupportedFile,
  parseAttachment,
  importLeagueDataFromAttachment,
  tryHandleLeagueDataIntakeMessage,
};
