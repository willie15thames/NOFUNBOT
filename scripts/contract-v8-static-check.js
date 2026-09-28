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
