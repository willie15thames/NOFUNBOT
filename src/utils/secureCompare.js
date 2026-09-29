'use strict';
const crypto=require('crypto');
function timingSafeStringEqual(a,b){
 const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));
 return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);
}
function timingSafeHexEqual(a,b){
 try{const aa=Buffer.from(String(a||''),'hex'),bb=Buffer.from(String(b||''),'hex');return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);}catch{return false;}
}
module.exports={timingSafeStringEqual,timingSafeHexEqual};
