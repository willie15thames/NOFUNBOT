'use strict';
const fs=require('fs'),path=require('path');
const file=()=>path.join(process.env.BOT_DATA_DIR||'/tmp/nofunleague-data','runtime-readiness.json');
const MAX_AGE_MS=90000;
let timer=null,client=null,checking=false,redis=null;
function write(ready,details={}){fs.mkdirSync(path.dirname(file()),{recursive:true});const temp=`${file()}.${process.pid}.tmp`;fs.writeFileSync(temp,JSON.stringify({ready,pid:process.pid,at:Date.now(),version:require('../../package.json').version,sha:process.env.RAILWAY_GIT_COMMIT_SHA||process.env.GITHUB_SHA||null,...details}));fs.renameSync(temp,file());}
function read(){try{const r=JSON.parse(fs.readFileSync(file(),'utf8'));process.kill(r.pid,0);if(Date.now()-r.at>MAX_AGE_MS)return{...r,ready:false,reason:'stale-heartbeat'};return r;}catch{return{ready:false};}}
async function check(){
 if(checking||!client)return;checking=true;
 try{
  const checkingClient=client;
  const db=process.env.DATABASE_URL?await require('../storage/prisma').probePrisma():{schemaReady:false};
  const workerRequired=process.env.ENABLE_QUEUE_WORKER==='true';let queue=!workerRequired;
  if(workerRequired&&process.env.REDIS_URL){
   if(!redis){redis=new(require('ioredis'))(process.env.REDIS_URL,{maxRetriesPerRequest:1,commandTimeout:5000,connectTimeout:5000,enableOfflineQueue:false,retryStrategy:times=>Math.min(times*1000,10000)});redis.on('error',()=>{});}
   try{queue=(await redis.ping())==='PONG';}catch{queue=false;}
  }
  if(client!==checkingClient)return;
  const discord=!!client.isReady();
  const dependencies={discord,database:!!db.schemaReady&&!!db.reachable,queue};write(discord&&dependencies.database&&queue,{dependencies});
 }catch(e){write(false,{reason:e.message});}finally{checking=false;}
}
function start(discordClient){client=discordClient;if(timer)clearInterval(timer);timer=setInterval(()=>void check(),30000);timer.unref();return check();}
async function stop(){if(timer)clearInterval(timer);timer=null;client=null;redis?.disconnect();redis=null;write(false);}
module.exports={write,read,start,stop,check,MAX_AGE_MS};
