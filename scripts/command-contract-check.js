/*
 * FILE: scripts/command-contract-check.js
 * PURPOSE: Static contract check between SlashCommandBuilder definitions and interactionRouter cases.
 *          Router-only legacy/internal cases must be explicitly classified here instead of silently drifting.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const commands = fs.readFileSync(path.join(root, 'src', 'commands.js'), 'utf8');
const router = fs.readFileSync(path.join(root, 'src', 'routing', 'interactionRouter.js'), 'utf8');
const commandNames = new Set([...commands.matchAll(/new SlashCommandBuilder\(\)\s*\n?\s*\.setName\('([^']+)'\)/g)].map(m => m[1]));
const routerCases = new Set([...router.matchAll(/case '([^']+)'\s*:/g)].map(m => m[1]));

// These handlers are intentionally not public top-level slash commands. Their public replacements are documented
// in docs/COMMAND_HANDLER_MANIFEST.md. Adding a new router-only case requires an explicit classification here.
const ROUTER_ONLY_ALLOWLIST = new Set([
  'add-member-note', 'check-inactive', 'inactive-members',
  'manual-actions', 'manual-commands', 'manual-league', 'manual-server', 'manual-setup',
  'schedule-export-all', 'schedule-export-current',
  'set-weekly-automation', 'setup-bot', 'weekly-automation-status',
]);

const missingHandlers = [...commandNames].filter(n => !routerCases.has(n));
const unexpectedRouterOnly = [...routerCases].filter(n => !commandNames.has(n) && !ROUTER_ONLY_ALLOWLIST.has(n));
if (missingHandlers.length || unexpectedRouterOnly.length) {
  if (missingHandlers.length) console.error(`[command-contract] registered definitions without router case: ${missingHandlers.sort().join(', ')}`);
  if (unexpectedRouterOnly.length) console.error(`[command-contract] unclassified router-only cases: ${unexpectedRouterOnly.sort().join(', ')}`);
  process.exit(1);
}
console.log(`[command-contract] PASS — ${commandNames.size} command definitions, ${routerCases.size} router cases, ${ROUTER_ONLY_ALLOWLIST.size} classified legacy/internal cases.`);
