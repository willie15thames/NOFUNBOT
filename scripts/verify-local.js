'use strict';
// Isolated checks: never log in to Discord or use the caller's live databases.
const {spawnSync}=require('child_process');
const fs=require('fs'),os=require('os'),path=require('path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nofun-verify-'));
const env={...process.env,NODE_ENV:'test',APP_ENV:'test',BOT_DATA_DIR:dir,DISCORD_TOKEN:'test-token',CLIENT_ID:'111111111111111111',GUILD_ID:'222222222222222222',AI_ENABLED:'false',ENABLE_QUEUE_WORKER:'false',DATABASE_URL:'',REDIS_URL:''};
try{
 for(const script of ['tsc','release:verify']){
  const out=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['run',script],{cwd:path.join(__dirname,'..'),env,stdio:'inherit'});
  if(out.status!==0){process.exitCode=out.status||1;break;}
 }
}finally{fs.rmSync(dir,{recursive:true,force:true});}
