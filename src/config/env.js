/*
 * NAVIGATION HEADER
 * FILE: src/config/env.js
 * LAYER: Configuration layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: See nearby files in the same folder for related behavior.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

const fs = require('fs');
const path = require('path');

function stripWrappingQuotes(value) {
  if (typeof value !== 'string' || value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) return value.slice(1, -1);
  return value;
}

function parseDotEnvLine(line) {
  if (!line || /^\s*#/.test(line)) return null;
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!match) return null;
  const [, key, rawValue] = match;
  let value = rawValue ?? '';
  const trimmed = value.trim();
  if (!(trimmed.startsWith('"') || trimmed.startsWith("'"))) value = value.replace(/\s+#.*$/, '');
  value = stripWrappingQuotes(value.trim()).replace(/\\n/g, '\n');
  return [key, value];
}

function loadDotEnvFallback() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseDotEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (process.env[key] == null || process.env[key] === '') process.env[key] = value;
  }
}

function loadEnvironment() {
  try {
    require('dotenv').config();
    return;
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') console.warn('[ENV] dotenv failed to load, falling back to local parser:', err.message);
  }
  loadDotEnvFallback();
}

function envBool(value, fallback = false) {
  const clean = String(value ?? '').trim().toLowerCase();
  if (!clean) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(clean)) return true;
  if (['0', 'false', 'no', 'off'].includes(clean)) return false;
  return fallback;
}

loadEnvironment();

const REQUIRED = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];
for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`\n[ENV] ❌ FATAL: Missing required environment variable: ${key}`);
    console.error('[ENV]    Add it to your .env file or Railway environment and restart.\n');
    process.exit(1);
  }
}

// Soft-required: warn clearly at startup when these are missing so deploys don't silently degrade
const SOFT_REQUIRED = {
  COMMISSIONER_ROLE_ID: 'Commissioner role detection falls back to Discord Administrator permission. Set this to your commissioner role ID for reliable access control.',
  DATABASE_URL:         'PostgreSQL is unavailable. Critical production writes are blocked; local test records use BOT_DATA_DIR.',
  REDIS_URL:            'BullMQ queue worker will not start — background jobs and storage sync are inert.',
};
for (const [key, hint] of Object.entries(SOFT_REQUIRED)) {
  if (!process.env[key]) {
    console.warn(`\n[ENV] ⚠️  Optional but recommended: ${key} is not set.`);
    console.warn(`[ENV]    ${hint}\n`);
  }
}

module.exports = {
  TOKEN: process.env.DISCORD_TOKEN,
  CLIENT_ID: process.env.CLIENT_ID,
  GUILD_ID: process.env.GUILD_ID,
  COMM_ROLE: process.env.COMMISSIONER_ROLE_ID || null,
  IT_ROLE: process.env.IT_ROLE_ID || null,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || null,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || null,
  AI_PROVIDER: String(process.env.AI_PROVIDER || 'anthropic').trim().toLowerCase(),
  AI_ENABLED: envBool(process.env.AI_ENABLED, true),
  ANTHROPIC_MODEL_FAST: process.env.ANTHROPIC_MODEL_FAST || 'claude-haiku-4-5-20251001',
  ANTHROPIC_MODEL_SMART: process.env.ANTHROPIC_MODEL_SMART || 'claude-sonnet-4-6',
  AI_TIMEOUT_MS: Number(process.env.AI_TIMEOUT_MS || 22000),
  COMMISSIONER_IDS: new Set((process.env.COMMISSIONER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)),
  IT_IDS: new Set((process.env.IT_IDS || '').split(',').map(s => s.trim()).filter(Boolean)),
};
