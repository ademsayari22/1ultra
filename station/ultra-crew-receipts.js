'use strict';
// Which model actually answered each crew request: FreeLLMAPI's routing headers, kept per run in memory (bounded)
// until the run record takes them. Never the request body, the response body or the Authorization header.
const MAX_RUNS=300,MAX_PER_RUN=20;
function makeReceipts({now=()=>Date.now()}={}){
  const runs=new Map();
  function add(runId,row){
    if(!runId)return;
    let list=runs.get(runId);
    if(!list){list=[];runs.set(runId,list);if(runs.size>MAX_RUNS)runs.delete(runs.keys().next().value);}
    if(list.length<MAX_PER_RUN)list.push(row);
  }
  const header=(res,name)=>{try{return String((res&&res.headers&&res.headers.get(name))||'');}catch(_){return '';}};
  function observe(fetchFn,runId){
    return async function(input,init){
      const url=String(input&&typeof input==='object'&&'url' in input?input.url:input);
      const chat=/\/chat\/completions(?:\?|$)/.test(url);
      let res;
      try{res=await fetchFn.call(this,input,init);}
      catch(e){
        if(chat)add(runId,{at:now(),status:0,routedVia:'',fallbackAttempts:0,fallbackTrail:'',error:String((e&&(e.code||e.name))||'network').slice(0,60)});
        throw e;
      }
      if(chat)add(runId,{at:now(),status:Number(res&&res.status)||0,routedVia:header(res,'x-routed-via').slice(0,256),
        fallbackAttempts:Number(header(res,'x-fallback-attempts'))||0,fallbackTrail:header(res,'x-fallback-trail').slice(0,1024)});
      return res;
    };
  }
  return {observe,get:runId=>(runs.get(runId)||[]).map(r=>Object.assign({},r))};
}
module.exports={makeReceipts};
