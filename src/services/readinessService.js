'use strict';
const fs=require('fs');
const path=require('path');
const file=()=>path.join(process.env.BOT_DATA_DIR||'/tmp/nofunleague-data','runtime-readiness.json');
function write(ready){fs.mkdirSync(path.dirname(file()),{recursive:true});fs.writeFileSync(file(),JSON.stringify({ready,pid:process.pid,at:Date.now(),version:require('../../package.json').version,sha:process.env.RAILWAY_GIT_COMMIT_SHA||process.env.GITHUB_SHA||null}));}
function read(){try{const r=JSON.parse(fs.readFileSync(file(),'utf8'));process.kill(r.pid,0);return r;}catch{return{ready:false};}}
module.exports={write,read};
