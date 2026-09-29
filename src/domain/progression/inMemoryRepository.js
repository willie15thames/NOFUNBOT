'use strict';
const { randomUUID } = require('crypto');
class InMemoryProgressionRepository{
 constructor(){this.policies=[];this.seasons=[];this.grants=[];this.wallets=[];this.claims=[];this.mutations=[];this.consumptions=[];this.tenures=[];this.tiers=[];this.brackets=[];this.matches=[];}
 _id(prefix){return `${prefix}_${randomUUID()}`;}
 createSeason(row){if(!row.guildId||!row.leagueId||!row.id)throw Error('canonical ids required');if(this.seasons.some(x=>x.id===row.id))throw Object.assign(Error('season exists'),{code:'CONFLICT'});this.seasons.push({...row});return{...row};}
 addPolicy(row){if(this.policies.some(x=>x.seasonId===row.seasonId&&x.version===row.version))throw Object.assign(Error('policy version exists'),{code:'CONFLICT'});this.policies.push({...row});return{...row};}
 getPolicy(id){return this.policies.find(x=>x.id===id)||null;}
 addGrant(row){const uniq=`${row.ownerType}:${row.ownerId}:${row.seasonId}:${row.rewardType}:${row.sourceType}:${row.sourceId||''}`;if(this.grants.some(x=>x._uniq===uniq))return {...this.grants.find(x=>x._uniq===uniq),idempotent:true};const out={id:row.id||this._id('grant'),status:'AVAILABLE',quantity:1,points:0,...row,_uniq:uniq};this.grants.push(out);return{...out};}
 addWallet(row){const found=this.wallets.find(x=>x.ownerType===row.ownerType&&x.ownerId===row.ownerId&&x.seasonId===row.seasonId&&x.currency===row.currency);if(found)return found;const out={id:row.id||this._id('wallet'),earned:0,spent:0,forfeited:0,locked:0,...row};this.wallets.push(out);return out;}
 availableGrant(id){const g=this.grants.find(x=>x.id===id);return g&&g.status==='AVAILABLE'?g:null;}
 spendGrant(id,points){const g=this.availableGrant(id);if(!g||g.rewardType!=='ATTRIBUTE_POINTS'||Number(g.points)<points)return false;g.points-=points;if(g.points===0){g.quantity=0;g.status='CONSUMED';}return true;}
 findClaimByIdempotency(guildId,key){return this.claims.find(x=>x.guildId===guildId&&x.idempotencyKey===key)||null;}
 createClaim(row){const existing=this.findClaimByIdempotency(row.guildId,row.idempotencyKey);if(existing)return {...existing,idempotent:true};const out={id:row.id||this._id('claim'),status:'PENDING',...row};this.claims.push(out);return{...out};}
 addMutation(row){const out={id:row.id||this._id('mutation'),...row};this.mutations.push(out);return out;}
 addConsumption(row){if(this.consumptions.some(x=>x.grantId===row.grantId&&x.claimId===row.claimId))return null;const out={id:row.id||this._id('consume'),...row};this.consumptions.push(out);return out;}
 totals({seasonId,membershipId,teamId,playerId,attribute}){const ms=this.mutations.filter(x=>x.seasonId===seasonId&&x.mutationType==='ATTRIBUTE'&&x.status!=='REVERSED');return{memberSpent:ms.filter(x=>x.membershipId===membershipId).reduce((a,x)=>a+Number(x.points||0),0),teamSpent:ms.filter(x=>x.teamId===teamId).reduce((a,x)=>a+Number(x.points||0),0),playerSpent:ms.filter(x=>x.playerId===playerId).reduce((a,x)=>a+Number(x.points||0),0),attributeSpent:ms.filter(x=>x.playerId===playerId&&x.attributeKey===attribute).reduce((a,x)=>a+Number(x.points||0),0)};}
 transaction(fn){const snap=JSON.stringify(this);try{return fn(this);}catch(e){Object.assign(this,JSON.parse(snap));throw e;}}
 startTenure(row){const out={id:row.id||this._id('tenure'),joinedAt:Date.now(),leftAt:null,...row};this.tenures.push(out);return out;}
 closeTenure(membershipId,departureType){const t=[...this.tenures].reverse().find(x=>x.membershipId===membershipId&&!x.leftAt);if(!t)return null;t.leftAt=Date.now();t.departureType=departureType;return t;}
 forfeitMemberGrants({seasonId,membershipId}){let n=0;for(const g of this.grants){if(g.seasonId===seasonId&&g.ownerType==='MEMBER'&&g.ownerId===membershipId&&g.status==='AVAILABLE'){g.status='FORFEITED';n++;}}return n;}
}
module.exports={InMemoryProgressionRepository};
