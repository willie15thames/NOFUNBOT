'use strict';

class Semaphore {
  constructor(limit = 1) { this.limit=Math.max(1,Number(limit)||1); this.active=0; this.queue=[]; }
  acquire(timeoutMs = 0) {
    if (this.active < this.limit) { this.active += 1; return Promise.resolve(() => this.release()); }
    return new Promise((resolve,reject) => {
      const item={resolve,reject,timer:null};
      if (timeoutMs > 0) item.timer=setTimeout(()=>{ const i=this.queue.indexOf(item); if(i>=0)this.queue.splice(i,1); reject(new Error('SEMAPHORE_TIMEOUT')); },timeoutMs);
      this.queue.push(item);
    }).then(() => () => this.release());
  }
  release(){
    if(this.active>0)this.active-=1;
    const next=this.queue.shift();
    if(!next)return;
    if(next.timer)clearTimeout(next.timer);
    this.active+=1;
    next.resolve();
  }
  stats(){return{limit:this.limit,active:this.active,queued:this.queue.length};}
}
module.exports={Semaphore};
