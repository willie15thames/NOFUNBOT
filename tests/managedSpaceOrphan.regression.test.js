'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const os=require('os');
process.env.BOT_DATA_DIR=process.env.BOT_DATA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'nofun-space-orphan-'));
process.env.DATABASE_URL='';
const {saveJson}=require('../src/storage/jsonStore');
const store=require('../src/storage/criticalStore');
const svc=require('../src/services/managedSpaceService');
const guildId='g-orphan';

(async()=>{
 saveJson('activeLeagues.json', {real:{guildId,leagueName:'Real',status:'ACTIVE',kind:'league'}});
 await store.transact(`v204:spaces:${guildId}`,{spaces:{}},data=>{
  data.spaces={
   real:{id:'real',guildId,name:'Real',status:'ACTIVE',kind:'league',createdAt:Date.now()},
   ghost1:{id:'ghost1',guildId,name:'Ghost One',status:'ACTIVE',kind:'league',createdAt:Date.now()},
   ghost2:{id:'ghost2',guildId,name:'Ghost Two',status:'REPAIR_REQUIRED',kind:'league',createdAt:Date.now()},
  }; return true;
 });
 const list=await svc.list(guildId);
 assert.equal(list.find(x=>x.id==='real').status,'ACTIVE');
 assert.equal(list.find(x=>x.id==='ghost1').status,'ARCHIVED');
 assert.equal(list.find(x=>x.id==='ghost2').status,'REPAIR_REQUIRED');
 const reserved=await svc.reserve(guildId,{name:'Fresh League'});
 assert.equal(reserved.status,'PREPARING');
 await svc.clearGuild(guildId);
 assert.equal((await svc.list(guildId)).length,0);
 console.log('Managed-space orphan regression: 5 passed, 0 failed');
})().catch(err=>{console.error(err);process.exit(1)});
