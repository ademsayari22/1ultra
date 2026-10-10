'use strict';
const workflows=require('./frontend/campaign/ultra-workflows.js');
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const EFFORTS=['low','medium','high','xhigh'];
const SKILLS={research:['ultra-prospect'],sales:['ultra-sales'],delivery:['ultra-deliver'],qa:[]};
function agentSettings(desk,value={}){
  if(!SKILLS[desk]||!object(value))throw Error('Choose a known specialist configuration.');
  if(Object.keys(value).some(k=>!['enabled','reasoning_effort','skills','instructions','updatedAt'].includes(k)))throw Error('Unsupported agent settings.');
  const s={enabled:true,reasoning_effort:'xhigh',skills:[...SKILLS[desk]],instructions:'',...value};
  if(typeof s.enabled!=='boolean'||!EFFORTS.includes(s.reasoning_effort))throw Error('Choose an enabled state and supported reasoning effort.');
  if(typeof s.instructions!=='string'||s.instructions.length>4000)throw Error('Agent instructions must be at most 4000 characters.');
  if(!Array.isArray(s.skills)||s.skills.some(k=>!SKILLS[desk].includes(k))||new Set(s.skills).size!==s.skills.length)throw Error('Choose this specialist’s project skills.');
  if('updatedAt' in s&&(typeof s.updatedAt!=='string'||s.updatedAt.length>100))throw Error('Invalid agent settings timestamp.');
  return s;
}
function validate(patch){
  if(!object(patch))throw Error('Station patch must be an object.');
  const keys=['world','workstreams','companySessions','crew','memory','tasks','workflows','focus','settings'];
  if(Object.keys(patch).some(k=>!keys.includes(k)))throw Error('Unsupported station fields.');
  for(const k of ['world','workstreams','companySessions','crew','focus','settings'])if(k in patch&&patch[k]!==null&&!object(patch[k]))throw Error(k+' must be an object.');
  for(const k of ['memory','tasks','workflows'])if(k in patch&&(!Array.isArray(patch[k])||patch[k].length>500))throw Error(k+' must be a bounded list.');
  if(patch.workflows){if(patch.workflows.length>20)throw Error('Save at most twenty workflows.');for(const f of patch.workflows)workflows.compile(f);if(new Set(patch.workflows.map(f=>f.id)).size!==patch.workflows.length)throw Error('Workflow IDs must be distinct.');}
  if(patch.crew&&Object.keys(patch.crew).some(k=>!workflows.DESKS.includes(k)))throw Error('Choose a known campaign desk.');
  if(patch.crew)for(const [desk,settings] of Object.entries(patch.crew))agentSettings(desk,settings);
  if(patch.memory)for(const n of patch.memory){if(!object(n)||typeof n.id!=='string'||typeof n.content!=='string'||!['observation','hypothesis','owner-confirmed'].includes(n.status)||!n.content.trim()||typeof n.source!=='string'||!n.source.trim())throw Error('Notes require ID, text, evidence label and source.');}
  if(patch.settings){const s=patch.settings;if(!['dark','light'].includes(s.theme)||!Number.isInteger(s.text)||s.text<14||s.text>21||typeof s.reducedMotion!=='boolean')throw Error('Choose a supported theme, text size and movement setting.');}
  if(patch.companySessions&&Object.values(patch.companySessions).some(v=>typeof v!=='string'))throw Error('Company sessions must reference session IDs.');
  return patch;
}
module.exports={validate,agentSettings};
