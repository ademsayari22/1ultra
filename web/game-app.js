import {loadWorkspace,request,esc,priceMinor} from './api.js';
import {icon,hydrateIcons} from './icons.js';
import {DungeonMap} from './dungeon.js';
import * as views from './game-views.js';
import * as old from './views.js';
import {RecordEditor,historyView} from './record-editor.js';
import {HuntController,huntView,leadBoard,leadCards,filteredLeads,filterDefaults} from './hunt.js';
import {guide,guideHTML,preparedEvidence} from './quest-guides.js';

const $=s=>document.querySelector(s);
const state={data:null,route:'hunt',selected:'',room:0,walkRoom:0,map:null,mapMemory:null,filter:'all',query:'',phase:null,leadFilters:{...filterDefaults},tool:'daily-pack',busy:false,scriptExecutions:{},editing:null,gate:null,artifact:null};
let toastTimer;
function toast(message,error=false){$('#toast').textContent=message;$('#toast').classList.toggle('error',error);$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),6000);}
function activity(message){$('#activity-line').textContent=message;}
function navigate(){const aliases={ecosystem:'dungeon',tasks:'quests',finance:'treasury',runs:'chronicle'};const hash=location.hash.slice(1);state.route=aliases[hash]||Object.hasOwn(views.titles,hash)&&hash||'hunt';if(state.data)render();}
function go(route){if(location.hash===`#${route}`){state.route=route;render();}else location.hash=route;}
function select(id){state.selected=id;state.map?.select(id);document.querySelectorAll('[data-card-id]').forEach(card=>card.classList.toggle('selected',card.dataset.cardId===id));$('#inspector-content').innerHTML=views.inspector(state.data,id);hydrateIcons($('#inspector-content'));}
function roomSelect(id){state.room=id;if(state.data.progression.rooms[id].unlocked)state.walkRoom=id;state.map?.inspect(id);select(`room:${id}`);}
function openTool(id){state.tool=id;state.selected='tool:'+id;go('workshop');}
function render(){
 const nav=$('#navigation');if(!nav.children.length)nav.innerHTML=views.navNames.map(id=>`<a class="nav-item" href="#${id}">${icon(id)}<span>${views.titles[id]}</span></a>`).join('');
 nav.querySelectorAll('a').forEach(a=>{const active=a.hash==='#'+state.route;a.classList.toggle('selected',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
 document.title='1Ultra · '+views.titles[state.route];$('#view-title').textContent=views.headings[state.route];$('#view-tools').innerHTML=views.tools(state.route);
 $('#hero-level').textContent='LV '+state.data.progression.level;$('#hero-xp').textContent=`${state.data.progression.level_xp} / 100 XP`;$('#hero-progress').value=state.data.progression.level_xp;$('#hero-progress').title=state.data.progression.xp+' total evidenced XP';
 if(state.map)state.mapMemory={zoom:state.map.zoom,position:{...state.map.position},walkRoom:state.map.walkRoom};
 state.map=null;const view=$('#view');view.classList.toggle('dungeon-view',state.route==='dungeon');view.classList.toggle('hunt-view',state.route==='hunt');
 if(state.route==='hunt')view.innerHTML=huntView(state.data);
 else if(state.route==='dungeon')state.map=new DungeonMap(view,state.data,roomSelect,select,state.selected,state.room,state.walkRoom,state.mapMemory);
 else if(state.route==='quests'){
  view.innerHTML=views.questView(state.data,state.filter,state.query,state.phase);$('#task-filter').value=state.filter;$('#task-search').value=state.query;
  if(state.phase!==null){$('#view-title').textContent=`Room ${state.phase+1} · quests`;$('#view-tools').insertAdjacentHTML('beforeend','<button class="quiet" data-action="all-rooms">All rooms</button>');}
 }
 else if(state.route==='workshop'){const run=state.data.runs.find(r=>r.automation===state.tool&&r.engine==='script'&&r.mode!=='simulation');view.innerHTML=views.workshopView(state.data,state.tool,state.scriptExecutions[state.tool]||(run?{status:run.status||'prepared',run,historical:true}:null),state.busy);}
 else if(state.route==='chronicle')view.innerHTML=views.chronicleView(state.data);
 else if(state.route==='leads')view.innerHTML=leadBoard(state.data,state.leadFilters,state.selected);
 else view.innerHTML=views.recordsView(state.route,state.data);
 select(state.selected);hydrateIcons();
}
async function refresh(){const scroll=$('#view').scrollTop;state.data=await loadWorkspace();if(!state.selected)state.selected=state.data.daily_plan.next[0]?.id||'room:0';render();$('#view').scrollTop=scroll;}
function questAction(id){const task=state.data.tasks.find(t=>t.id===id);if(!task)return;const g=guide(task);if(g.planning)recordEditor.open('budget');else if(g.provider)hunt.openProvider(g.provider);else if(g.tool)openTool(g.tool);else if(g.route){state.leadFilters.stage=g.stage||'all';go(g.route);select(id);}else select(id);}
function filterBoard(){if(state.route!=='leads')return;$('#lead-cards').innerHTML=leadCards(state.data,state.leadFilters,state.selected);$('#lead-results').textContent=filteredLeads(state.data,state.leadFilters).length+' companies';document.querySelectorAll('[data-lead-stage]').forEach(b=>{const active=b.dataset.leadStage===state.leadFilters.stage;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',active);});}
function briefHTML(text){
 return text.split('\n').map(line=>line.startsWith('# ')?`<h2>${esc(line.slice(2))}</h2>`:line.startsWith('## ')?`<h3>${esc(line.slice(3))}</h3>`:line?`<p>${esc(line)}</p>`:'').join('');
}
async function openArtifact(path){try{
 const value=await request('/api/artifact?path='+encodeURIComponent(path));state.artifact=value;
 $('#artifact-title').textContent=path.split('/').pop();$('#artifact-meta').textContent=path;$('#artifact-content').textContent=value.content;
 const run=state.data.runs.find(r=>r.files.includes(path));const daily=run?.automation==='daily-pack'&&/\/(brief|report)\.md$/.test(path);
 $('#artifact-brief').hidden=!daily;$('#artifact-content').hidden=daily;$('#artifact-details').hidden=!daily;
 $('#artifact-details').open=false;$('#artifact-full-result').textContent='';
 if(daily)$('#artifact-brief').innerHTML=briefHTML(value.content);
 $('#artifact-dialog').showModal();
 }catch(error){toast(error.message,true);}}
async function perform(endpoint,body,label,errorSelector){
 if(state.busy)return;state.busy=true;document.body.classList.add('busy');
 const tool=endpoint==='/api/automate'?body.automation:null;
 if(tool){state.scriptExecutions[tool]={status:'running',started:Date.now()};showScriptExecution(tool);activity('Running '+(state.data.automations.find(t=>t.id===tool)?.name||tool)+' locally…');}
 try{const value=await request(endpoint,body);if(!value.run)throw Error('The script returned no saved run receipt.');
  if(tool)state.scriptExecutions[tool]={...state.scriptExecutions[tool],status:value.run.status||'prepared',run:value.run,finished:Date.now()};
  await refresh();select(value.run.id);activity(`${label} · ${value.run.id} · artifacts saved; no quest or receipt changed.`);toast(value.run.status==='needs_review'?'Script finished; its checks need review.':label);
  if(!tool){const files=value.run.files;const report=files.find(p=>p.endsWith('/prompt.md'))||files.find(p=>p.endsWith('/brief.md'))||files.find(p=>p.endsWith('/report.md'))||files.find(p=>p.endsWith('/role_prompts.md'));if(report)await openArtifact(report);}}
 catch(error){if(tool&&state.scriptExecutions[tool]?.status==='running')state.scriptExecutions[tool]={...state.scriptExecutions[tool],status:'failed',error:error.message,finished:Date.now()};if(errorSelector&&$(errorSelector))$(errorSelector).textContent=error.message;toast(error.message,true);activity(error.message);}
 finally{state.busy=false;document.body.classList.remove('busy');if(tool)showScriptExecution(tool);}
}
function showScriptExecution(tool){if(state.route!=='workshop')return;const current=state.scriptExecutions[state.tool],panel=$('#workshop-result');if(panel)panel.innerHTML=views.scriptExecutionView(current);const button=$('#tool-form [data-run-script]');if(button){button.disabled=state.busy;button.innerHTML=icon('operations')+(current?.status==='running'?'Running…':'Run script');}}
function toolParameters(id){
 if(id==='csv-workbench')return {csv_text:$('#csv-input').value,key_column:$('#csv-key').value.trim(),amount_column:$('#csv-amount').value.trim(),delimiter:$('#csv-delimiter').value==='tab'?'\t':$('#csv-delimiter').value};
 if(id==='scope-check'){const currency=$('#scope-currency').value;return {scope:{input_permission:$('#scope-permission').checked,sample_reference:$('#scope-sample').value,output_format:$('#scope-output').value,payment_terms:$('#scope-terms').value,start_condition:$('#scope-start').value,fields:$('#scope-fields').value.split(',').map(s=>s.trim()).filter(Boolean),quantity:$('#scope-quantity').value?Number($('#scope-quantity').value):null,price_minor:priceMinor($('#scope-price').value,currency),currency,exceptions:$('#scope-exceptions').value,deadline:$('#scope-deadline').value,acceptance:$('#scope-acceptance').value}};}
 if(id==='rehearsal')return {scenario:$('#scenario-input').value};
 if(['lead-audit','outreach-drafts'].includes(id)&&$('#audit-date').value)return {date:$('#audit-date').value};
 return {};
}
function editTask(id){state.editing=id;const task=state.data.tasks.find(t=>t.id===id);const prepared=preparedEvidence(task,state.data);$('#task-edit-title').textContent=guide(task).title;$('#task-guide').innerHTML=guideHTML(task);$('#task-status').value=task.status;$('#task-evidence').value=task.completion_evidence||(prepared?.ready?prepared.text:'');$('#task-next-date').value=task.next_action_on||'';$('#task-minutes').value=task.timebox_minutes??'';$('#task-history').innerHTML=historyView(task,'task');$('#task-confirm').checked=false;$('#task-error').textContent=prepared&&!prepared.ready?prepared.text:'';$('#task-dialog').showModal();}
async function saveTask(event){
 event.preventDefault();if(state.busy)return;const status=$('#task-status').value,evidence=$('#task-evidence').value,confirmed=$('#task-confirm').checked;
 if(status==='done'&&(!evidence.trim()||!confirmed)){$('#task-error').textContent='Add actual evidence and confirm completion before marking done.';return;}
 state.busy=true;const previousXP=state.data.progression.xp;
 try{await request('/api/tasks/'+encodeURIComponent(state.editing),{status,completion_evidence:evidence,owner_confirmed:confirmed,next_action_on:$('#task-next-date').value||null,timebox_minutes:$('#task-minutes').value?Number($('#task-minutes').value):null},{'If-Match':state.data.task_version});$('#task-dialog').close();await refresh();const change=state.data.progression.xp-previousXP;activity(`Quest ${state.editing} updated from your evidence. ${change>0?'+'+change+' XP.':change<0?`${change} effective XP after dependency review.`:'No extra XP awarded.'}`);toast(change>0?`Quest saved · +${change} XP`:'Quest saved. Progress recalculated.');}
 catch(error){let message=error.message;if(message.includes('Tasks changed')){try{await refresh();$('#task-confirm').checked=false;message+=' Latest records loaded; review your unsaved evidence and confirm again.';}catch{}}$('#task-error').textContent=message;}
 finally{state.busy=false;}
}
function editGate(phase){state.gate=phase;const room=state.data.progression.rooms[phase];const references=room.tasks.map(id=>{const t=state.data.tasks.find(t=>t.id===id);return t?.completion_evidence?`${id}: ${t.completion_evidence}`:'';}).filter(Boolean).join('\n').slice(0,4000);$('#gate-title').textContent=room.name+' · boss review';$('#gate-fields').innerHTML=room.requirements.map(r=>`<label for="gate-${r.id}">${esc(r.label)}</label><textarea id="gate-${r.id}" data-gate-field="${esc(r.id)}" rows="2" maxlength="4000" placeholder="Reference to the real evidence">${esc(r.evidence||references)}</textarea>`).join('');$('#gate-confirm').checked=false;$('#gate-error').textContent='';$('#gate-dialog').showModal();}
async function saveGate(event){event.preventDefault();if(state.busy)return;const evidence=Object.fromEntries([...document.querySelectorAll('[data-gate-field]')].map(el=>[el.dataset.gateField,el.value]));if(!$('#gate-confirm').checked||Object.values(evidence).some(s=>!s.trim())){$('#gate-error').textContent='Provide each real reference and confirm the review.';return;}state.busy=true;try{await request('/api/gates/'+state.gate,{evidence,owner_confirmed:true},{'If-Match':state.data.game_version,'X-Task-Version':state.data.task_version});$('#gate-dialog').close();await refresh();toast('Boss gate reviewed. Real ledger records remain separate.');activity('Owner-confirmed room evidence recorded.');}catch(error){let message=error.message;if(message.includes('changed')){try{await refresh();$('#gate-confirm').checked=false;message+=' Latest records loaded; review the retained references.';}catch{}}$('#gate-error').textContent=message;}finally{state.busy=false;}}

document.addEventListener('click',async event=>{
 const target=event.target.closest('[data-task],[data-lead],[data-payment],[data-run],[data-tool],[data-edit],[data-artifact],[data-action],[data-phase],[data-room-tasks],[data-review-gate],[data-open-tool],[data-quick-script],[data-lead-stage]');if(!target||!state.data)return;const d=target.dataset;
 if(d.leadStage){state.leadFilters.stage=d.leadStage;filterBoard();}
 if(d.task)select(d.task);if(d.lead){select(d.lead);if(innerWidth<=1100)$('#inspector').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}if(d.payment)select(d.payment);if(d.run)select(d.run);if(d.tool)openTool(d.tool);if(d.edit)editTask(d.edit);if(d.artifact)await openArtifact(d.artifact);if(d.openTool)openTool(d.openTool);
 if(d.roomTasks!==undefined){state.phase=Number(d.roomTasks);state.filter='all';state.query='';go('quests');}
 if(d.phase!==undefined){state.phase=Number(d.phase);state.filter='all';state.query='';go('quests');}
 if(d.reviewGate!==undefined)editGate(Number(d.reviewGate));
 if(d.quickScript)await perform('/api/automate',{automation:d.quickScript,params:{}},'Payment scribe completed');
 if(d.action==='floor-guide')go('phases');
 if(d.action==='all-rooms'){state.phase=null;render();}
 if(d.action==='back-to-leads'){go('leads');$('#workspace').scrollIntoView({block:'start'});}
 if(d.action==='open-treasury')go('treasury');
 if(d.action==='refresh'){try{await refresh();toast('Current records loaded.');}catch(error){toast(error.message,true);}}
 if(d.action==='sample-csv'){$('#csv-input').value='id,amount,name\n A ,12.500, Alice \nA,13.000,Bob\nB,"1,50",Carol\n';$('#input-note').textContent='Synthetic example: duplicate conflict and ambiguous decimal. This is not client evidence.';}
});
document.addEventListener('change',async event=>{
 if(event.target.id==='task-filter'){state.filter=event.target.value;$('#view').innerHTML=views.questView(state.data,state.filter,state.query,state.phase);}
 if(['lead-city','lead-industry'].includes(event.target.id)){state.leadFilters[event.target.id.slice(5)]=event.target.value;filterBoard();}
 if(event.target.id==='csv-file'){const file=event.target.files[0];if(!file)return;if(file.size>60000){$('#tool-error').textContent='Choose a CSV up to 60 KB.';return;}$('#csv-input').value=await file.text();$('#input-note').textContent=`Loaded ${file.name}. Processing stays on this local computer.`;}
});
document.addEventListener('input',event=>{if(event.target.id==='task-search'){state.query=event.target.value;$('#view').innerHTML=views.questView(state.data,state.filter,state.query,state.phase);}if(event.target.id==='lead-query'){state.leadFilters.query=event.target.value;filterBoard();}});
document.addEventListener('keydown',event=>{const row=event.target.closest('tr[data-task],tr[data-lead],tr[data-payment]');if(row&&['Enter',' '].includes(event.key)){event.preventDefault();row.click();}});
document.addEventListener('submit',async event=>{
 if(event.target.id==='tool-form'){event.preventDefault();$('#tool-error').textContent='';try{const id=event.target.dataset.currentTool;await perform('/api/automate',{automation:id,params:toolParameters(id)},'Local script completed','#tool-error');}catch(error){$('#tool-error').textContent=error.message;}}
 if(event.target.id==='judgment-form'){event.preventDefault();const reason=$('#judgment-reason').value.trim();if(reason.length<10){$('#judgment-error').textContent='Explain the specific remaining judgment in at least 10 characters.';return;}$('#judgment-error').textContent='';const scriptRun=$('#judgment-run').value;await perform('/api/judgment',{role:$('#judgment-role').value,reason,...(scriptRun?{script_run:scriptRun}:{})},'Judgment prompt prepared','#judgment-error');}
});
$('#prepare-day').addEventListener('click',()=>perform('/api/automate',{automation:'daily-pack',params:{}},'Daily script pack completed'));
const recordEditor=new RecordEditor({data:()=>state.data,refresh,select,toast,activity});
const hunt=new HuntController({data:()=>state.data,refresh,select,toast,go,filters:state.leadFilters,onQuestAction:id=>{if($('#task-dialog').open)$('#task-dialog').close();questAction(id);}});
$('#task-history').addEventListener('click',event=>{
 const button=event.target.closest('[data-use-task-revision]');if(!button)return;
 const task=state.data.tasks.find(t=>t.id===state.editing);const previous=task.history?.[Number(button.dataset.useTaskRevision)]?.before;
 if(!previous)return;
 $('#task-status').value=previous.status;$('#task-evidence').value=previous.completion_evidence||'';
 $('#task-next-date').value=previous.next_action_on||'';$('#task-minutes').value=previous.timebox_minutes??'';
 $('#task-confirm').checked=false;$('#task-error').textContent='Previous values loaded. Review and confirm before saving a new revision.';
});
$('#artifact-details').addEventListener('toggle',async()=>{
 if(!$('#artifact-details').open||!state.artifact||$('#artifact-full-result').textContent)return;
 const sourcePath=state.artifact.path;const resultPath=sourcePath.replace(/[^/]+$/,'result.json');
 try{const result=await request('/api/artifact?path='+encodeURIComponent(resultPath));if(state.artifact?.path===sourcePath)$('#artifact-full-result').textContent=result.content;}
 catch(error){if(state.artifact?.path===sourcePath)$('#artifact-full-result').textContent=error.message;}
});
$('#task-form').addEventListener('submit',saveTask);$('#gate-form').addEventListener('submit',saveGate);
for(const id of ['close-task','cancel-task'])$('#'+id).addEventListener('click',()=>$('#task-dialog').close());
for(const id of ['close-gate','cancel-gate'])$('#'+id).addEventListener('click',()=>$('#gate-dialog').close());
$('#close-artifact').addEventListener('click',()=>$('#artifact-dialog').close());
$('#download-artifact').addEventListener('click',()=>{if(!state.artifact)return;const link=document.createElement('a');const url=URL.createObjectURL(new Blob([state.artifact.content],{type:state.artifact.path.endsWith('.csv')?'text/csv;charset=utf-8':'text/plain;charset=utf-8'}));link.href=url;link.download=state.artifact.path.split('/').pop();link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
window.addEventListener('hashchange',navigate);hydrateIcons();navigate();
try{await refresh();}catch(error){$('#view').innerHTML=`<section class="content-panel frame">${old.empty('Workspace needs attention',error.message)}</section>`;toast(error.message,true);}
