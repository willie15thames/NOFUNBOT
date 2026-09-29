'use strict';
const {createHash}=require('crypto');
function normalizeScope(scope={}){
 const guildId=String(scope.guildId||'').trim();
 const spaceId=String(scope.spaceId||'').trim();
 if(guildId)return `guild:${guildId}${spaceId?`:space:${spaceId}`:''}`;
 if(spaceId)return `space:${spaceId}`;
 return 'system:unscoped';
}
function storageJobId(filename,data,scope={}){
 const identity=normalizeScope(scope);
 const digest=createHash('sha256').update(identity).update('\0').update(String(filename)).update('\0').update(JSON.stringify(data)).digest('hex');
 return `storage-${digest}`;
}
module.exports={normalizeScope,storageJobId};
