'use strict';
const counters=new Map(),gauges=new Map(),histograms=new Map();
function key(name,labels={}){return `${name}|${Object.keys(labels).sort().map(k=>`${k}=${labels[k]}`).join(',')}`;}
function inc(name,labels={},n=1){const k=key(name,labels);counters.set(k,(counters.get(k)||0)+n);}
function gauge(name,labels={},v=0){gauges.set(key(name,labels),Number(v));}
function observe(name,labels={},v=0){const k=key(name,labels),h=histograms.get(k)||{count:0,sum:0,max:0};h.count++;h.sum+=Number(v);h.max=Math.max(h.max,Number(v));histograms.set(k,h);}
function snapshot(){return{counters:Object.fromEntries(counters),gauges:Object.fromEntries(gauges),histograms:Object.fromEntries([...histograms].map(([k,v])=>[k,{...v,avg:v.count?v.sum/v.count:0}]))};}
function reset(){counters.clear();gauges.clear();histograms.clear();}
module.exports={inc,gauge,observe,snapshot,reset};
