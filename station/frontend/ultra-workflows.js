'use strict';
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.UltraWorkflows=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 const TOOLS=['daily-pack','next-quests','validate-records','finance-pack','lead-audit','outreach-drafts','scope-check','csv-workbench','rehearsal'];
 const DESKS=['research','sales','delivery','qa'];
 function compile(raw){
  if(!raw||!Array.isArray(raw.nodes)||!raw.nodes.length||raw.nodes.length>12)throw Error('A workflow needs 1–12 steps.');
  if(!Array.isArray(raw.edges)||raw.edges.length>30)throw Error('A workflow needs at most 30 connections.');
  const nodes=raw.nodes.map(n=>{if(!n||!/^[a-z][a-z0-9_-]{0,39}$/.test(n.id))throw Error('Each step needs a distinct short ID.');
   if(!['script','owner'].includes(n.kind))throw Error('Steps must be script or owner checkpoints.');
   if(n.kind==='script'&&(!TOOLS.includes(n.tool)||!DESKS.includes(n.desk)))throw Error('Choose a catalogued script and campaign desk.');
   const params=n.params||{};if(typeof params!=='object'||Array.isArray(params)||JSON.stringify(params).length>65000)throw Error('Step parameters must be a bounded JSON object.');
   return {id:n.id,kind:n.kind,label:String(n.label||n.tool||'Owner review').slice(0,120),...(n.kind==='script'?{tool:n.tool,desk:n.desk,params}:{} )};});
  const ids=new Set(nodes.map(n=>n.id));if(ids.size!==nodes.length)throw Error('Step IDs must be distinct.');
  const deps=Object.fromEntries(nodes.map(n=>[n.id,[]])),out=Object.fromEntries(nodes.map(n=>[n.id,[]]));
  for(const edge of raw.edges){if(!Array.isArray(edge)||edge.length!==2||!ids.has(edge[0])||!ids.has(edge[1]))throw Error('Connections need two existing steps.');
   if(deps[edge[1]].includes(edge[0]))throw Error('Duplicate connection.');deps[edge[1]].push(edge[0]);out[edge[0]].push(edge[1]);}
  const indegree=Object.fromEntries(Object.entries(deps).map(([k,v])=>[k,v.length])),queue=nodes.filter(n=>!indegree[n.id]).map(n=>n.id),order=[],depth={};
  while(queue.length){const id=queue.shift();order.push(id);depth[id]=Math.max(0,...deps[id].map(d=>depth[d]+1));if(depth[id]>6)throw Error('Workflow exceeds six dependency hops.');for(const next of out[id])if(--indegree[next]===0)queue.push(next);}
  if(order.length!==nodes.length)throw Error('Workflow contains a cycle.');
  if(raw.requirements&&(!['shortlist','pitches','conversation','pilot'].includes(raw.requirements.kind)||!Array.isArray(raw.requirements.lead_ids)||raw.requirements.lead_ids.length>100))throw Error('Unsupported campaign recipe condition.');
  return {...(raw.requirements?{requirements:raw.requirements}:{}),nodes,edges:raw.edges.map(e=>e.slice()),order,deps,limit:{maxSteps:12,maxHops:6,timeoutSeconds:180},authority:'local preparation; business outcomes owner-confirmed separately'};
 }
 function next(plan,completed=[],checkpoints=[]){const done=new Set([...completed,...checkpoints]);return plan.order.map(id=>plan.nodes.find(n=>n.id===id)).find(n=>!done.has(n.id)&&plan.deps[n.id].every(d=>done.has(d)))||null;}
 return {TOOLS,DESKS,compile,next};
});
