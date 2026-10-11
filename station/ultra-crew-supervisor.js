'use strict';
// One team.dispatch subtask through the capability ladder (full-merge spec, "Reassignment ladder"): classify each crew
// result, then retry once on auto:smart, reassign to a covering member whose tier is ready, or hand the subtask back to
// the lead. At most three moves; every move goes back to the lead and into the lead's run receipt; nothing is dropped.
const Health=require('./ultra-crew-health.js');
const MOVES_RUNS=300,MOVES_PER_RUN=10;
function makeSupervisor({profileFor,memberIds,readiness,receiptsFor,tiers,switches,isHalted,store,parseVerdict,now=()=>Date.now()}){
  const moves=new Map();
  function remember(parentRunId,move){
    if(!parentRunId)return;
    let list=moves.get(parentRunId);
    if(!list){list=[];moves.set(parentRunId,list);if(moves.size>MOVES_RUNS)moves.delete(moves.keys().next().value);}
    if(list.length<MOVES_PER_RUN)list.push(Object.assign({},move));
  }
  function classifyRow(agentId,row){
    return Health.classify({row,receipts:row&&row.runId?receiptsFor(row.runId):[],profile:profileFor(agentId),tiers:tiers(),parseVerdict});
  }
  async function memberReady(agentId){
    const profile=profileFor(agentId);
    if(!profile)return {ready:false,reason:'not a crew member'};
    const r=await readiness(profile);
    const member=store.load().members[agentId];
    if(member&&member.benched){
      if(!r.ready)return {ready:false,reason:'benched: no capable model ('+r.reason+')'};
      store.save(Health.unbench(store.load(),agentId));
    }
    return r;
  }
  async function candidates(crewMap){
    const state=store.load(),out=[];
    for(const agentId of memberIds()){
      const profile=profileFor(agentId);
      if(!profile||!(crewMap&&crewMap.has(agentId)))continue;
      const r=await readiness(profile);
      out.push({agentId,profile,ready:r.ready,benched:!!(state.members[agentId]&&state.members[agentId].benched)});
    }
    return out;
  }
  const describe=list=>list.map(m=>m.from+' '+m.outcome+(m.detail?' ('+m.detail+')':'')+' → '+m.step+(m.to!==m.from?' '+m.to:'')).join('; ');
  // team.dispatch asks this before delivering a completed row: a held row is redone by supervise(), never shown as done.
  function accept(job,row){
    if(!job||!profileFor(job.agentId))return true;
    const outcome=classifyRow(job.agentId,row);
    row.crewOutcome=outcome;
    return outcome.kind==='ok';
  }
  async function supervise(job,o2,h){
    const needs=job&&!job.error?profileFor(job.agentId):null;
    if(!needs)return h.runWorkerOnce(job,o2);
    const trail=[],tried=new Set([job.agentId]);
    let current=job,retried=false,opts=o2,usd=0,lastText='';
    const failed=why=>({agentId:job.agentId,reason:'error',usd,crewMoves:trail,
      result:'FAILED — '+why+(trail.length?' Moves: '+describe(trail)+'.':'')+' Tell the Commander this subtask did not complete; nothing was dropped silently.'});
    for(;;){
      if(isHalted())return failed('the emergency stop is on, so this crew subtask stopped.');
      const ready=await memberReady(current.agentId);
      let row=null,outcome;
      if(!ready.ready)outcome={kind:'unavailable',detail:ready.reason,routedVia:''};
      else{
        row=await h.runWorkerOnce(current,opts);
        usd+=Number(row&&row.usd)||0;
        outcome=row&&row.crewOutcome?row.crewOutcome:classifyRow(current.agentId,row);
        if(row&&row.result&&outcome.kind!=='unavailable')lastText=String(row.result);
        store.save(Health.recordOutcome(store.load(),current.agentId,outcome.kind,now()));
      }
      if(outcome.kind==='ok'){
        delete row.crewOutcome;delete row.crewHeld;row.usd=usd;
        if(trail.length){row.crewMoves=trail;row.note=((row.note?row.note+' ':'')+'1Ultra crew moves: '+describe(trail)).slice(0,600);}
        return row;
      }
      if(trail.length>=Health.MAX_MOVES)return failed('every free crew option failed within '+Health.MAX_MOVES+' moves.');
      const escalate=switches.isOn('crew.escalate_to_lead')&&switches.isOn('lead.codex')&&h.leadProvider==='codex';
      const step=Health.nextStep({outcome,needs,retried,tried,candidates:await candidates(h.crew),escalate});
      const to=step.action==='reassign'?step.agentId:step.action==='lead'?String(h.leadId||'lead'):current.agentId;
      const move={step:step.action,from:current.agentId,to,outcome:outcome.kind,detail:String(outcome.detail||'').slice(0,200)};
      trail.push(move);remember(h.parentRunId,move);
      opts=Object.assign({},o2,{runId:undefined});
      if(step.action==='retry'){current=Object.assign({},current,{ident:Object.assign({},current.ident,{model:step.model})});retried=true;continue;}
      if(step.action==='reassign'){current=Object.assign({},job,{agentId:step.agentId,ident:h.crew.get(step.agentId)});tried.add(step.agentId);continue;}
      if(step.action==='lead'){
        const state=store.load();state.escalations=(Number(state.escalations)||0)+1;store.save(state);
        return {agentId:job.agentId,reason:'escalated',usd,crewMoves:trail,
          result:'ESCALATED TO YOU — no free crew option produced a checked result. Moves: '+describe(trail)+'. Do this subtask yourself now on your own model, then continue your plan.\n\nSubtask:\n'+String(job.prompt||'')
            +(lastText?'\n\nUnchecked crew draft (a starting point only, never checked work):\n'+lastText.slice(0,2000):'')};
      }
      return failed('every free crew option failed.');
    }
  }
  return {accept,supervise,movesFor:id=>(moves.get(id)||[]).map(m=>Object.assign({},m))};
}
module.exports={makeSupervisor};
