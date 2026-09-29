'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const workflow = require('../src/services/workflowEngineService');
const scheduler = require('../src/services/schedulerRegistryService');
const hub = require('../src/services/hubReleaseService');
const {getDataFilePath} = require('../src/storage/jsonStore');

(async () => {
  let ran = false;
  workflow.define('integrity-fail-fast', [
    {step:'critical',fn:async()=>{throw new Error('injected failure');}},
    {step:'must-not-run',fn:async()=>{ran=true;}},
  ], {wireStatus:'manual',failFast:true});
  const result = await workflow.run('integrity-fail-fast');
  assert.equal(result.ok,false);
  assert.equal(ran,false,'a failed critical workflow cannot continue silently');
  assert.equal(result.errors[0].step,'critical');

  const state={hubWeeklyData:{week:7,scores:[],statLines:[],standings:null,potwDueAt:Date.now()+60000,potwAttempts:1}};
  await hub.resetHubWeek(8,state);
  const disk=JSON.parse(fs.readFileSync(getDataFilePath('hubWeeklyData.json'),'utf8'));
  assert.equal(disk.week,8);
  assert.equal(disk.potwDueAt,null,'cancelled deadline cannot return after restart');
  assert.equal(scheduler.list().some(j=>j.key==='potw-followup'),false);
  console.log('G1 workflow and deadline: 1 passed, 0 failed');
})().catch(err=>{console.error(err);process.exitCode=1;});
