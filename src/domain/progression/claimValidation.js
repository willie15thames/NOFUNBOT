'use strict';
const { resolveAttribute } = require('./attributeCatalog');

function validateGrantSpend(grant, points) {
  if (grant.rewardType !== 'ATTRIBUTE_POINTS') return {ok:false,code:'WRONG_ENTITLEMENT_TYPE'};
  if (!Number.isInteger(Number(points)) || Number(points) <= 0) return {ok:false,code:'INVALID_POINTS'};
  if (Number(grant.points) < Number(points)) return {ok:false,code:'INSUFFICIENT_ENTITLEMENT',remaining:Number(grant.points)};
  return {ok:true};
}

// Only a trusted provider adapter may supply this evidence. Never read before/after
// or team/position from a member's command options.
function validateProviderEvidence(input, verified) {
  if (!verified?.ok || verified.applied !== true || !verified.gameId || !verified.gameVersion || !verified.provenance?.provider ||
      !verified.provenance?.snapshotId || !verified.provenance?.verifiedAt ||
      String(verified.teamId) !== String(input.teamId) ||
      String(verified.playerId) !== String(input.playerId)) return {ok:false,code:'PLAYER_NOT_VERIFIED'};
  const entry=resolveAttribute(input.attributeKey,{gameId:verified.gameId,gameVersion:verified.gameVersion,position:verified.position});
  if (!entry || entry.key !== input.attributeKey || entry.group !== input.attributeGroup) return {ok:false,code:'ATTRIBUTE_NOT_EDITABLE'};
  const before=Number(verified.before),after=Number(verified.after);
  if (!Number.isInteger(before)||!Number.isInteger(after)||before<entry.minValue||after>entry.maxValue||after-before!==Number(input.points))
    return {ok:false,code:'PROVIDER_MUTATION_MISMATCH'};
  return {ok:true,entry,before,after};
}
module.exports={validateGrantSpend,validateProviderEvidence};
