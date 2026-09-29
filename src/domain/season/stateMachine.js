'use strict';
const STATES = Object.freeze(['PRESEASON_SETUP','PRESEASON_ACTIVE','REGULAR_SEASON','POSTSEASON_SEEDING','POSTSEASON_ACTIVE','OFFSEASON','ARCHIVED']);
const NEXT = Object.freeze({
  PRESEASON_SETUP:['PRESEASON_ACTIVE'],
  PRESEASON_ACTIVE:['REGULAR_SEASON'],
  REGULAR_SEASON:['POSTSEASON_SEEDING','OFFSEASON'],
  POSTSEASON_SEEDING:['POSTSEASON_ACTIVE'],
  POSTSEASON_ACTIVE:['OFFSEASON'],
  OFFSEASON:['ARCHIVED'],
  ARCHIVED:[],
});
function canTransition(from,to){return !!NEXT[String(from)]?.includes(String(to));}
function transition(from,to,{override=false}={}) {
  if (!STATES.includes(String(from)) || !STATES.includes(String(to))) return {ok:false,code:'INVALID_STATE'};
  if (!override && !canTransition(from,to)) return {ok:false,code:'INVALID_TRANSITION',from,to};
  return {ok:true,from,to};
}
module.exports={STATES,NEXT,canTransition,transition};
