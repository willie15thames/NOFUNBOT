/*
 * NAVIGATION HEADER
 * FILE: src/utils/httpIntake.js
 * LAYER: Utility/helper layer
 * PURPOSE: The ONE external HTTP intake path (V202 / BUG-010). Every outbound fetch to a non-Discord-API
 *          destination (attachments, provider endpoints, avatar images, webhooks) goes through fetchExternal()
 *          so timeout, size cap, host policy, private-destination rejection and content-type validation are
 *          enforced in one place instead of per call site.
 * LOOK HERE FIRST WHEN DEBUGGING: fetchExternal(), validateExternalUrl(), DEFAULTS.
 * RELATED FLOW: scheduleRegistryService.importAttachmentUrl, liveSyncService, fileIntakeService.fetchBuffer,
 *               botIdentityService avatar fetch, providers/*.
 * NOTE: Returns structured failures ({ ok:false, reason }) — callers decide whether a failure is fatal.
 */

'use strict';

const { safeUrl } = require('./safeUrl');

const DEFAULTS = Object.freeze({
  timeoutMs: 15000,
  maxBytes: 8 * 1024 * 1024, // 8 MB — schedule/stat exports are small; Companion exports are capped separately
  method: 'GET',
});

// Hosts that may be fetched when a caller does not pass its own allowlist.
// Discord CDN hosts are the historic default for attachment intake (CIA-03).
const DISCORD_CDN_HOSTS = Object.freeze([
  'cdn.discordapp.com',
  'media.discordapp.net',
  'attachments.discord.com',
  'images-ext-1.discordapp.net',
  'images-ext-2.discordapp.net',
]);

const net=require('node:net');
const dns=require('node:dns');
const blocked=new net.BlockList();
for(const [address,prefix]of [['0.0.0.0',8],['10.0.0.0',8],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['100.64.0.0',10],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(address,prefix,'ipv4');
const globalV6=new net.BlockList();globalV6.addSubnet('2000::',3,'ipv6');
function _isPrivateHostname(hostname){
 const h=String(hostname||'').toLowerCase().replace(/^\[|\]$/g,'');
 if(!h||h==='localhost'||/\.(localhost|local|internal)$/.test(h))return true;
 const family=net.isIP(h);
 if(family===4)return blocked.check(h,'ipv4');
 if(family===6)return !globalV6.check(h,'ipv6')||h.startsWith('2001:db8:')||h.startsWith('2001:0:')||h.startsWith('2002:');
 return false;
}
function validatedLookup(resolve=dns.lookup,allowPrivate=false){
 return(hostname,options,callback)=>resolve(hostname,{all:true,verbatim:true},(err,addresses)=>{
  if(err)return callback(err);
  if(!addresses?.length||addresses.some(a=>!net.isIP(a.address)||(!allowPrivate&&_isPrivateHostname(a.address))))return callback(Object.assign(Error('Private or invalid DNS destination rejected'),{code:'PRIVATE_DESTINATION'}));
  const family=Number(options.family)||0;const usable=family?addresses.filter(a=>a.family===family):addresses;
  if(!usable.length)return callback(Error('No address for requested family'));
  if(options.all)return callback(null,usable);
  callback(null,usable[0].address,usable[0].family);
 });
}

/**
 * Validate a URL against the intake policy without fetching it.
 * @returns {{ ok:true, url:URL } | { ok:false, reason:string, hostname?:string }}
 */
function validateExternalUrl(input, opts = {}) {
  const url = safeUrl(input);
  if (!url) return { ok: false, reason: 'invalid-url' };
  if (url.protocol !== 'https:' && !(opts.allowHttp && url.protocol === 'http:')) {
    return { ok: false, reason: 'protocol-not-allowed', hostname: url.hostname };
  }
  if (url.username || url.password) return { ok: false, reason: 'credentials-in-url', hostname: url.hostname };
  if (!opts.allowPrivate && _isPrivateHostname(url.hostname)) {
    return { ok: false, reason: 'private-destination', hostname: url.hostname };
  }
  const allowed = opts.allowedHosts;
  if (Array.isArray(allowed) || allowed instanceof Set) {
    const set = allowed instanceof Set ? allowed : new Set(allowed.map(h => String(h).toLowerCase()));
    if (!set.has(url.hostname.toLowerCase())) return { ok: false, reason: 'host-not-allowed', hostname: url.hostname };
  }
  return { ok: true, url };
}

function _responseMeta(res) {
  return {
    etag: res?.headers?.get?.('etag') || null,
    lastModified: res?.headers?.get?.('last-modified') || null,
    retryAfter: res?.headers?.get?.('retry-after') || null,
  };
}

function _contentTypeAllowed(actual, expected) {
  if (!expected || !expected.length) return true;
  const ct = String(actual || '').toLowerCase().split(';')[0].trim();
  if (!ct) return false;
  return expected.some(e => {
    const want = String(e).toLowerCase();
    if(want.includes('*+')){const [prefix,suffix]=want.split('*');return ct.startsWith(prefix)&&ct.endsWith(suffix);}
    if (want.endsWith('/*')) return ct.startsWith(want.slice(0, -1));
    return ct === want;
  });
}

async function _readBodyCapped(res, maxBytes) {
  // Prefer streaming so a hostile/huge body is cut off at the cap instead of buffered entirely.
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        return { ok: false, reason: 'max-bytes-exceeded', bytes: total };
      }
      chunks.push(Buffer.from(value));
    }
    return { ok: true, buffer: Buffer.concat(chunks) };
  }
  const ab = await res.arrayBuffer();
  if (ab.byteLength > maxBytes) return { ok: false, reason: 'max-bytes-exceeded', bytes: ab.byteLength };
  return { ok: true, buffer: Buffer.from(ab) };
}

