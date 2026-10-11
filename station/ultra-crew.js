'use strict';
// 1Ultra crew on FreeLLMAPI: the one facade ultra-host.js and the Starnet patches call.
const {makeWire}=require('./ultra-crew-wire.js');
function makeCrew({fs,path,runtime,switches,port,durable,isHalted=()=>false,fetchFn=(...a)=>globalThis.fetch(...a),now=()=>Date.now()}){
  const wire=makeWire({fs,path,runtime,port});
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
  return {registerProviderConfig:fn=>wire.register(fn),isFreeTier:id=>wire.isFreeTier(id),status};
}
module.exports={makeCrew};
