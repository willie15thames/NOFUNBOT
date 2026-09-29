'use strict';

const GROUPS = new Set(['SKILL','PHYSICAL','MENTAL','SPECIAL']);
const OVERFLOW = new Set(['REJECT','BANK_LOCKED','CONVERT','EXPIRE']);
const TIER_MODES=new Set(['BASIC','RANDOM','MANUAL']);

function intOrNull(v, name) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw Object.assign(new Error(`${name} must be a non-negative integer`), { code:'INVALID_POLICY' });
  return n;
}
function normalizePolicy(input = {}) {
  const attr = input.attribute || {};
  const allowedGroups = Array.isArray(attr.allowedGroups) && attr.allowedGroups.length
    ? attr.allowedGroups.map(x=>String(x).toUpperCase()) : ['SKILL'];
  if (allowedGroups.some(x=>!GROUPS.has(x))) throw Object.assign(new Error('attribute.allowedGroups contains an unsupported group'), {code:'INVALID_POLICY'});
  const overflow = String(attr.overflow || 'REJECT').toUpperCase();
  if (!OVERFLOW.has(overflow)) throw Object.assign(new Error('attribute.overflow is invalid'), {code:'INVALID_POLICY'});
  const tierMode=String(input.tier?.mode||'BASIC').toUpperCase();
  const tierCount=intOrNull(input.tier?.count??4,'tier.count');
  if(!TIER_MODES.has(tierMode)||tierCount<1||tierCount>4)throw Object.assign(new Error('tier mode/count is invalid'),{code:'INVALID_POLICY'});
  const format=String(input.postseason?.format||'SINGLE_ELIMINATION').toUpperCase();
  if(format!=='SINGLE_ELIMINATION')throw Object.assign(new Error('postseason format is unsupported'),{code:'INVALID_POLICY'});
  const transitions=input.special?.devTraitTransitions||[];
  if(!Array.isArray(transitions)||transitions.some(x=>!x||typeof x.from!=='string'||typeof x.to!=='string'||!x.from||!x.to||x.from===x.to))
    throw Object.assign(new Error('special.devTraitTransitions must contain explicit from/to values'),{code:'INVALID_POLICY'});
  const ageResetTarget=intOrNull(input.special?.ageResetTarget,'special.ageResetTarget');
  if(ageResetTarget!=null&&ageResetTarget>99)throw Object.assign(new Error('Age reset target exceeds editable rating range'),{code:'INVALID_POLICY'});
  if(overflow==='CONVERT'){
    const rewardType=String(attr.overflowConversion?.rewardType||'').trim().toUpperCase();
    const pointsPerUnit=intOrNull(attr.overflowConversion?.pointsPerUnit,'attribute.overflowConversion.pointsPerUnit');
    if(!rewardType||rewardType==='ATTRIBUTE_POINTS'||!pointsPerUnit)throw Object.assign(new Error('CONVERT overflow requires a non-attribute rewardType and positive pointsPerUnit'),{code:'INVALID_POLICY'});
  }
  return Object.freeze({
    tier: { mode:tierMode, count:tierCount },
    initial: {
      attributeBudget: intOrNull(input.initial?.attributeBudget ?? 0,'initial.attributeBudget') || 0,
      devTraits: intOrNull(input.initial?.devTraits ?? 0,'initial.devTraits') || 0,
      ageResets: intOrNull(input.initial?.ageResets ?? 0,'initial.ageResets') || 0,
    },
    rewards: {
      memberSeasonEarnedCap: intOrNull(input.rewards?.memberSeasonEarnedCap,'rewards.memberSeasonEarnedCap'),
    },
    special:{devTraitTransitions:transitions.map(x=>({from:String(x.from).trim().toLowerCase().replace(/[\s_-]+/g,''),to:String(x.to).trim().toLowerCase().replace(/[\s_-]+/g,'')})),ageResetTarget},
    attribute: {
      enabled: attr.enabled !== false,
      allowedGroups,
      allowlist: [...new Set((attr.allowlist || []).map(String))],
      denylist: [...new Set((attr.denylist || []).map(String))],
      memberSeasonCap: intOrNull(attr.memberSeasonCap,'attribute.memberSeasonCap'),
      teamSeasonCap: intOrNull(attr.teamSeasonCap,'attribute.teamSeasonCap'),
      playerSeasonCap: intOrNull(attr.playerSeasonCap,'attribute.playerSeasonCap'),
      perClaimCap: intOrNull(attr.perClaimCap,'attribute.perClaimCap'),
      perAttributeCap: intOrNull(attr.perAttributeCap,'attribute.perAttributeCap'),
      overflow,
      overflowConversion: overflow==='CONVERT' ? {
        rewardType:String(attr.overflowConversion?.rewardType||'').trim().toUpperCase(),
        pointsPerUnit:intOrNull(attr.overflowConversion?.pointsPerUnit,'attribute.overflowConversion.pointsPerUnit'),
      } : null,
      overflowExpiryDays: overflow==='EXPIRE' ? intOrNull(attr.overflowExpiryDays ?? 0,'attribute.overflowExpiryDays') : null,
    },
    forfeiture: {
      onLeave: input.forfeiture?.onLeave !== false,
      onKick: input.forfeiture?.onKick !== false,
      onBan: input.forfeiture?.onBan !== false,
    },
    postseason: {
      format,
      seedCount: intOrNull(input.postseason?.seedCount ?? 8,'postseason.seedCount') || 8,
      reseed: !!input.postseason?.reseed,
      byes: intOrNull(input.postseason?.byes ?? 0,'postseason.byes') || 0,
      rewards: input.postseason?.rewards && typeof input.postseason.rewards==='object' ? input.postseason.rewards : {},
    },
  });
}
function validateAttributeSpend({ policy, attribute, group, points, totals = {} }) {
  policy = normalizePolicy(policy);
  const p = Number(points);
  if (!Number.isInteger(p) || p <= 0) return {ok:false, code:'INVALID_POINTS'};
  if (!policy.attribute.enabled) return {ok:false, code:'ATTRIBUTE_DISABLED'};
  const g=String(group||'').toUpperCase();
  if (!policy.attribute.allowedGroups.includes(g)) return {ok:false, code:'ATTRIBUTE_GROUP_BLOCKED'};
  if (policy.attribute.allowlist.length && !policy.attribute.allowlist.includes(attribute)) return {ok:false, code:'ATTRIBUTE_NOT_ALLOWED'};
  if (policy.attribute.denylist.includes(attribute)) return {ok:false, code:'ATTRIBUTE_DENIED'};
  const checks=[
    ['perClaimCap',p,'CLAIM_CAP_EXCEEDED'],
    ['memberSeasonCap',(totals.memberSpent||0)+p,'MEMBER_CAP_EXCEEDED'],
    ['teamSeasonCap',(totals.teamSpent||0)+p,'TEAM_CAP_EXCEEDED'],
    ['playerSeasonCap',(totals.playerSpent||0)+p,'PLAYER_CAP_EXCEEDED'],
    ['perAttributeCap',(totals.attributeSpent||0)+p,'ATTRIBUTE_CAP_EXCEEDED'],
  ];
  for(const [key,value,code] of checks){const cap=policy.attribute[key];if(cap!=null&&value>cap)return{ok:false,code,cap,attempted:value};}
  return {ok:true};
}
module.exports={normalizePolicy,validateAttributeSpend,GROUPS,OVERFLOW};
