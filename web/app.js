import {loadWorkspace,request,esc,shortTime} from './api.js';
import {icon,hydrateIcons} from './icons.js';
import {EcosystemGraph} from './graph.js';
import * as views from './views.js';
const $=selector=>document.querySelector(selector);
const state={data:null,route:'ecosystem',selected:'ultra_ops',graph:null,taskFilter:'all',taskPhase:null,query:'',leadFilter:'all',busy:false,editing:null};
let toastTimeout;
function toast(message,error=false){const el=$('#toast');el.textContent=message;el.classList.toggle('error',error);el.classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.classList.remove('visible'),5000);}
function activity(message){$('#activity-time').textContent=`[${shortTime(new Date())}]`;$('#activity-line > span').textContent=message;}
function nav(){
 const navigation=$('#navigation');
 if(!navigation.children.length)navigation.innerHTML=Object.entries(views.titles).map(([id,label])=>`<a href="#${id}" class="nav-item">${icon(id)}<span>${label}</span></a>`).join('');
 navigation.querySelectorAll('a').forEach(link=>{const active=link.hash===`#${state.route}`;link.classList.toggle('selected',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
}
function select(id,open=true){const focused=document.activeElement?.closest('[data-select]')?.dataset.select;state.selected=id;if(state.graph)state.graph.select(id);$('#agent-list').innerHTML=views.roleRail(state.data,id);if(focused)$('#agent-list').querySelector(`[data-select="${focused}"]`)?.focus();$('#inspector-content').innerHTML=views.inspector(state.data,id);if(open&&window.innerWidth<1100)document.body.classList.add('inspector-open');}
function taskData(){return state.taskPhase===null?state.data:{...state.data,tasks:state.data.tasks.filter(t=>t.phase===state.taskPhase)};}
function render(){
  nav();document.title=`1Ultra · ${views.titles[state.route]}`;$('#page-title').textContent=views.titles[state.route];$('#view-title').textContent=views.viewTitles[state.route];$('#view-tools').innerHTML=views.tools(state.route);state.graph=null;
  const view=$('#view');view.classList.toggle('graph-view',state.route==='ecosystem');
  if(state.route==='ecosystem')state.graph=new EcosystemGraph(view,state.data,select,state.selected);
  else if(state.route==='tasks')view.innerHTML=views.tasksView(taskData(),state.taskFilter,state.query);
  else if(state.route==='leads')view.innerHTML=views.leadsView(state.data,state.leadFilter);
  else if(state.route==='phases')view.innerHTML=views.phasesView(state.data);
  else if(state.route==='finance')view.innerHTML=views.financeView(state.data);
  else view.innerHTML=views.runsView(state.data);
  if(state.route==='tasks'){ $('#task-filter').value=state.taskFilter;$('#task-search').value=state.query; if(state.taskPhase!==null){$('#view-title').textContent=`Phase ${state.taskPhase} · tasks`;$('#view-tools').insertAdjacentHTML('beforeend','<button class="quiet" data-action="clear-phase">All phases</button>');}}
  if(state.route==='leads')$('#lead-filter').value=state.leadFilter;
  select(state.selected,false);
}
async function refresh(renderPage=true){state.data=await loadWorkspace();if(renderPage)render();}
function navigate(){const route=location.hash.slice(1);state.route=Object.hasOwn(views.titles,route)?route:'ecosystem';document.body.classList.remove('inspector-open');if(state.data)render();}
async function perform(route,body,label){
  if(state.busy)return;state.busy=true;document.body.classList.add('busy');
  try{const value=await request(route,body);await refresh();select(value.run.id);activity(`${label}: ${value.run.id}. No model or client action invoked.`);toast(label);if(value.run.files.length)await openArtifact(value.run.files.find(p=>p.endsWith('/brief.md'))||value.run.files.find(p=>p.endsWith('/role_prompts.md'))||value.run.files.find(p=>p.endsWith('/prompt.md')));}
  catch(error){toast(error.message,true);activity(error.message);}
  finally{state.busy=false;document.body.classList.remove('busy');}
}
async function openArtifact(path){
  try{const value=await request(`/api/artifact?path=${encodeURIComponent(path)}`);$('#artifact-title').textContent=path.split('/').pop();$('#artifact-meta').textContent=path;$('#artifact-content').textContent=value.content;$('#artifact-dialog').showModal();}
  catch(error){toast(error.message,true);}
}
function editTask(id){const task=state.data.tasks.find(t=>t.id===id);state.editing=id;$('#task-edit-title').textContent=`Update ${id}`;$('#task-status').value=task.status;$('#task-evidence').value=task.completion_evidence||'';$('#task-confirm').checked=false;$('#task-error').textContent='';$('#task-dialog').showModal();}
async function saveTask(e){e.preventDefault();if(state.busy)return;const status=$('#task-status').value,evidence=$('#task-evidence').value,confirmed=$('#task-confirm').checked;if(status==='done'&&(!evidence.trim()||!confirmed)){$('#task-error').textContent='Add actual evidence and confirm completion before marking done.';return;}state.busy=true;try{await request(`/api/tasks/${encodeURIComponent(state.editing)}`,{status,completion_evidence:evidence,owner_confirmed:confirmed},{'If-Match':state.data.task_version});$('#task-dialog').close();await refresh();activity(`Task ${state.editing} updated from owner input.`);toast('Task saved.');}catch(error){let message=error.message;if(message.includes('Tasks changed')){try{await refresh();$('#task-confirm').checked=false;message+=' Latest records loaded; review your unsaved evidence before saving again.';}catch{}}$('#task-error').textContent=message;}finally{state.busy=false;}}
document.addEventListener('click',async e=>{
  const target=e.target.closest('[data-select],[data-task],[data-lead],[data-payment],[data-run],[data-draft],[data-artifact],[data-edit],[data-action],[data-phase]');if(!target||!state.data)return;
  const d=target.dataset;
  if(d.select)select(d.select);
  if(d.task)select(d.task);
  if(d.lead)select(d.lead);
  if(d.payment)select(d.payment);
  if(d.run)select(d.run);
  if(d.edit)editTask(d.edit);
  if(d.artifact)await openArtifact(d.artifact);
  if(d.draft){const body={role:d.draft};if(d.draft==='ultra_customer')body.scenario='messy-pilot';await perform('/api/draft',body,'Agent draft prepared');}
  if(d.action==='refresh'){try{await refresh();toast('Workspace refreshed.');}catch(error){toast(error.message,true);}}
  if(d.action==='close-inspector')document.body.classList.remove('inspector-open');
  if(d.phase){state.taskPhase=Number(d.phase);state.taskFilter='all';state.query='';location.hash='tasks';navigate();}
  if(d.action==='clear-phase'){state.taskPhase=null;render();}
  if(d.action==='rehearse')await perform('/api/simulate',{scenario:'messy-pilot'},'Fictional rehearsal fixture prepared');
});
document.addEventListener('keydown',e=>{const row=e.target.closest('tr[data-task],tr[data-lead],tr[data-payment]');if(row&&['Enter',' '].includes(e.key)){e.preventDefault();row.click();}});
document.addEventListener('change',e=>{
  if(e.target.id==='graph-filter')state.graph.applyFilter(e.target.value,$('#map-search').value);
  if(e.target.id==='task-filter'){state.taskFilter=e.target.value;$('#view').innerHTML=views.tasksView(taskData(),state.taskFilter,state.query);}
  if(e.target.id==='lead-filter'){state.leadFilter=e.target.value;$('#view').innerHTML=views.leadsView(state.data,state.leadFilter);}
});
document.addEventListener('input',e=>{if(e.target.id==='map-search')state.graph.applyFilter($('#graph-filter').value,e.target.value);if(e.target.id==='task-search'){state.query=e.target.value;$('#view').innerHTML=views.tasksView(taskData(),state.taskFilter,state.query);}});
window.addEventListener('hashchange',navigate);
$('#prepare-day').addEventListener('click',()=>perform('/api/prepare',{},'Daily brief prepared'));
$('#task-form').addEventListener('submit',saveTask);
for(const id of ['close-task','cancel-task'])$(`#${id}`).addEventListener('click',()=>$('#task-dialog').close());
$('#close-artifact').addEventListener('click',()=>$('#artifact-dialog').close());
hydrateIcons();activity('Workspace ready. No client actions recorded.');navigate();
try{await refresh();}catch(error){$('#view').innerHTML=views.empty('Workspace unavailable',error.message);toast(error.message,true);}
