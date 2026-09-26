#!/usr/bin/env node
/*
 * NAVIGATION HEADER
 * FILE: scripts/pre-commit-check.js
 * LAYER: Maintenance and operational scripts
 * PURPOSE: Provides a project script for setup, auditing, deployment, or maintenance.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually run manually or from package.json / deployment hooks.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_EXTENSIONS = new Set(['.js', '.ts', '.json', '.md', '.yml', '.yaml', '.sh']);
const PATCH_NOTE_FILES = [
  'PATCH_NOTES_AND_CONTEXT.txt',
  'changelog.txt',
];
const FORBIDDEN_PATTERNS = [
  {
    regex: /wizardPreferencesService\.[^\n]*getPrefs\(\)[\s\S]{0,220}(wizardStage|installationMode)/m,
    message: 'Do not read wizardStage or installationMode from wizardPreferencesService. Use the authoritative state service instead.',
  },
  {
    regex: /\.send\s*\([\s\S]{0,180}flags\s*:/m,
    message: 'channel.send() payload appears to use flags. Verify this is supported for the target API path.',
  },
];
const REQUIRED_PROCESS_HEADERS = ['PROCESS NAME', 'PURPOSE', 'TRIGGER', 'CONDITIONS', 'FAILSAFE', 'ROLLBACK'];
const HIGH_RISK_KEYWORDS = [
  'wizardPreferencesService',
  'wizardStage',
  'installationMode',
  'starterMessageId',
  'wizardStarterMessageId',
  '.send(',
  'followUp(',
  'reply(',
  'editReply(',
  'lock',
  'setTimeout(',
];

function run(command) {
  return execSync(command, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function getStagedFiles() {
  const output = run('git diff --cached --name-only --diff-filter=ACMR');
  return output ? output.split('\n').filter(Boolean) : [];
}

function readFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function checkPatchNotes(stagedFiles, failures, warnings) {
  const changedSource = stagedFiles.filter((file) => {
    const ext = path.extname(file);
    return file.startsWith('src/') && SOURCE_EXTENSIONS.has(ext);
  });
  if (!changedSource.length) return;

  const patchNotesTouched = stagedFiles.some((file) => PATCH_NOTE_FILES.includes(file) || /^PATCH_.*\.(md|txt)$/i.test(path.basename(file)));
  if (!patchNotesTouched) {
    failures.push('Source files are staged but no patch-notes file is staged. Add update notes before commit.');
  }

  const patchNotesPath = fileExists('PATCH_NOTES_AND_CONTEXT.txt') ? 'PATCH_NOTES_AND_CONTEXT.txt' : null;
  if (patchNotesPath) {
    const text = readFile(patchNotesPath);
    const requiredPhrases = ['must not regress', 'review patch notes', 'review logs'];
    for (const phrase of requiredPhrases) {
      if (!text.toLowerCase().includes(phrase)) {
        warnings.push(`PATCH_NOTES_AND_CONTEXT.txt does not mention "${phrase}". Consider keeping the guard language visible.`);
      }
    }
  }
}

function scanFiles(stagedFiles, failures, warnings) {
  for (const file of stagedFiles) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) continue;
    const ext = path.extname(file);
    if (!SOURCE_EXTENSIONS.has(ext)) continue;
    const text = readFile(file);

    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.regex.test(text)) {
        failures.push(`${file}: ${rule.message}`);
      }
    }

    const highRiskHits = HIGH_RISK_KEYWORDS.filter((keyword) => text.includes(keyword));
    if (highRiskHits.length) {
      warnings.push(`${file}: high-risk surface touched (${highRiskHits.slice(0, 6).join(', ')})`);
    }
  }
}


function checkProcessCommentPolicy(stagedFiles, failures, warnings) {
  for (const file of stagedFiles) {
    const ext = path.extname(file);
    if (!SOURCE_EXTENSIONS.has(ext)) continue;
    const lower = file.toLowerCase();
    const isProcessSurface = lower.includes('process') || lower.includes('workflow');
    if (!isProcessSurface) continue;
    const text = readFile(file);
    const missingHeaders = REQUIRED_PROCESS_HEADERS.filter((header) => !text.includes(header));
    if (missingHeaders.length) {
      failures.push(`${file}: process/workflow files must document new flows. Missing headers: ${missingHeaders.join(', ')}`);
    }
    if (!/commentPolicy|requiredCommentHeaders|PROCESS NAME/.test(text)) {
      warnings.push(`${file}: consider adding explicit comment policy metadata for future AI edits.`);
    }
  }
}

function checkGuidanceFiles(warnings) {
  const expected = [
    'AI_READ_FIRST.txt',
    'ai_patch_accountability_rules.json',
    'ai_preflight_check.py',
  ];

  const missing = expected.filter((file) => !fileExists(file));
  if (missing.length) {
    warnings.push(`Recommended guard files missing: ${missing.join(', ')}`);
  }
}

function maybeRunTypecheck(warnings, failures) {
  const packageJsonPath = path.join(ROOT, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return;
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  if (!pkg.scripts || !pkg.scripts.tsc) return;

  try {
    execSync('npm run tsc', { cwd: ROOT, stdio: 'pipe' });
  } catch (error) {
    const stderr = String(error.stderr || error.stdout || error.message || '').trim();
    failures.push(`TypeScript check failed. ${stderr.split('\n').slice(0, 6).join(' | ')}`);
  }
}

function main() {
  let stagedFiles;
  try {
    stagedFiles = getStagedFiles();
  } catch (error) {
    console.error('[pre-commit] Unable to read staged files.');
    process.exit(1);
  }

  if (!stagedFiles.length) {
    console.log('[pre-commit] No staged files. Skipping gate.');
    process.exit(0);
  }

  const failures = [];
  const warnings = [];

  checkPatchNotes(stagedFiles, failures, warnings);
  scanFiles(stagedFiles, failures, warnings);
  checkProcessCommentPolicy(stagedFiles, failures, warnings);
  checkGuidanceFiles(warnings);
  maybeRunTypecheck(warnings, failures);

  console.log('\n[pre-commit] Staged files:');
  for (const file of stagedFiles) console.log(`  - ${file}`);

  if (warnings.length) {
    console.log('\n[pre-commit] Warnings:');
    for (const item of warnings) console.log(`  - ${item}`);
  }

  if (failures.length) {
    console.error('\n[pre-commit] Blocked:');
    for (const item of failures) console.error(`  - ${item}`);
    console.error('\n[pre-commit] Commit blocked until the issues above are fixed.');
    process.exit(1);
  }

  console.log('\n[pre-commit] PASS: no blocking issues detected.');
}

main();
