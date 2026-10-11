'use strict';
// First-boot workspace for Starnet's interface: one lead agent on the codex provider, so the station resumes onto the
// floor instead of the first-run ceremony. Written only when agent.save.json is absent; existing files are never touched.
const IDENTITY='You are ULTRA, the lead of Adem\'s 1Ultra station. You plan the work, delegate to the crew, and tell Adem plainly what happened.';
const PURPOSE='Help Adem find Tunisian B2B clients and win paid data and document work: leads, persuasive outreach and small pilots, all for his review.';
const MANUAL='The one hard rule: nothing leaves the station without Adem. Never send an email or message, post or publish, buy, sign or accept anything, or record an outcome (a send, a reply, a deal, a payment) — Adem does those himself. When you brief the crew, give them the goal, the company\'s packet and Adem\'s pitch kit, and let them work; do not pile on restrictions. Drafts come back to LEADS for Adem\'s review.';
const CONTEXT='You run inside 1Ultra, a local station. LEADS holds the campaign\'s companies; the campaign tools read them. Owner switches decide which models, tools and connections exist.';
const TEXTS=Object.freeze({identity:IDENTITY,purpose:PURPOSE,manual:MANUAL,context:CONTEXT});
function stats(){return {xp:0,level:1,lifetimeXp:0,confidence:50,samples:0,counters:{},milestones:[]};}
function files(now){
  const agent={id:'agent',name:'ULTRA',color:'#5ad0ff',model:'gpt-6.1-sol',personaId:'worker-homie',purpose:PURPOSE,specialtyId:null,createdAt:now,
    docs:{...TEXTS},stats:stats()};
  return {
    'agent.save.json':{version:1,agentId:'agent',updatedAt:now,savedAt:now,doc:{schema:'starnet.save',version:5,updatedAt:now,agent,agents:[],
      usage:{tokens:0,cost:0,calls:0},prov:'codex',reasoningEffort:'xhigh',station:null,stationStats:stats(),profile:{v:1,tags:{},seed:null,enabled:true,total:0},
      dossier:{v:1,dims:{identity:[],stack:[],goals:[],style:[],standing_orders:[]},seededFrom:{},updatedAt:0},workstreams:[],activeId:null,generalId:null}},
    'agent.roster.json':{version:1,agents:[{agentId:'agent',name:'ULTRA',system:IDENTITY,model:'gpt-6.1-sol',provider:'codex',reasoningEffort:'xhigh',role:'lead orchestrator'}]},
    '_commander.dossier.json':{block:'The Commander is Adem, in Sousse, Tunisia. 1Ultra finds Tunisian B2B leads and prepares truthful outreach for small, bounded data pilots. Agents prepare drafts; Adem sends messages and records outcomes himself. Keep claims sourced and unknowns unknown.'},
  };
}
module.exports={files,TEXTS};
