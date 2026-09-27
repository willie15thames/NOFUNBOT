/*
 * FILE: scripts/check-undefined-identifiers.js
 * PURPOSE: CI guard for unresolved JavaScript identifiers. This catches runtime ReferenceErrors that `node --check`
 *          cannot detect (for example a function call whose helper was never defined/imported).
 * NOTE: Requires the existing TypeScript devDependency. It intentionally fails only on TS2304 diagnostics so
 *       incremental JSDoc/type cleanup does not block stabilization.
 */

'use strict';

const fs = require('fs');
const path = require('path');
let ts;
try { ts = require('typescript'); }
catch {
  console.error('[undefined-check] TypeScript devDependency is not installed. Run npm install first.');
  process.exit(2);
}

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'tsconfig.json');
const raw = ts.readConfigFile(configPath, ts.sys.readFile);
if (raw.error) {
  console.error(ts.flattenDiagnosticMessageText(raw.error.messageText, '\n'));
  process.exit(2);
}
const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, root, {
  allowJs: true,
  checkJs: true,
  noEmit: true,
  strict: false,
  skipLibCheck: true,
  types: ['node'],
}, configPath);
const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
const diagnostics = ts.getPreEmitDiagnostics(program).filter(d => d.code === 2304 && d.file && d.start != null);

const NODE_RUNTIME_GLOBALS = new Set([
  '__dirname', '__filename', 'setImmediate', 'clearImmediate', 'Buffer', 'process',
  'require', 'module', 'exports', 'global', 'globalThis',
]);

function isAllowedDiagnostic(d) {
  const file = d.file;
  const pos = file.getLineAndCharacterOfPosition(d.start);
  const line = file.text.split(/\r?\n/)[pos.line] || '';
  // Existing JSDoc-only type aliases do not execute at runtime; keep this guard focused on executable identifiers.
  if (/@(?:param|returns?|type|typedef)\b/.test(line)) return true;
  // When this guard is run before @types/node has been installed, TypeScript can report Node runtime globals
  // as TS2304. They are real Node globals and must not mask executable project-level undefined identifiers.
  const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ');
  const match = msg.match(/Cannot find name ['"]([^'"]+)['"]/);
  return !!(match && NODE_RUNTIME_GLOBALS.has(match[1]));
}

const failures = diagnostics.filter(d => !isAllowedDiagnostic(d));
if (!failures.length) {
  console.log('[undefined-check] PASS — no unresolved executable identifiers found.');
  process.exit(0);
}

console.error(`[undefined-check] FAIL — ${failures.length} unresolved identifier(s):`);
for (const d of failures.slice(0, 100)) {
  const pos = d.file.getLineAndCharacterOfPosition(d.start);
  const rel = path.relative(root, d.file.fileName);
  const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ');
  console.error(`  ${rel}:${pos.line + 1}:${pos.character + 1} TS${d.code} ${msg}`);
}
if (failures.length > 100) console.error(`  ... ${failures.length - 100} more`);
process.exit(1);
