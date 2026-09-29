/*
 * Process-local scheduler registry. Timers are wake-ups only; durable owners must persist dueAt/state separately.
 * This registry provides one place for cancellation, inspection, and duplicate ownership prevention.
 */
'use strict';

const { makeLogger } = require('../utils/logger');
const log = makeLogger('schedulerRegistry');
const jobs = new Map();

function _id(key, guildId) { return `${guildId || 'global'}::${key}`; }
function cancel(key, guildId) {
  const id = _id(key, guildId); const row = jobs.get(id);
  if (!row) return false;
  if (row.handle) row.kind === 'interval' ? clearInterval(row.handle) : clearTimeout(row.handle);
  jobs.delete(id); return true;
}

function registerTimeout({ key, guildId = null, dueAt, durable = false, owner = 'unknown', callback }) {
  if (!key || typeof callback !== 'function') throw new Error('scheduler timeout requires key + callback');
  cancel(key, guildId);
  const id = _id(key, guildId); const target = Math.max(Date.now(), Number(dueAt) || Date.now());
  const delay = Math.max(0, target - Date.now());
  const row = { id, key, guildId, kind:'timeout', dueAt:target, durable:!!durable, owner, createdAt:Date.now(), handle:null };
  row.handle = setTimeout(async () => {
    jobs.delete(id);
    try { await callback(); } catch (err) { log.error(`timer ${id} failed`, err); }
  }, delay);
  row.handle.unref?.(); jobs.set(id, row); return row;
}

function registerInterval({ key, guildId = null, everyMs, owner = 'unknown', callback }) {
  if (!key || typeof callback !== 'function' || !(Number(everyMs) > 0)) throw new Error('scheduler interval requires key + everyMs + callback');
  cancel(key, guildId);
  const id = _id(key, guildId);
  const row = { id, key, guildId, kind:'interval', everyMs:Number(everyMs), durable:false, owner, createdAt:Date.now(), handle:null };
  row.handle = setInterval(async () => { try { await callback(); } catch (err) { log.error(`interval ${id} failed`, err); } }, Number(everyMs));
  row.handle.unref?.(); jobs.set(id, row); return row;
}
function cancelAll(key) {
  let count=0;
  for (const row of [...jobs.values()]) { if (String(row.key) !== String(key)) continue; if (cancel(row.key,row.guildId)) count+=1; }
  return count;
}
function get(key, guildId) { const row=jobs.get(_id(key,guildId)); return row ? { ...row, handle:undefined } : null; }
function list(guildId = null) { return [...jobs.values()].filter(r => guildId == null || String(r.guildId)===String(guildId)).map(r=>({ ...r, handle:undefined })); }
function resetForTests(){ for(const r of jobs.values()) if(r.handle) r.kind==='interval'?clearInterval(r.handle):clearTimeout(r.handle); jobs.clear(); }
module.exports={registerTimeout,registerInterval,cancel,cancelAll,get,list,resetForTests};
