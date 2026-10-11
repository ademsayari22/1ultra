'use strict';
// Crew capability rules (full-merge spec, "Crew capability management"): pure functions with no I/O, so every run
// classifies and reassigns the same way. ultra-crew.js supplies receipts, readiness, tiers and persistence.
const TIERS=Object.freeze(['fast','standard','smart']);
const ROUTING=Object.freeze({smart:'auto:smart',standard:'auto:balanced',fast:'auto:fast'});
const SIZE_TIER=Object.freeze({Frontier:'smart',Large:'smart',Medium:'standard',Small:'fast'});
const TASK_TYPES=Object.freeze(['code','chat']);
const DEFAULT_PROFILES=Object.freeze({
  research:Object.freeze({minTier:'smart',tools:true,vision:false,taskType:'chat',languages:Object.freeze(['en','fr']),requiresVerdict:false}),
  delivery:Object.freeze({minTier:'standard',tools:true,vision:false,taskType:'code',languages:Object.freeze(['en','fr']),requiresVerdict:false}),
  sales:Object.freeze({minTier:'smart',tools:false,vision:false,taskType:'chat',languages:Object.freeze(['fr','en']),requiresVerdict:false}),
  qa:Object.freeze({minTier:'smart',tools:true,vision:false,taskType:'chat',languages:Object.freeze(['en','fr']),requiresVerdict:true}),
});
const MAX_MOVES=3,BENCH_STREAK=3,BENCH_WINDOW_MS=30*60*1000,RECENT_MAX=10;
const UNAVAILABLE_STATUS=new Set([408,422,429]);
function rank(tier){const i=TIERS.indexOf(tier);return i<0?0:i;}
function normalizeProfile(p){
  if(!p||typeof p!=='object')throw new Error('A crew profile must be an object.');
  if(!TIERS.includes(p.minTier))throw new Error('minTier must be one of '+TIERS.join(', ')+'.');
  if(!TASK_TYPES.includes(p.taskType))throw new Error('taskType must be code or chat.');
  const languages=Array.isArray(p.languages)?[...new Set(p.languages.map(l=>String(l).toLowerCase()).filter(l=>/^[a-z]{2}$/.test(l)))]:[];
  return {minTier:p.minTier,tools:p.tools===true,vision:p.vision===true,taskType:p.taskType,languages,requiresVerdict:p.requiresVerdict===true};
}
function tierFromSize(sizeLabel){return SIZE_TIER[sizeLabel]||'fast';}
function tierOf(routedVia,tiers){const row=tiers&&tiers.models&&tiers.models[String(routedVia||'')];return row&&TIERS.includes(row.tier)?row.tier:'fast';}
// A ready model counts for a member only at or above its tier, with tools or vision when the member needs them.
function tierReady(profile,readyIds,tiers){
  const ready=readyIds instanceof Set?readyIds:new Set(readyIds||[]);
  return Object.values((tiers&&tiers.models)||{}).some(m=>m&&ready.has(m.canonicalId)&&rank(m.tier)>=rank(profile.minTier)
    &&(!profile.tools||m.tools===true)&&(!profile.vision||m.vision===true));
}
function covers(candidate,needs){
  return rank(candidate.minTier)>=rank(needs.minTier)&&(!needs.tools||candidate.tools)&&(!needs.vision||candidate.vision)
    &&needs.languages.every(l=>candidate.languages.includes(l));
}
function lastRouting(receipts){
  let served=null,failed=null;
  for(const r of Array.isArray(receipts)?receipts:[]){if(!r)continue;if(r.status>=200&&r.status<300){served=r;failed=null;}else failed=r;}
  return {served,failed};
}
// unavailable | downgraded | failed_check | ok, with a one-line reason for the receipt and the lead.
function classify({row,receipts,profile,tiers,parseVerdict}){
  if(!row)return {kind:'unavailable',detail:'the worker did not run',routedVia:''};
  const reason=String(row.reason||'done'),{served,failed}=lastRouting(receipts);
  const routedVia=served&&served.routedVia?served.routedVia:'';
  if(reason==='timeout'||reason==='error'||reason==='refused')return {kind:'unavailable',detail:reason+': '+String(row.result||'').slice(0,160),routedVia};
  if(reason==='invalid-result')return {kind:'failed_check',detail:'the result failed its schema after one repair',routedVia};
  if(reason!=='done')return {kind:'failed_check',detail:'the worker ended with '+reason,routedVia};
  if(failed&&(UNAVAILABLE_STATUS.has(failed.status)||failed.status===0||failed.status>=500))
    return {kind:'unavailable',detail:'FreeLLMAPI answered '+(failed.status||failed.error||'nothing'),routedVia};
  if(routedVia!=='cache'&&routedVia!=='idempotency'){
    const tier=routedVia?tierOf(routedVia,tiers):'fast';
    if(rank(tier)<rank(profile.minTier))return {kind:'downgraded',detail:routedVia?routedVia+' is '+tier+', below '+profile.minTier:'no routing evidence (no X-Routed-Via), counted as fast, below '+profile.minTier,routedVia};
  }
  if(profile.requiresVerdict&&!(typeof parseVerdict==='function'&&parseVerdict(String(row.result||''))))return {kind:'failed_check',detail:'no VERDICT line',routedVia};
  return {kind:'ok',detail:'',routedVia};
}
// The reassignment ladder: retry once on auto:smart, then another covering member whose tier is ready, then the lead.
function nextStep({outcome,needs,retried,tried,candidates,escalate}){
  if((outcome.kind==='downgraded'||outcome.kind==='failed_check')&&!retried)return {action:'retry',model:ROUTING.smart};
  for(const c of candidates||[])if(!tried.has(c.agentId)&&c.ready&&!c.benched&&covers(c.profile,needs))return {action:'reassign',agentId:c.agentId};
  return escalate?{action:'lead'}:{action:'fail'};
}
function emptyState(){return {version:1,members:{},escalations:0};}
function copyState(state){return JSON.parse(JSON.stringify(state&&state.version===1&&state.members?state:emptyState()));}
// Three non-ok results in a row within 30 minutes bench a member; any ok result unbenches it.
function recordOutcome(state,agentId,kind,now){
  const next=copyState(state);
  const m=next.members[agentId]||(next.members[agentId]={recent:[],benched:false,benchedAt:0});
  m.recent.push({at:now,kind});m.recent=m.recent.slice(-RECENT_MAX);
  if(kind==='ok'){m.benched=false;m.benchedAt=0;return next;}
  const last=m.recent.slice(-BENCH_STREAK);
  if(!m.benched&&last.length===BENCH_STREAK&&last.every(r=>r.kind!=='ok')&&now-last[0].at<=BENCH_WINDOW_MS){m.benched=true;m.benchedAt=now;}
  return next;
}
function unbench(state,agentId){const next=copyState(state);if(next.members[agentId]){next.members[agentId].benched=false;next.members[agentId].benchedAt=0;}return next;}
module.exports={TIERS,ROUTING,SIZE_TIER,DEFAULT_PROFILES,MAX_MOVES,BENCH_STREAK,BENCH_WINDOW_MS,rank,normalizeProfile,tierFromSize,tierOf,
  tierReady,covers,classify,nextStep,emptyState,recordOutcome,unbench};
