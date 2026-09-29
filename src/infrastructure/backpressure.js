'use strict';
const metrics=require('./scaleMetrics');

function createBackpressureGate({maxInFlight=50,maxQueued=250,queueTimeoutMs=30000,name='default'}={}) {
  maxInFlight=Math.max(1,Number(maxInFlight)||1);
  maxQueued=Math.max(0,Number(maxQueued)||0);
  queueTimeoutMs=Math.max(0,Number(queueTimeoutMs)||0);
  let inFlight=0,rejected=0,timedOut=0,maxObserved=0;
  const queue=[];

  function snapshot(){return{inFlight,queued:queue.length,rejected,timedOut,maxObserved,maxInFlight,maxQueued,queueTimeoutMs};}
  function publish(){const labels={gate:name};metrics.gauge('backpressure_in_flight',labels,inFlight);metrics.gauge('backpressure_queued',labels,queue.length);metrics.gauge('backpressure_max_observed',labels,maxObserved);}
  function rejectBusy(code='BACKPRESSURE'){
    rejected++;metrics.inc('backpressure_rejected_total',{gate:name,code});publish();
    const e=Object.assign(new Error(code==='BACKPRESSURE_TIMEOUT'?'System busy; queue wait expired':'System busy; retry later'),{code});
    throw e;
  }
  function drain(){
    while(inFlight<maxInFlight&&queue.length){
      const item=queue.shift();
      if(item.timer)clearTimeout(item.timer);
      item.start();
    }
    publish();
  }
  async function execute(work,resolve,reject){
    inFlight++;maxObserved=Math.max(maxObserved,inFlight);publish();const started=Date.now();
    try{resolve(await work());}
    catch(e){reject(e);}
    finally{inFlight--;metrics.observe('backpressure_work_ms',{gate:name},Date.now()-started);drain();}
  }
  function run(work){
    if(typeof work!=='function')return Promise.reject(Object.assign(new TypeError('work must be a function'),{code:'INVALID_WORK'}));
    return new Promise((resolve,reject)=>{
      const start=()=>execute(work,resolve,reject);
      if(inFlight<maxInFlight){start();return;}
      if(queue.length>=maxQueued){try{rejectBusy();}catch(e){reject(e);}return;}
      const item={start,timer:null};
      if(queueTimeoutMs>0){item.timer=setTimeout(()=>{
        const i=queue.indexOf(item);if(i<0)return;queue.splice(i,1);timedOut++;metrics.inc('backpressure_timeout_total',{gate:name});publish();
        reject(Object.assign(new Error('System busy; queue wait expired'),{code:'BACKPRESSURE_TIMEOUT'}));
      },queueTimeoutMs);}
      queue.push(item);metrics.inc('backpressure_queued_total',{gate:name});publish();
    });
  }
  function clear(reason='BACKPRESSURE_CLOSED'){
    const err=Object.assign(new Error('Backpressure gate closed'),{code:reason});
    while(queue.length){const item=queue.shift();if(item.timer)clearTimeout(item.timer);/* unresolved task is intentionally dropped only during shutdown */}
    publish();return err;
  }
  publish();
  return {run,metrics:snapshot,clear};
}
module.exports={createBackpressureGate};
