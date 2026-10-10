import {esc,request} from './api.js';

export class PitchAgentStudio {
 constructor(owner){
  this.owner=owner;this.timer=null;this.pending=false;this.job=null;this.report=null;this.failures=0;
  document.body.insertAdjacentHTML('beforeend',`<dialog id="pitch-agent-dialog" class="sourcing-dialog frame" aria-labelledby="pitch-agent-title"><header><div><span class="eyebrow">SALES AGENT · CODEX</span><h2 id="pitch-agent-title">Company-specific pitch</h2></div><button class="icon-button" id="close-pitch-agent" aria-label="Close agent">×</button></header><section id="pitch-agent-result" aria-live="polite"></section><footer><a class="quiet" href="${window.ULTRA_API_BASE?'/#crew':'http://127.0.0.1:8541/#crew'}">Agent settings & skills</a></footer></dialog>`);
  document.querySelector('#close-pitch-agent').onclick=()=>document.querySelector('#pitch-agent-dialog').close();
  document.querySelector('#pitch-agent-result').addEventListener('click',async event=>{
   const button=event.target.closest('[data-agent-use],[data-agent-stop],[data-agent-qa],[data-agent-download]');if(!button||button.disabled)return;
   button.disabled=true;
   try{
    if(button.hasAttribute('data-agent-download')){const url=URL.createObjectURL(new Blob([this.report.content],{type:'text/markdown;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=this.job.result.run.id+'-report.md';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    if(button.hasAttribute('data-agent-stop')){await request('/api/control',{action:'cancel',id:this.job.id});await this.poll();}
    if(button.hasAttribute('data-agent-qa'))await this.start({desk:'qa',kind:'review',lead_id:this.job.params.lead_id,review_run:this.job.result.run.id,reason:'Review this pitch against supplied company facts, founder evidence and proof. Identify unsupported claims and specific corrections; do not mark it approved or sent.'});
    if(button.hasAttribute('data-agent-use')){
     await request('/api/agents/adopt',{run_id:this.job.result.run.id},{'If-Match':this.owner.data().record_versions.leads});
     await this.owner.refresh();this.owner.select(this.job.params.lead_id);
     document.querySelector('#pitch-agent-dialog').close();this.owner.openPitch(this.job.params.lead_id);
     this.owner.toast('Agent pitch saved · review required');
    }
   }catch(error){this.owner.toast(error.message,true);}finally{if(button.isConnected)button.disabled=false;}
  });
  this.recover();
 }
 remember(id){try{if(id)sessionStorage.setItem('1ultra-classic-agent-job',id);else sessionStorage.removeItem('1ultra-classic-agent-job');}catch{}}
 async recover(){
  if(!window.ULTRA_API_BASE)return;
  let id;try{id=sessionStorage.getItem('1ultra-classic-agent-job');}catch{return;}if(!id)return;
  this.pending=true;this.job={id};this.deadline=Date.now()+220000;
  try{await this.poll();}finally{this.pending=false;}
 }
 async launch(id,offer){
  if(this.pending||this.job?.status==='running')return;
  const lead=this.owner.data().leads.find(l=>l.id===id);
  document.querySelector('#pitch-agent-title').textContent='Sales agent · '+lead.company;
  const dialog=document.querySelector('#pitch-agent-dialog');if(!dialog.open)dialog.showModal();
  await this.start({desk:'sales',kind:'pitch',lead_id:id,offer});
 }
 async start(body){
  if(this.pending)return;this.pending=true;this.report=null;this.failures=0;clearTimeout(this.timer);
  const panel=document.querySelector('#pitch-agent-result');panel.innerHTML='<p>Starting the specialist…</p><progress class="script-progress" max="100" aria-label="Starting agent"></progress>';
  try{
   if(!window.ULTRA_API_BASE)throw Error('Agent runs use the station host. Open the station crew from this dialog.');
   const receipt=await request('/api/agents/run',body);
   this.job={id:receipt.id,status:'running',params:body,started:new Date().toISOString(),events:[]};this.deadline=Date.now()+220000;
   this.remember(receipt.id);
   await this.poll();
  }catch(error){this.job=null;panel.innerHTML=`<p class="form-error" role="alert">${esc(error.message)}</p><progress class="script-progress" max="100" value="0" aria-label="Agent did not start"></progress>`;}
  finally{this.pending=false;}
 }
 async poll(){
  clearTimeout(this.timer);
  try{
   const runtime=await request('/api/runtime'),job=runtime.jobs.find(j=>j.id===this.job?.id);
   if(!job)throw Error('Agent receipt unavailable. Open the station crew to inspect it.');
   this.job=job;
   const company=this.owner.data().leads.find(l=>l.id===job.params.lead_id)?.company||'Company report';
   document.querySelector('#pitch-agent-title').textContent=(job.desk==='sales'?'Sales agent':'QA agent')+' · '+company;
   const dialog=document.querySelector('#pitch-agent-dialog');
   if(!dialog.open&&(this.shownJob!==job.id||job.status!=='running'))dialog.showModal();this.shownJob=job.id;this.render();
   if(job.status==='running'&&Date.now()<this.deadline){this.failures=0;this.timer=setTimeout(()=>this.poll(),1000);}
   else if(job.status==='running')throw Error('Stopped waiting for this run. Inspect its saved status in the station crew.');
   else {
    await this.owner.refresh();
    const path=job.status==='needs_review'&&job.result?.run?.files?.find(f=>f.endsWith('/report.md'));
    if(path)this.report=await request('/api/artifact?path='+encodeURIComponent(path));
    this.render();this.remember(null);this.failures=0;
    this.owner.toast(path?'Report saved to interface · ready for review':'Agent '+job.status,job.status!=='needs_review');
   }
  }catch(error){
   const retry=++this.failures<=3&&Date.now()<this.deadline;
   document.querySelector('#pitch-agent-result').innerHTML=`<p class="form-error" role="alert">${esc(error.message)}</p><p>${retry?'Reconnecting to the saved run…':'Reload this page to reconnect to the saved receipt.'}</p>`;
   if(retry)this.timer=setTimeout(()=>this.poll(),2000);
  }
 }
 render(){
  const job=this.job,output=job.result?.output,running=job.status==='running',done=job.status==='needs_review';
  const run=job.result?.run,effort=run?.reasoning_effort||job.agent_settings?.reasoning_effort||'Not recorded',skills=run?.skills?.map(s=>s.id)||job.agent_settings?.skills;
  const used=output?.pitch&&this.owner.data().leads.some(l=>l.draft?.agent_run===job.result.run.id);
  const report=this.report?`<section class="saved-agent-report" data-saved-report="${esc(this.report.path)}"><h3>Report saved to interface</h3><p class="caption">${esc(this.report.path)}</p><pre class="agent-message">${esc(this.report.content)}</pre><button class="quiet" data-agent-download>Download report</button></section>`:output?'<p class="caption">Loading the saved report into the interface…</p>':'';
  document.querySelector('#pitch-agent-result').innerHTML=`<p><strong>${running?'Agent running':done?'Answer ready · review required':esc(job.status)}</strong> · ${esc(job.desk)} agent</p><progress class="script-progress" max="100" ${running?'':`value="${done?100:0}"`} aria-label="Agent execution"></progress><p class="caption">Reasoning: ${esc(effort)} · Skills: ${esc(skills?skills.join(', ')||'None selected':'Not recorded')}</p><div class="agent-activity">${(job.events||[]).slice(-6).map(e=>`<p class="caption">${esc(e.text||e.stage)}</p>`).join('')}</div>${job.error?`<p class="form-error" role="alert">${esc(job.error)}</p>`:''}${output?`<h3>${esc(output.summary)}</h3><p>${esc(output.answer)}</p>${output.pitch?`<strong>${esc(output.pitch.subject)}</strong><pre class="agent-message">${esc(output.pitch.body)}</pre>`:''}<details><summary>Sources and unknowns</summary>${output.evidence.map(e=>`<p>${esc(e.claim)}<br><small>${esc(e.source)}</small></p>`).join('')}<p>Unknowns: ${output.unknowns.map(esc).join(' · ')}</p><p>${output.owner_actions.map(esc).join(' · ')}</p></details>${output.pitch?`<div class="provider-actions"><button class="primary" data-agent-use ${used?'disabled':''}>${used?'Draft already saved':'Use this draft'}</button><button class="quiet" data-agent-qa>Ask QA to review</button></div>`:''}`:''}${report}${running?'<button class="quiet" data-agent-stop>Stop this agent</button>':''}<p class="caption">Selected company facts, offer, founder evidence and reviewed proof metadata go to Codex. One bounded pass · existing account usage · no message sent.</p>`;
 }
}
