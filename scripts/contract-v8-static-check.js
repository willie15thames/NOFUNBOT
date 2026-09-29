#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const failures = [];
function walk(dir) {
  const out=[];
  for (const ent of fs.readdirSync(dir,{withFileTypes:true})) {
    const p=path.join(dir,ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.isFile() && p.endsWith('.js')) out.push(p);
  }
  return out;
}
function fail(msg){ failures.push(msg); }
const files=walk(SRC);
for (const file of files) {
  const rel=path.relative(ROOT,file);
  const text=fs.readFileSync(file,'utf8');
  if (text.includes('StringSelectMenuBuilder')) fail(`${rel}: production select menu builder remains`);
  if (/\|\|\s*true\b/.test(text)) fail(`${rel}: always-true "|| true" expression remains`);
}

const activeLeague=fs.readFileSync(path.join(SRC,'services/activeLeagueService.js'),'utf8');
const setModeBody=(activeLeague.match(/function setDataSourceMode\([\s\S]*?\n\}/)||[''])[0];
if (/external_sync'\s*\?\s*'external_sync'\s*:\s*'custom_bot_managed'/.test(setModeBody)) {
  fail('src/services/activeLeagueService.js: unknown data source modes are still silently coerced');
}
if (!/allowed\s*=\s*new Set\(\['external_sync','custom_bot_managed'\]\)/.test(activeLeague)) {
  fail('src/services/activeLeagueService.js: data source mode allowlist/fail-closed guard missing');
}
const leagueResolver=fs.readFileSync(path.join(SRC,'services/leagueResolverService.js'),'utf8');
for (const code of ['LEAGUE_ARCHIVED','LEAGUE_ARCHIVING','LEAGUE_WRONG_GUILD','LEAGUE_AMBIGUOUS','LEAGUE_NOT_FOUND']) {
  if (!leagueResolver.includes(code)) fail(`src/services/leagueResolverService.js: typed league resolution code ${code} missing`);
}
if (!leagueResolver.includes('listLeagueRecords()')) {
  fail('src/services/leagueResolverService.js: resolver must identify canonical record before lifecycle filtering');
}
const joinLeague=fs.readFileSync(path.join(SRC,'services/joinLeagueService.js'),'utf8');
if (/function leagueOptions[\s\S]{0,500}listResetOptions\(/.test(joinLeague)) {
  fail('src/services/joinLeagueService.js: membership flow still admits synthetic reset/recovery fallback records');
}
if (!/function leagueOptions[\s\S]{0,500}listJoinableLeagues\(/.test(joinLeague)) {
  fail('src/services/joinLeagueService.js: membership candidates must use listJoinableLeagues');
}

const anthropic=fs.readFileSync(path.join(SRC,'services/ai/anthropicService.js'),'utf8');
if (/Promise\.race\s*\(/.test(anthropic)) fail('src/services/ai/anthropicService.js: duplicate Promise.race timeout owner remains');
const planner=fs.readFileSync(path.join(SRC,'services/naturalActionPlannerService.js'),'utf8');
if (/\bclaimTeam\s*\(/.test(planner)) fail('src/services/naturalActionPlannerService.js: direct claimTeam mutation remains; use application use case');
const router=fs.readFileSync(path.join(SRC,'routing/interactionRouter.js'),'utf8');
for (const command of ['register-team','set-team-identity','add-open-team','remove-open-team','set-team-logo','release-team','create-game']) {
  const re=new RegExp(`case '${command}':[\\s\\S]{0,1600}?getString\\('league'\\)`);
  if (!re.test(router)) fail(`interactionRouter: ${command} does not re-resolve explicit league scope`);
}
const commands=fs.readFileSync(path.join(SRC,'commands.js'),'utf8');
for (const command of ['register-team','set-team-identity','add-open-team','remove-open-team','set-team-logo','release-team','create-game']) {
  const idx=commands.indexOf(`.setName('${command}')`);
  if (idx<0 || !commands.slice(idx,idx+950).includes("setName('league')")) fail(`commands.js: /${command} missing league option`);
}
if (failures.length) {
  console.error('[contract-v8-static] FAIL');
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log(`[contract-v8-static] PASS ${files.length} source files checked.`);
