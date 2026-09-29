'use strict';

function planOverflow({ mode='REJECT', cap=null, currentEarned=0, incoming=0, conversion=null, expiryDays=null }={}){
  mode=String(mode||'REJECT').toUpperCase();
  currentEarned=Number(currentEarned)||0; incoming=Number(incoming)||0;
  if(!Number.isInteger(incoming)||incoming<0) throw Object.assign(Error('Incoming reward must be a non-negative integer'),{code:'INVALID_POINTS'});
  if(cap==null) return {ok:true,mode,accepted:incoming,locked:0,forfeited:0,convertQuantity:0,convertRemainder:0,expiresAt:null};
  cap=Number(cap);
  const room=Math.max(0,cap-currentEarned), overflow=Math.max(0,incoming-room), accepted=Math.min(incoming,room);
  if(!overflow) return {ok:true,mode,accepted:incoming,locked:0,forfeited:0,convertQuantity:0,convertRemainder:0,expiresAt:null};
  if(mode==='REJECT') return {ok:false,code:'MEMBER_EARNED_CAP',cap,attempted:currentEarned+incoming,overflow};
  if(mode==='BANK_LOCKED') return {ok:true,mode,accepted:incoming,locked:overflow,forfeited:0,convertQuantity:0,convertRemainder:0,expiresAt:null};
  if(mode==='EXPIRE'){
    const days=Number(expiryDays);
    if(!Number.isInteger(days)||days<0) throw Object.assign(Error('Overflow expiryDays must be a non-negative integer'),{code:'INVALID_POLICY'});
    return {ok:true,mode,accepted,locked:0,forfeited:overflow,convertQuantity:0,convertRemainder:0,expiresAt:new Date(Date.now()+days*86400000)};
  }
  if(mode==='CONVERT'){
    const pointsPerUnit=Number(conversion?.pointsPerUnit), rewardType=String(conversion?.rewardType||'').trim().toUpperCase();
    if(!Number.isInteger(pointsPerUnit)||pointsPerUnit<1||!rewardType||rewardType==='ATTRIBUTE_POINTS') throw Object.assign(Error('Overflow conversion requires a non-attribute rewardType and positive pointsPerUnit'),{code:'INVALID_POLICY'});
    const qty=Math.floor(overflow/pointsPerUnit), remainder=overflow%pointsPerUnit;
    return {ok:true,mode,accepted,locked:remainder,forfeited:0,convertQuantity:qty,convertRemainder:remainder,convertRewardType:rewardType,expiresAt:null};
  }
  throw Object.assign(Error('Unsupported overflow mode'),{code:'INVALID_POLICY'});
}
module.exports={planOverflow};