/**
 * Fetch an external resource under the intake policy.
 *
 * @param {object} req
 * @param {string} req.url
 * @param {string} [req.method]
 * @param {object} [req.headers]
 * @param {string|Buffer} [req.body]
 * @param {number} [req.timeoutMs]
 * @param {number} [req.maxBytes]
 * @param {Array<string>|Set<string>} [req.allowedHosts]  when omitted, any public https host is allowed
 * @param {Array<string>} [req.expectedContentTypes]      e.g. ['application/json','text/*']
 * @param {'buffer'|'text'|'json'} [req.parse]             default 'buffer'
 * @param {boolean} [req.allowHttp]
 * @param {boolean} [req.allowPrivate]
 * @param {object} [req.fetchImpl]                        test seam
 * @returns {Promise<{ok:true,status:number,contentType:string,bytes:number,data:any,buffer:Buffer}|{ok:false,reason:string,status?:number,error?:string,hostname?:string}>}
 */
async function fetchExternal(req = {}) {
  const check = validateExternalUrl(req.url, { allowedHosts: req.allowedHosts, allowHttp: req.allowHttp, allowPrivate: req.allowPrivate });
  if (!check.ok) return check;

  const timeoutMs = Number(req.timeoutMs || DEFAULTS.timeoutMs);
  const maxBytes = Number(req.maxBytes || DEFAULTS.maxBytes);
  const fetchImpl = req.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'fetch-unavailable' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();

  let res,dispatcher;
  if(!req.fetchImpl){
    const {Agent}=require('undici');
    dispatcher=new Agent({connect:{lookup:validatedLookup(dns.lookup,!!req.allowPrivate)}});
  }
  try {
    res = await fetchImpl(check.url.toString(), {
      method: req.method || DEFAULTS.method,
      headers: req.headers || {},
      body: req.body,
      signal: controller.signal,
      ...(dispatcher?{dispatcher}:{}),
      redirect: 'manual', // a redirect to a private/unallowed host must not be followed silently
    });
  } catch (err) {
    clearTimeout(timer);
    if(dispatcher)await dispatcher.destroy();
    const aborted = err?.name === 'AbortError' || /aborted/i.test(String(err?.message || ''));
    return { ok: false, reason: aborted ? 'timeout' : 'network-error', error: String(err?.message || err) };
  }

  try {
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, reason: 'redirect-not-followed', status: res.status };
    }
    const accepted = Array.isArray(req.acceptStatuses) && req.acceptStatuses.includes(res.status);
    if (!res.ok && !accepted) return { ok: false, reason: 'bad-status', status: res.status, headers: _responseMeta(res) };
    if (accepted && res.status === 304) return { ok:true, status:304, notModified:true, contentType:String(res.headers?.get?.('content-type')||''), bytes:0, data:null, buffer:Buffer.alloc(0), headers:_responseMeta(res) };
    const contentType = String(res.headers?.get?.('content-type') || '');
    if (!_contentTypeAllowed(contentType, req.expectedContentTypes)) {
      return { ok: false, reason: 'unexpected-content-type', status: res.status, contentType };
    }
    const declared = Number(res.headers?.get?.('content-length') || 0);
    if (declared && declared > maxBytes) return { ok: false, reason: 'max-bytes-exceeded', bytes: declared };
    const body = await _readBodyCapped(res, maxBytes);
    if (!body.ok) return { ...body, status: res.status };
    const buffer = body.buffer;
    let data = buffer;
    if (req.parse === 'text') data = buffer.toString('utf8');
    if (req.parse === 'json') {
      try { data = JSON.parse(buffer.toString('utf8')); }
      catch (e) { return { ok: false, reason: 'invalid-json', status: res.status, error: e.message }; }
    }
    return { ok: true, status: res.status, contentType, bytes: buffer.length, data, buffer, headers:_responseMeta(res) };
  } catch(err) {
    return {ok:false,reason:controller.signal.aborted?'timeout':'body-read-failed',error:err.message};
  } finally {
    clearTimeout(timer);
    if(dispatcher)await dispatcher.destroy();
  }
}

module.exports = { validatedLookup, fetchExternal, validateExternalUrl, DISCORD_CDN_HOSTS, DEFAULTS };
