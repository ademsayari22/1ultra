'use strict';
// 1Ultra crew on FreeLLMAPI: the one facade ultra-host.js and the Starnet patches call. The wire (unified key), routing
// receipts, crew roster and capability ladder live in their own modules; this file binds them to the live switches,
// the emergency stop and the runtime files.
const policy=require('./ultra-policy.js');
const Health=require('./ultra-crew-health.js');
const {makeWire}=require('./ultra-crew-wire.js');
const {makeReceipts}=require('./ultra-crew-receipts.js');
const {makeRoster}=require('./ultra-crew-roster.js');
const {makeSupervisor}=require('./ultra-crew-supervisor.js');
const {parseVerdict}=require('./sidecar/routing/verdict.js');
const READY_TTL_MS=30000;
const LEAD_BRIEF='[CREW HEALTH] Your crew runs on free FreeLLMAPI models whose quality changes during the day. Call team.health before you plan crew assignments. When a crew result is downgraded, fails its checks, or its member is benched, the station retries it, reassigns it or hands the subtask back to you; team.dispatch rows list these moves in crewMoves. Tell the Commander about every move and every failed subtask.';
function makeCrew({fs,path,runtime,switches,port,durable,isHalted=()=>false,fetchFn=(...a)=>globalThis.fetch(...a),now=()=>Date.now()}){
  const wire=makeWire({fs,path,runtime,port});
  const receipts=makeReceipts({now});
  const roster=makeRoster({fs,path,runtime,durable,now});
  const healthFile=path.join(runtime,'ultra-crew-health.json'),tiersFile=path.join(runtime,'model-tiers.json');
  const store={
    load(){try{const s=JSON.parse(fs.readFileSync(healthFile,'utf8'));return s&&s.version===1&&s.members?s:Health.emptyState();}catch(_){return Health.emptyState();}},
    save(state){durable(healthFile,state);},
  };
  function readTiers(){try{const t=JSON.parse(fs.readFileSync(tiersFile,'utf8'));return t&&t.models&&typeof t.models==='object'?t:{models:{}};}catch(_){return {models:{}};}}
  const crewProvider=id=>policy.providerSwitch(id)==='crew.freellmapi';
  let readyCache={at:0,key:'',value:null};
  // GET /v1/models?execution_status=ready → {status, ids}. 401 means FreeLLMAPI rejected the unified key.
  async function readyModels(w,fresh){
    if(!fresh&&readyCache.value&&readyCache.key===w.key&&now()-readyCache.at<READY_TTL_MS)return readyCache.value;
    const res=await fetchFn(w.baseUrl+'/models?execution_status=ready',{headers:{Authorization:'Bearer '+w.key},signal:AbortSignal.timeout(5000)});
    let value;
    if(res.status===401)value={status:401,ids:new Set()};
    else if(!res.ok)throw new Error('FreeLLMAPI answered HTTP '+res.status);
    else{const body=await res.json();value={status:200,ids:new Set((Array.isArray(body&&body.data)?body.data:[]).filter(m=>m&&m.execution_status==='ready').map(m=>String(m.id)))};}
    readyCache={at:now(),key:w.key,value};
    return value;
  }
  async function readiness(profile){
    if(!switches.isOn('crew.freellmapi'))return {ready:false,reason:'crew.freellmapi is off'};
    const w=wire.refresh();
    if(!w)return {ready:false,reason:'FreeLLMAPI key not loaded ('+wire.status().problem+'): run python3 scripts/freellmapi.py key'};
    let r;
    try{r=await readyModels(w,false);}catch(e){return {ready:false,reason:'FreeLLMAPI unreachable: '+String((e&&e.message)||e).slice(0,120)};}
    if(r.status===401)return {ready:false,reason:'FreeLLMAPI rejected the key: run python3 scripts/freellmapi.py key'};
    const tiers=readTiers();
    if(!Object.keys(tiers.models).length)return {ready:false,reason:'model tiers not seeded: run python3 scripts/freellmapi.py tiers'};
    return Health.tierReady(profile,r.ids,tiers)?{ready:true,reason:''}
      :{ready:false,reason:'no ready '+profile.minTier+' model'+(profile.tools?' with tools':'')+(profile.vision?' with vision':'')};
  }
  const supervisor=makeSupervisor({profileFor:id=>roster.profileFor(id),memberIds:()=>roster.memberIds(),readiness,
    receiptsFor:id=>receipts.get(id),tiers:readTiers,switches,isHalted,store,parseVerdict,now});
  // selectProvider's options for one adapter: crew requests record FreeLLMAPI's routing headers for their run and tell
  // FreeLLMAPI the member's task type.
  function adapterOptions(o){
    if(!o||!crewProvider(o.provider))return o;
    const out=Object.assign({},o);
    if(o.ultraRunId&&typeof o.fetch==='function')out.fetch=receipts.observe(o.fetch,o.ultraRunId);
    const profile=o.ultraAgentId?roster.profileFor(o.ultraAgentId):null;
    if(profile&&!Object.keys(o.headers||{}).some(key=>key.toLowerCase()==='x-freellm-task-type'))
      out.headers=Object.assign({'X-FreeLLM-Task-Type':profile.taskType},o.headers||{});
    return out;
  }
  async function status(){
    const w=wire.refresh(),state=store.load();
    const out={switch:switches.isOn('crew.freellmapi'),wire:wire.status(),reachable:false,keyAccepted:false,readyModels:0,
      escalateToLead:switches.isOn('crew.escalate_to_lead'),leadCodex:switches.isOn('lead.codex'),
      tiersSeeded:Object.keys(readTiers().models).length,escalations:Number(state.escalations)||0,members:[]};
    if(w&&out.switch){
      try{const r=await readyModels(w,true);out.reachable=true;out.keyAccepted=r.status!==401;out.readyModels=r.ids.size;}
      catch(_){/* FreeLLMAPI is not reachable */}
    }
    for(const agentId of roster.memberIds()){
      const profile=roster.profileFor(agentId);
      if(!profile)continue;
      const r=await readiness(profile),m=state.members[agentId]||{recent:[],benched:false};
      out.members.push({agentId,profile,ready:r.ready,reason:r.reason,benched:!!m.benched,recent:(m.recent||[]).slice(-5).map(x=>x.kind)});
    }
    return out;
  }
  const healthTool={
    name:'team.health',capability:'orchestrator',scope:'read',requiresConsent:false,
    description:'Read your crew\'s health before assigning work: each crew member\'s capability profile (minimum tier, tools, languages), whether a FreeLLMAPI model at that tier is ready now and why not, recent results, bench state, and whether a failed crew subtask comes back to you (crew.escalate_to_lead). Read-only.',
    schema:{type:'object',properties:{}},
    run:async()=>{const s=await status();return {content:JSON.stringify(s),summary:s.members.filter(m=>m.ready).length+' of '+s.members.length+' crew ready'};},
  };
  return {
    registerProviderConfig:fn=>wire.register(fn),isFreeTier:id=>wire.isFreeTier(id),adapterOptions,receiptsFor:id=>receipts.get(id),
    seedRoster:()=>roster.seed(),profileFor:id=>roster.profileFor(id),status,
    accept:(job,row)=>supervisor.accept(job,row),supervise:(job,o2,h)=>supervisor.supervise(job,o2,h),movesFor:id=>supervisor.movesFor(id),
    registerTools:registry=>registry.register(healthTool),leadBrief:()=>LEAD_BRIEF,
  };
}
module.exports={makeCrew};
