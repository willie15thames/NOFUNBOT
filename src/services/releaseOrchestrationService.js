/*
 * NAVIGATION HEADER
 * FILE: src/services/releaseOrchestrationService.js
 * LAYER: Service layer
 * PURPOSE: Central release orchestration for patch-note emission, release metadata, and completion gates.
 * LOOK HERE FIRST WHEN DEBUGGING: Search for finalizeRelease.
 * RELATED FLOW: patch publication, zip rebuild, release completion.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PATCH_FILE = path.join(__dirname, '..', '..', 'PATCH_NOTES_AND_CONTEXT.txt');

function _nowIso() {
  return new Date().toISOString();
}

function buildReleaseEntry(input = {}) {
  const version = String(input.version || 'UNSPECIFIED').trim();
  const category = String(input.category || 'system update').trim();
  const affected = Array.isArray(input.affectedSystems) ? input.affectedSystems : [];
  const fixes = Array.isArray(input.fixes) ? input.fixes : [];
  const risks = Array.isArray(input.remainingRisks) ? input.remainingRisks : [];
  const lines = [
    `[${version}] ${category} | ${_nowIso()}`,
    ...affected.map(v => `- affected: ${v}`),
    ...fixes.map(v => `- fix: ${v}`),
    ...(risks.length ? risks.map(v => `- risk: ${v}`) : ['- risk: none noted during static patch pass']),
  ];
  return lines.join('\n');
}

function appendReleaseEntry(entryText) {
  const text = String(entryText || '').trim();
  if (!text) return false;
  const existing = fs.existsSync(PATCH_FILE) ? fs.readFileSync(PATCH_FILE, 'utf8') : '';
  if (existing.includes(text)) return false;
  const out = `${existing.trim()}\n\n${text}\n`;
  fs.writeFileSync(PATCH_FILE, out.trim() + '\n', 'utf8');
  return true;
}

async function finalizeRelease(guild, patchNotesService, metadata = {}) {
  // Validation gate
  let validationGate;
  try { validationGate = require('./validationGateService'); } catch {}
  if (validationGate) {
    const preflight = validationGate.validateReleaseMetadata(metadata);
    if (!preflight.ok) {
      console.warn('[RELEASE] validation failed:', preflight.failures.join(', '));
      return { ok: false, entry: null, failures: preflight.failures };
    }
  }

  const entry = buildReleaseEntry(metadata);
  const appended = appendReleaseEntry(entry);

  let patchNotePublished = false;
  if (guild && patchNotesService?.publishPatchNotes) {
    const pubResult = await patchNotesService.publishPatchNotes(guild, { latestVersion: metadata.version || null, category: metadata.category || null }).catch(() => null);
    patchNotePublished = !!pubResult;
  }

  // Observability
  try {
    require('./observabilityService').recordRelease(metadata.version || 'unknown', {
      ok: true,
      appended,
      patchNotePublished,
    });
  } catch {}

  return { ok: true, entry, appended, patchNotePublished };
}

module.exports = {
  buildReleaseEntry,
  appendReleaseEntry,
  finalizeRelease,
};
