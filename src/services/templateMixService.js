/*
 * NAVIGATION HEADER
 * FILE: src/services/templateMixService.js
 * PURPOSE: Translate commissioner-selected templates/subtemplates into deduplicated channel specs.
 * CONTRACT: This service does not mutate Discord; baseInitService remains the build owner.
 */
'use strict';
const { getTemplate, resolveTemplateProfile } = require('./templateRegistryService');
function _norm(v){return String(v||'').toLowerCase().replace(/^[^\w]+/,'').trim();}
function _dedupe(specs=[]){const by=new Map();for(const s of specs){const name=String(s.name||'').trim();if(!name)continue;const k=_norm(name);const cur=by.get(k)||{name,channels:[]};const seen=new Set(cur.channels.map(c=>String(c[0]||'').toLowerCase()));for(const c of(s.channels||[])){const n=String(c?.[0]||'').trim();if(!n||seen.has(n.toLowerCase()))continue;cur.channels.push([n,!!c?.[1]]);seen.add(n.toLowerCase());}by.set(k,cur);}return [...by.values()];}
function buildTemplateMixSpecs(templateSelections=[],subtemplateSelections=[]){const specs=[];for(const key of [...new Set(templateSelections.map(v=>String(v||'').trim().toLowerCase()).filter(Boolean))]){const t=getTemplate(key);if(!t)continue;for(const c of(t.categories||[]))specs.push({name:c.name,channels:c.channels||[]});}for(const sel of [...new Set(subtemplateSelections.map(v=>String(v||'').trim().toLowerCase()).filter(Boolean))]){const [tk,sk]=sel.split(':');if(!tk||!sk)continue;const t=getTemplate(tk);if(!t?.subtemplates?.[sk])continue;const p=resolveTemplateProfile({serverTemplate:tk,serverSubtemplate:sk});if(!p)continue;for(const c of(p.categories||[]))specs.push({name:c.name,channels:c.channels||[]});}return _dedupe(specs);}
function buildSelectionSummary(ts=[],ss=[]){return `${ts.length} template${ts.length===1?'':'s'}${ss.length?` + ${ss.length} subtemplate${ss.length===1?'':'s'}`:''}`;}
module.exports={buildTemplateMixSpecs,buildSelectionSummary};
