'use strict';
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.UltraExperience=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  function navigation(tabs,initial,saved){
    const clean=route=>{
      if(!route||!tabs.includes(route.tab))throw Error('Unknown station section.');
      const result={tab:route.tab,scroll:Math.max(0,Number(route.scroll)||0)};
      for(const key of ['selected','room','session','offer'])if(typeof route[key]==='string'&&route[key].length<200)result[key]=route[key];
      return result;
    };
    let entries=[clean(initial)],index=0;
    function restore(value){
      if(value?.kind!=='1ultra-navigation'||!Array.isArray(value.entries)||!value.entries.length||value.entries.length>80||!Number.isInteger(value.index)||value.index<0||value.index>=value.entries.length)return false;
      try{const next=value.entries.map(clean);entries=next;index=value.index;return true;}catch{return false;}
    }
    restore(saved);
    return {
      current:()=>({...entries[index]}),canBack:()=>index>0,
      replace:route=>(entries[index]=clean(route)),
      visit(route){const next=clean(route),current=entries[index];
        if(['tab','selected','room','session','offer'].every(key=>next[key]===current[key]))return false;
        entries=entries.slice(0,index+1);entries.push(next);if(entries.length>80)entries.shift();index=entries.length-1;return true;
      },
      back:()=>index>0?{...entries[--index]}:null,restore,
      snapshot:()=>({kind:'1ultra-navigation',entries:entries.map(route=>({...route})),index})
    };
  }
  function jobProgress(job,now=Date.now()){
    const running=['starting','running'].includes(job.status),complete=['prepared','needs_review'].includes(job.status);
    const elapsed=Math.max(0,Math.floor(((running?now:Date.parse(job.finished||job.started))-Date.parse(job.started))/1000)||0);
    const labels={starting:'Starting',running:'Running',prepared:'Prepared',needs_review:'Review required',failed:'Failed',cancelled:'Cancelled',interrupted:'Interrupted',timed_out:'Timed out'};
    const details={starting:'Requesting a bounded local script.',running:'Script in progress · waiting for its saved result.',prepared:'Saved result ready to inspect. No business quest completed.',needs_review:'Script finished · resolve its checks before continuing; owner review is still required.',failed:'Preparation failed. Inspect the error before retrying.',cancelled:'Stopped before completion.',interrupted:'The station stopped before a complete result. Retry explicitly.',timed_out:'The script reached its time limit. Inspect the receipt.'};
    const detail=job.engine==='agent'&&job.status==='running'?'Agent in progress · waiting for its saved answer.':job.engine==='agent'&&job.status==='needs_review'?'Agent answer saved · review the claims before using it.':details[job.status];
    return {label:labels[job.status]||'Unknown',detail:detail||'Inspect the runtime receipt.',running,value:running?null:complete?100:0,
      elapsed:elapsed>=60?`${Math.floor(elapsed/60)}m ${elapsed%60}s`:`${elapsed}s`,tone:job.status==='prepared'?'good':job.status==='needs_review'?'warn':running?'active':'error'};
  }
  function workflowProgress(plan,progress={},current=true){
    const scripts=new Set(current?progress.completed||[]:[]),owners=new Set(current?progress.checkpoints||[]:[]);
    const done=plan.nodes.filter(node=>(node.kind==='owner'?owners:scripts).has(node.id)).length,total=plan.nodes.length;
    return {done,total,percent:total?Math.round(done/total*100):0};
  }
  return {navigation,jobProgress,workflowProgress};
});
