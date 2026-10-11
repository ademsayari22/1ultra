'use strict';
// 1Ultra crew on FreeLLMAPI: the one facade ultra-host.js and the Starnet patches call.
const policy=require('./ultra-policy.js');
const {makeWire}=require('./ultra-crew-wire.js');
const {makeReceipts}=require('./ultra-crew-receipts.js');
const {makeRoster}=require('./ultra-crew-roster.js');
function makeCrew({fs,path,runtime,switches,port,durable,isHalted=()=>false,fetchFn=(...a)=>globalThis.fetch(...a),now=()=>Date.now()}){
  const wire=makeWire({fs,path,runtime,port});
  const receipts=makeReceipts({now});
  const roster=makeRoster({fs,path,runtime,durable,now});
  const crewProvider=id=>policy.providerSwitch(id)==='crew.freellmapi';
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
    const w=wire.refresh(),out={switch:switches.isOn('crew.freellmapi'),wire:wire.status(),reachable:false,keyAccepted:false,readyModels:0};
    if(!w||!out.switch)return out;
    try{
      const res=await fetchFn(w.baseUrl+'/models?execution_status=ready',{headers:{Authorization:'Bearer '+w.key},signal:AbortSignal.timeout(5000)});
      out.reachable=true;out.keyAccepted=res.status!==401;
      if(res.ok){const body=await res.json();out.readyModels=(Array.isArray(body&&body.data)?body.data:[]).filter(m=>m&&m.execution_status==='ready').length;}
    }catch(_){/* FreeLLMAPI is not reachable */}
    return out;
  }
  return {registerProviderConfig:fn=>wire.register(fn),isFreeTier:id=>wire.isFreeTier(id),adapterOptions,receiptsFor:id=>receipts.get(id),
    seedRoster:()=>roster.seed(),profileFor:id=>roster.profileFor(id),status};
}
module.exports={makeCrew};
