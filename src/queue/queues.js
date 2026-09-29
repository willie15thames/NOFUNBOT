'use strict';
// Reuse a bounded set of BullMQ queues instead of opening a connection per write.
const {Queue}=require('bullmq');
const IORedis=require('ioredis');
const {storageJobId,normalizeScope}=require('./queueIdentity');
const queues=new Map();let connection;
function getRedisConnection(){
 if(!process.env.REDIS_URL)return null;
 if(!connection){connection=new IORedis(process.env.REDIS_URL,{maxRetriesPerRequest:1,commandTimeout:5000,connectTimeout:5000,enableOfflineQueue:false});connection.on('error',e=>console.warn(`[queue] ${e.message}`));}
 return{connection};
}
function getQueue(name){
 const options=getRedisConnection();if(!options)return null;
 if(!queues.has(name)){if(queues.size>=8)throw Error('Queue cache limit reached');queues.set(name,new Queue(name,options));}
 return queues.get(name);
}
async function enqueueStorageSync(filename,data,scope={}){
 const queue=getQueue('storage-sync');if(!queue)return false;
 const jobId=storageJobId(filename,data,scope);
 const scopeLabel=normalizeScope(scope);
 const counts=await queue.getJobCounts('waiting','active','delayed');
 const depth=Number(counts.waiting||0)+Number(counts.active||0)+Number(counts.delayed||0);
 if(depth>=1000){require('../infrastructure/scaleMetrics').inc('queue_rejected_total',{queue:'storage-sync'});const e=Object.assign(Error('storage-sync queue is at backpressure limit'),{code:'BACKPRESSURE'});throw e;}
 await queue.add('storage-sync-write',{filename,data,scope:scopeLabel},{jobId,attempts:5,backoff:{type:'exponential',delay:1000},removeOnComplete:250,removeOnFail:250});
 require('../infrastructure/scaleMetrics').gauge('queue_depth',{queue:'storage-sync'},depth+1);
 return true;
}
async function closeQueues(){await Promise.allSettled([...queues.values()].map(q=>q.close()));queues.clear();connection?.disconnect();connection=null;}
module.exports={getQueue,getRedisConnection,enqueueStorageSync,closeQueues};
