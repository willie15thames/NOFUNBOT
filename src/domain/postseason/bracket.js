'use strict';
function buildSingleElimination(seeds,{seedCount=8,byes=0}={}) {
  if(!Array.isArray(seeds)||seeds.length>seedCount)throw Object.assign(new Error('Seed list exceeds configured bracket'),{code:'INVALID_SEEDS'});
  const rows=seeds.map(x=>({seed:Number(x.seed),teamId:String(x.teamId||'')})).sort((a,b)=>a.seed-b.seed);
  if(rows.length<2) throw Object.assign(new Error('At least two seeds are required'),{code:'INVALID_SEEDS'});
  if(rows.some((x,i)=>!x.teamId||x.seed!==i+1))throw Object.assign(new Error('Seeds must be numbered once from 1'),{code:'INVALID_SEEDS'});
  const ids=new Set(rows.map(x=>x.teamId)); if(ids.size!==rows.length) throw Object.assign(new Error('Duplicate team seed'),{code:'DUPLICATE_SEED'});
  const nextPow=2**Math.ceil(Math.log2(rows.length));
  const automaticByes=Math.max(0,nextPow-rows.length);
  if(Number(byes)&&Number(byes)!==automaticByes)throw Object.assign(new Error('Bye count must complete a power-of-two bracket'),{code:'INVALID_BYES'});
  const byeCount=automaticByes;
  const byeTeams=rows.slice(0,byeCount);
  const playing=rows.slice(byeCount);
  const matches=[];
  let lo=0,hi=playing.length-1,slot=1;
  while(lo<hi){matches.push({round:1,slot:slot++,homeTeamId:playing[lo++].teamId,awayTeamId:playing[hi--].teamId,status:'PENDING'});}
  if(lo===hi) byeTeams.push(playing[lo]);
  return {format:'SINGLE_ELIMINATION',seedCount:rows.length,byes:byeTeams.map(x=>x.teamId),matches};
}
function advanceMatch(match,winnerTeamId){
  if(![match.homeTeamId,match.awayTeamId].includes(winnerTeamId)) return {ok:false,code:'INVALID_WINNER'};
  if(match.status==='COMPLETE') return match.winnerTeamId===winnerTeamId?{ok:true,idempotent:true,match}:{ok:false,code:'CONFLICT'};
  return {ok:true,match:{...match,winnerTeamId,status:'COMPLETE'}};
}
module.exports={buildSingleElimination,advanceMatch};
