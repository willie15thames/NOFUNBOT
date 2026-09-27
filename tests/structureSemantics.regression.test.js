'use strict';
const assert=require('assert'); const fs=require('fs'); const os=require('os'); const path=require('path');
process.env.BOT_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'nofun-structure-'));
const settingsSvc=require('../src/services/serverSettingsService');
const wizard=require('../src/services/wizardStateService');
const validation=require('../src/services/validationGateService');
const hierarchy=require('../src/services/hierarchyEnforcementService');
const templateLogic=require('../src/services/serverTemplateLogicService');
const registry=require('../src/services/templateRegistryService');
const mix=require('../src/services/templateMixService');
let p=0,f=0; function t(n,fn){try{fn();console.log('✅',n);p++;}catch(e){console.error('❌',n,e.stack||e);f++;}}

t('Base validates with no template/subtemplate',()=>{ const s={...settingsSvc.DEFAULTS,customStructureMode:'base',serverTemplate:'',serverSubtemplate:'',serverInitialized:true}; assert.equal(validation.validateTemplateDependencies(s).ok,true); assert.equal(hierarchy.checkTemplateBeforeCommunity(s),null); assert.equal(templateLogic.getTemplateProfile(s).key,'base'); });
t('Template requires a template',()=>{ const s={...settingsSvc.DEFAULTS,customStructureMode:'template',serverTemplate:''}; assert.equal(validation.validateTemplateDependencies(s).ok,false); assert(validation.validateTemplateDependencies(s).failures.includes('no-server-template')); });
t('Custom requires selected templates',()=>{ const s={...settingsSvc.DEFAULTS,customStructureMode:'custom',customTemplateSelections:[]}; assert.equal(validation.validateTemplateDependencies(s).ok,false); assert.equal(hierarchy.checkTemplateBeforeCommunity(s).includes('at least one template'),true); });
t('Empty mode is sanitized away',()=>{ settingsSvc.saveSettings({...settingsSvc.DEFAULTS,customStructureMode:'empty'}); assert.notEqual(settingsSvc.getSettings().customStructureMode,'empty'); });
t('General/simple template and lightweight subtemplates exist',()=>{ const g=registry.getTemplate('general'); assert.equal(g.key,'general'); for(const k of ['chat','gaming','sports','study','watchparty']) assert(g.subtemplates[k],`missing ${k}`); });
t('Custom mix dedupes categories/channels',()=>{ const specs=mix.buildTemplateMixSpecs(['general','general'],['general:chat','general:chat']); const names=[]; for(const c of specs) for(const ch of c.channels||[]) names.push(`${c.name}:${ch.name||ch}`.toLowerCase()); assert.equal(names.length,new Set(names).size); });
t('Base wizard mode does not require template to advance',()=>{ const s={...settingsSvc.DEFAULTS,customStructureMode:'base',serverTemplate:'',serverSubtemplate:''}; const r=wizard.getStageValidation ? wizard.getStageValidation('mode',s) : null; if(r) assert.equal(r.canAdvance,true); else assert.equal(validation.validateTemplateDependencies(s).ok,true); });
console.log(`\nStructure semantics regression: ${p} passed, ${f} failed`); if(f) process.exitCode=1;
