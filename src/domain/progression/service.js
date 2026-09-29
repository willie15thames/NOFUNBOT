'use strict';
const { normalizePolicy, validateAttributeSpend } = require('./policy');
const {validateGrantSpend,validateProviderEvidence}=require('./claimValidation');

function assertCanonical(v,name){if(!v||['default','current','global'].includes(String(v).toLowerCase()))throw Object.assign(new Error(`${name} requires canonical identity`),{code:'INVALID_CONTEXT'});return String(v);}
class ProgressionService{
 constructor(repo,{verifyPlayer}={}){this.repo=repo;this.verifyPlayer=verifyPlayer;}
 issueInitialGrant({guildId,leagueId,seasonId,teamId,rewardType,quantity=1,points=0,policyVersionId}){
  [guildId,leagueId,seasonId,teamId,policyVersionId].forEach((v,i)=>assertCanonical(v,['guildId','leagueId','seasonId','teamId','policyVersionId'][i]));
  return this.repo.addGrant({guildId,leagueId,seasonId,ownerType:'TEAM',ownerId:teamId,rewardType,quantity,points,sourceType:'INITIAL_TEAM',sourceId:policyVersionId,policyVersionId});
 }
 issueMemberReward({guildId,leagueId,seasonId,membershipId,rewardType,quantity=1,points=0,sourceType,sourceId,expiresAt=null,policyVersionId}){
  [guildId,leagueId,seasonId,membershipId,policyVersionId].forEach((v,i)=>assertCanonical(v,['guildId','leagueId','seasonId','membershipId','policyVersionId'][i]));
  if(!sourceType||!sourceId)throw Object.assign(Error('reward provenance required'),{code:'INVALID_PROVENANCE'});
  const row={guildId,leagueId,seasonId,ownerType:'MEMBER',ownerId:membershipId,rewardType,quantity,points,sourceType,sourceId,expiresAt,policyVersionId};
  return this.repo.issueMemberReward?this.repo.issueMemberReward(row):this.repo.addGrant(row);
 }
 async claimAttribute(input){
  const {guildId,leagueId,seasonId,membershipId,teamId,playerId,grantId,attributeKey,attributeGroup,points,idempotencyKey,actorId}=input;
  for(const [n,v] of Object.entries({guildId,leagueId,seasonId,membershipId,teamId,playerId,grantId,idempotencyKey,actorId}))assertCanonical(v,n);
  if(typeof this.verifyPlayer!=='function')return{ok:false,code:'PROVIDER_VERIFICATION_UNAVAILABLE'};
  if(this.repo.claimAttribute)return this.repo.claimAttribute(input,this.verifyPlayer);
  const prior=this.repo.findClaimByIdempotency?.(guildId,idempotencyKey); if(prior)return{ok:true,idempotent:true,claim:{...prior}};
  const grant=this.repo.availableGrant(grantId); if(!grant)return{ok:false,code:'ENTITLEMENT_UNAVAILABLE'};
  if(!((grant.ownerType==='MEMBER'&&grant.ownerId===membershipId)||(grant.ownerType==='TEAM'&&grant.ownerId===teamId)))return{ok:false,code:'ENTITLEMENT_OWNERSHIP'};
  if(grant.seasonId!==seasonId||grant.leagueId!==leagueId||grant.guildId!==guildId)return{ok:false,code:'ENTITLEMENT_SCOPE'};
  if(grant.expiresAt&&new Date(grant.expiresAt).getTime()<=Date.now())return{ok:false,code:'ENTITLEMENT_EXPIRED'};
  const entitlement=validateGrantSpend(grant,points);if(!entitlement.ok)return entitlement;
  const policyRow=this.repo.getPolicy(grant.policyVersionId);if(!policyRow)return{ok:false,code:'POLICY_NOT_FOUND'};
  const policy=normalizePolicy(policyRow.policy);
  const verified=await this.verifyPlayer({guildId,leagueId,seasonId,teamId,playerId,attributeKey,points});
  const evidence=validateProviderEvidence(input,verified);if(!evidence.ok)return evidence;
  return this.repo.transaction(repo=>{
    const existing=repo.findClaimByIdempotency?.(guildId,idempotencyKey);if(existing)return{ok:true,idempotent:true,claim:{...existing}};
    const current=repo.availableGrant(grantId);if(!current)return{ok:false,code:'ENTITLEMENT_UNAVAILABLE'};
    const budget=validateGrantSpend(current,points);if(!budget.ok)return budget;
    const totals=repo.totals({seasonId,membershipId,teamId,playerId,attribute:attributeKey});
    const check=validateAttributeSpend({policy,attribute:attributeKey,group:attributeGroup,points,totals});if(!check.ok)return check;
    const claim=repo.createClaim({guildId,leagueId,seasonId,membershipId,teamId,playerId,grantId,policyVersionId:grant.policyVersionId,idempotencyKey,requestedMutations:[{type:'ATTRIBUTE',attributeKey,attributeGroup,points}],requestedAt:Date.now(),actorId});
    if(!repo.spendGrant(grantId,points))throw Object.assign(Error('entitlement became unavailable'),{code:'CONFLICT'});
    const mutation=repo.addMutation({guildId,leagueId,seasonId,membershipId,teamId,playerId,claimId:claim.id,mutationType:'ATTRIBUTE',attributeKey,points,before:evidence.before,after:evidence.after,providerVerification:verified.provenance,status:'APPLIED',actorId,appliedAt:Date.now()});
    const consumed=repo.addConsumption({grantId,claimId:claim.id,mutationId:mutation.id,quantity:points,consumedAt:Date.now()});
    if(!consumed)throw Object.assign(Error('entitlement already consumed for claim'),{code:'CONFLICT'});
    const stored=repo.claims.find(x=>x.id===claim.id); stored.status='APPROVED';stored.approvedBy=actorId;stored.approvedAt=Date.now();
    return{ok:true,claim:{...stored},mutation:{...mutation}};
  });
 }
 departMember({seasonId,membershipId,departureType,policyVersionId}){
  assertCanonical(seasonId,'seasonId');assertCanonical(membershipId,'membershipId');
  const p=this.repo.getPolicy(policyVersionId);if(!p)return{ok:false,code:'POLICY_NOT_FOUND'};
  const policy=normalizePolicy(p.policy);const key={LEAVE:'onLeave',KICK:'onKick',BAN:'onBan'}[String(departureType).toUpperCase()];
  this.repo.closeTenure(membershipId,String(departureType).toUpperCase());
  const forfeited=key&&policy.forfeiture[key]?this.repo.forfeitMemberGrants({seasonId,membershipId}):0;
  return{ok:true,forfeited};
 }
}
module.exports={ProgressionService,assertCanonical};
