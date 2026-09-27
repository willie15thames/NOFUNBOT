/*
 * v204.7 provider secret boundary. Secrets never enter AI prompts/status output and are never stored plaintext.
 * AES-256-GCM key material is derived from PROVIDER_SECRET_KEY (or NOFUN_CONNECTION_MASTER_KEY compatibility).
 */
'use strict';
const crypto=require('crypto');
function _key(){const raw=String(process.env.PROVIDER_SECRET_KEY||process.env.NOFUN_CONNECTION_MASTER_KEY||'').trim();return raw?crypto.createHash('sha256').update(raw).digest():null;}
function ready(){return !!_key();}
function encrypt(secret){const value=String(secret||'');if(!value)return null;const key=_key();if(!key)throw Error('PROVIDER_SECRET_KEY/NOFUN_CONNECTION_MASTER_KEY is required');const iv=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',key,iv);const ct=Buffer.concat([c.update(value,'utf8'),c.final()]);const tag=c.getAuthTag();return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;}
function decrypt(blob){if(!blob)return null;const key=_key();if(!key)return null;const [v,ivB,tagB,ctB]=String(blob).split(':');if(v!=='v1'||!ivB||!tagB||!ctB)return null;try{const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(ivB,'base64'));d.setAuthTag(Buffer.from(tagB,'base64'));return Buffer.concat([d.update(Buffer.from(ctB,'base64')),d.final()]).toString('utf8');}catch{return null;}}
function redact(value){if(value==null)return value;return '[secret configured]';}
module.exports={ready,encrypt,decrypt,redact};
