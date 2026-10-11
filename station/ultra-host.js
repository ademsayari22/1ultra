'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'); // capture only for fixed private Python executor
const readline=require('node:readline');
const policy=require('./ultra-policy.js');
if(typeof AbortSignal.any!=='function')throw new Error('1Ultra needs Node.js 20.3 or newer (AbortSignal.any), so the emergency stop can cancel model requests in flight.');
const workflows=require('./frontend/campaign/ultra-workflows.js');
const {writeFileDurable}=require('./sidecar/durable-write.js');
const memcore=require('./sidecar/memcore.js');
const {makeTaskBriefStore}=require('./sidecar/taskbrief-store.js');
const {readJsonResilient,writeJsonResilient}=require('./sidecar/durable-store.js');
const registry=require('./sidecar/providers/registry.js');
const connectorCatalog=require('./sidecar/mcp/catalog.js');
const stateSchema=require('./ultra-state.js');
const root=fs.realpathSync(process.env.ULTRA_ROOT||path.resolve(__dirname,'..'));
const runtime=path.resolve(policy.resolveRuntime(process.env,root,()=>fs.mkdtempSync(path.join(require('node:os').tmpdir(),'1ultra-runtime-'))));
if(!policy.runtimeAllowed(root,runtime))throw new Error('Use runs/station-runtime or a dedicated /tmp fixture runtime; business directories are refused.');
fs.mkdirSync(runtime,{recursive:true});
const realRuntime=fs.realpathSync(runtime);
if(realRuntime!==runtime)throw new Error('Runtime symlinks are refused.');
const stateFile=path.join(runtime,'ultra-state.json');
const controlFile=path.join(runtime,'ultra-control.json');
const switches=require('./ultra-switches.js').makeSwitches({fs,path,file:path.join(runtime,'ultra-switches.json'),
  providerIds:registry.listProviderProfiles().map(p=>p.id).filter(id=>!['codex','starnet'].includes(id))});
// First boot only: give Starnet's interface a lead so it resumes onto the station. Never overwrites existing files.
if(!fs.existsSync(path.join(runtime,'agent.save.json')))for(const [name,value] of Object.entries(require('./ultra-seed.js').files(Date.now())))
  if(!fs.existsSync(path.join(runtime,name)))durable(path.join(runtime,name),value);
// One-time default for a seeded lead the interface has never saved: ULTRA thinks at xhigh. Never overrides a choice Adem made.
try{const saveFile=path.join(runtime,'agent.save.json'),env=JSON.parse(fs.readFileSync(saveFile,'utf8')),doc=env&&env.doc;
  if(doc&&doc.prov==='codex'&&doc.agent&&doc.agent.model==='gpt-6.1-sol'&&!doc.reasoningEffort&&doc.updatedAt===doc.agent.createdAt){doc.reasoningEffort='xhigh';durable(saveFile,env);}}catch(e){console.warn('1Ultra: could not apply the xhigh default to the seeded lead: '+String((e&&e.message)||e));}
const briefs=makeTaskBriefStore({fs,path,workspaces:runtime});
const gate=policy.makeGate(()=>switches.value('concurrency')),jobs=new Map();let rpc=null,pending=new Map(),seq=0,
  halted=fs.existsSync(controlFile)?JSON.parse(fs.readFileSync(controlFile,'utf8')).halted===true:false;
function child(once=false){return spawn('python3',[path.join(__dirname,'..','scripts','campaign_rpc.py'),'--root',root,...(once?['--once']:[])],
  {cwd:root,stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH,LANG:'C.UTF-8',PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'}});}
function ensureRpc(){if(rpc)return;rpc=child();
  readline.createInterface({input:rpc.stdout}).on('line',line=>{try{const msg=JSON.parse(line),wait=pending.get(msg.id);if(wait){pending.delete(msg.id);clearTimeout(wait.timer);wait.resolve(msg);}}catch{}});
  rpc.stderr.on('data',()=>{});rpc.on('exit',()=>{rpc=null;for(const wait of pending.values()){clearTimeout(wait.timer);wait.reject(new Error('Campaign worker stopped. Reload before retry.'));}pending.clear();});
}
// Crew on FreeLLMAPI (Stage 1b): unified-key wire, routing receipts, crew roster, capability ladder, lead fallback.
const crewPort=require('./ultra-crew-wire.js').portFrom(process.env);
const crew=require('./ultra-crew.js').makeCrew({fs,path,runtime,switches,port:crewPort,durable,isHalted:()=>halted});
try{const seeded=crew.seedRoster();if(seeded.added.length)console.warn('1Ultra: crew added ('+seeded.added.join(', ')+'). Close and reopen any station tab before working with them.');}
catch(e){console.warn('1Ultra: could not add the crew: '+String((e&&e.message)||e));}
function call(request){ensureRpc();const id=++seq;return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Campaign request timed out. Refresh before retrying a save.'));},20000);
  pending.set(id,{resolve,reject,timer});rpc.stdin.write(JSON.stringify({...request,id})+'\n');
});}
function readState(){const saved=readJsonResilient({fs},stateFile);if(saved.status==='absent')return {version:1,world:null,workstreams:null,companySessions:{},crew:{},memory:[],tasks:[],workflows:[],workflowRuns:{},focus:null,settings:{theme:'dark',text:16,reducedMotion:false},history:[]};
  if(!['ok','recovered'].includes(saved.status))throw Error('Station state is '+saved.status+'. Preserve its files and inspect before retrying.');return saved.value;}
function version(){return crypto.createHash('sha256').update(fs.existsSync(stateFile)?fs.readFileSync(stateFile):'').digest('hex');}
function durable(file,value){writeFileDurable({fs,path,randomTmpId:()=>crypto.randomBytes(6).toString('hex')},file,JSON.stringify(value,null,2)+'\n');}
function writeState(state){writeJsonResilient({fs,path},stateFile,state);}
// Interrupted runtime receipts are never replayed. Retry is an explicit new job.
const receiptsFile=path.join(runtime,'ultra-jobs.json');
function saveJobs(){durable(receiptsFile,[...jobs.values()].map(({child,...row})=>row));}
if(fs.existsSync(receiptsFile))for(const row of JSON.parse(fs.readFileSync(receiptsFile,'utf8'))){if(row.status==='running')row.status='interrupted';jobs.set(row.id,row);}
function startJob(body,workflowContext=null){
  if(Object.keys(body).some(k=>!['desk','tool','params'].includes(k)))throw Error('Unsupported job fields.');
  if(halted)throw new Error('Emergency stop is active. Resume preparation explicitly.');
  const roles=['research','sales','delivery','qa'];if(!roles.includes(body.desk))throw new Error('Choose one of the four campaign desks.');
  const tools=['daily-pack','next-quests','validate-records','finance-pack','lead-audit','outreach-drafts','scope-check','csv-workbench','rehearsal'];
  if(!tools.includes(body.tool))throw new Error('Only catalogued script preparation is supported.');
  gate.enter(body.desk);const id='job-'+crypto.randomBytes(6).toString('hex');let proc;
  try{proc=child(true);}catch(e){gate.leave(body.desk);throw e;}
  const job={id,desk:body.desk,tool:body.tool,status:'running',started:new Date().toISOString(),engine:'script',modelInvoked:false,params:body.params||{},child:proc,
    ...(workflowContext||{}),
    events:[{type:'ultra.script.started',at:new Date().toISOString()}]};jobs.set(id,job);saveJobs();
  let output='';proc.stdout.on('data',buf=>{output+=buf.toString();if(output.length>1000000){job.error='Script result too large';proc.kill('SIGTERM');}});
  proc.stderr.on('data',()=>{});
  const timer=setTimeout(()=>{job.status='timed_out';proc.kill('SIGTERM');},180000);
  proc.on('exit',()=>{clearTimeout(timer);gate.leave(body.desk);if(job.status==='running')try{const response=JSON.parse(output.trim());job.result=response.value;job.status=response.status===200?(job.result?.run?.status==='needs_review'?'needs_review':'prepared'):'failed';}catch{job.status='failed';job.error='Script ended without a complete receipt.';}
    delete job.child;job.finished=new Date().toISOString();job.events.push({type:'ultra.script.finished',at:job.finished,status:job.status});
    if(job.workflowId&&['prepared','needs_review'].includes(job.status)){
      const state=readState(),definition=(state.workflows||[]).find(w=>w.id===job.workflowId);
      if(definition&&planHash(definition)===job.planHash){const progress=state.workflowRuns?.[job.workflowId];if(progress){if(job.status==='prepared')progress.completed=[...new Set([...progress.completed,job.nodeId])];progress.receipts.push({nodeId:job.nodeId,jobId:id,runId:job.result?.run?.id,status:job.status});writeState(state);}}
    }
    saveJobs();});
  proc.on('error',()=>{job.status='failed';job.error='Python worker could not start';gate.leave(body.desk);saveJobs();});
  proc.stdin.end(JSON.stringify({id,route:'/api/automate',method:'POST',body:{automation:body.tool,params:body.params||{}}})+'\n');
  return {id,status:job.status};
}
function terminateJob(job){
  if(!job.child)return;
  if(job.engine==='agent'){
    const pid=job.child.pid;try{process.kill(-pid,'SIGTERM');}catch{}
    const timer=setTimeout(()=>{try{process.kill(-pid,'SIGKILL');}catch{}},2000);timer.unref();
  }else job.child.kill('SIGTERM');
}
function startAgent(body){
  if(halted)throw Error('Emergency stop is active. Resume preparation explicitly.');
  if(Object.keys(body).some(k=>!['desk','kind','lead_id','offer','reason','script_run','review_run'].includes(k))||!['research','sales','delivery','qa'].includes(body.desk))throw Error('Choose a known specialist and bounded inputs.');
  const kind=body.kind||'review';if(!['pitch','review'].includes(kind)||kind==='pitch'&&body.desk!=='sales')throw Error('Pitch generation belongs to Sales.');
  if(kind==='review'&&(typeof body.reason!=='string'||body.reason.trim().length<10))throw Error('Explain the remaining judgment question.');
  const settings=stateSchema.agentSettings(body.desk,readState().crew?.[body.desk]);
  if(!settings.enabled)throw Error('This agent is disabled in Crew settings.');
  gate.enter(body.desk);const id='job-'+crypto.randomBytes(6).toString('hex');let proc;
  try{proc=spawn('python3',[path.join(__dirname,'..','scripts/campaign_rpc.py'),'--root',root,'--once'],{cwd:root,detached:true,stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH,LANG:'C.UTF-8',HOME:process.env.HOME||require('node:os').homedir(),...(process.env.CODEX_HOME?{CODEX_HOME:process.env.CODEX_HOME}:{}),PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'}});}catch(e){gate.leave(body.desk);throw e;}
  const job={id,desk:body.desk,tool:kind==='pitch'?'pitch-agent':body.desk+'-agent',kind,params:body,agent_settings:settings,engine:'agent',modelInvoked:false,status:'running',started:new Date().toISOString(),child:proc,events:[{stage:'preparing',text:'Preparing script checks and a bounded specialist task.',at:new Date().toISOString()}]};
  jobs.set(id,job);saveJobs();let buffer='',size=0,response=null;
  proc.stdout.on('data',buf=>{size+=buf.length;if(size>1000000){job.error='Agent receipt exceeded the bounded limit.';job.status='failed';terminateJob(job);return;}buffer+=buf.toString();let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const item=JSON.parse(line);if(item.kind==='event'){job.events.push({stage:item.stage,text:item.text,at:item.at});job.events=job.events.slice(-40);job.runId=item.run_id;job.modelInvoked=item.modelInvoked===true;saveJobs();}else response=item;}catch{}}});
  proc.stderr.on('data',()=>{});proc.stdin.on('error',()=>{});
  const timer=setTimeout(()=>{job.status='timed_out';terminateJob(job);saveJobs();},190000);
  proc.on('error',()=>{job.error='Python agent worker could not start.';job.status='failed';});
  proc.on('close',()=>{clearTimeout(timer);gate.leave(body.desk);if(job.status==='running'){job.result=response?.value;job.status=response?.status===200?'needs_review':'failed';job.error=job.result?.error||(response?'Agent preflight refused the request.':'Agent stopped without a complete result.');if(job.status==='needs_review')delete job.error;job.modelInvoked=job.result?.modelInvoked===true;}
    delete job.child;job.finished=new Date().toISOString();job.events.push({stage:'finished',text:job.status==='needs_review'?'Draft saved for owner review.':job.error||job.status,at:job.finished});saveJobs();});
  proc.stdin.end(JSON.stringify({id,route:'/api/agents/run',method:'POST',body,settings})+'\n');return {id,status:'running',engine:'agent'};
}
function planHash(definition){return crypto.createHash('sha256').update(JSON.stringify(workflows.compile(definition))).digest('hex');}
async function workflowStep(body){
  if(halted)throw new Error('Emergency stop is active.');
  let state=readState();const definition=(state.workflows||[]).find(w=>w.id===body.id);if(!definition)throw new Error('Save a workflow first.');
  if([...jobs.values()].some(j=>j.workflowId===body.id&&j.status==='running'))throw new Error('This workflow already has an active step.');
  const plan=workflows.compile(definition),hash=planHash(definition);
  if(plan.requirements){const check=await call({route:'/api/workflow-check',method:'POST',body:plan.requirements});if(check.status!==200||!check.value.ready)throw Error(check.value.error||'Recipe prerequisites changed: '+check.value.missing.join(', '));state=readState();if(planHash(state.workflows.find(w=>w.id===body.id))!==hash)throw Error('Workflow changed during preflight. Reload.');if([...jobs.values()].some(j=>j.workflowId===body.id&&j.status==='running'))throw Error('This workflow already has an active step.');}state.workflowRuns=state.workflowRuns||{};
  let progress=state.workflowRuns[body.id];if(!progress||progress.planHash!==hash)progress=state.workflowRuns[body.id]={planHash:hash,completed:[],checkpoints:[],receipts:[]};
  let next=workflows.next(plan,progress.completed,progress.checkpoints);
  if(!next)return {complete:true,progress};
  if(next.kind==='owner'){
    if(body.confirmed!==true){writeState(state);return {checkpoint:next,progress};}
    progress.checkpoints.push(next.id);progress.receipts.push({nodeId:next.id,type:'ultra.owner.checkpoint',at:new Date().toISOString()});writeState(state);
    return {checkpointConfirmed:next.id,next:workflows.next(plan,progress.completed,progress.checkpoints),progress};
  }
  const previous=[...jobs.values()].reverse().find(j=>j.workflowId===body.id&&j.nodeId===next.id&&j.planHash===hash);
  if(previous?.status==='needs_review'&&body.retry!==true)return {needsReview:previous.id,step:next};
  writeState(state);return startJob({desk:next.desk,tool:next.tool,params:next.params},{workflowId:body.id,nodeId:next.id,planHash:hash});
}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function bodyOf(req){
  if(req.headers['transfer-encoding'])throw Object.assign(new Error('Chunked mutation is refused.'),{status:400});
  if(String(req.headers['content-type']||'').split(';')[0]!=='application/json')throw Object.assign(new Error('JSON required.'),{status:415});
  const length=Number(req.headers['content-length']);if(!Number.isInteger(length)||length<=0||length>400000)throw Object.assign(new Error('Request too large or empty.'),{status:413});
  let raw='';for await(const buf of req){raw+=buf.toString();if(Buffer.byteLength(raw)>400000)throw Object.assign(new Error('Request too large.'),{status:413});}
  const body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Object required.');return body;
}
async function handle(req,res){
  try{
    const url=new URL(req.url,'http://127.0.0.1'),p=url.pathname;
    const body=req.method==='POST'?await bodyOf(req):{};
    if(req.method==='POST'&&req.headers.origin!=='http://'+req.headers.host)return json(res,403,{error:'Same-origin owner action required.'});
    if(p==='/api/ultra/runtime'){
      if(req.method==='GET')return json(res,200,{state:readState(),version:version(),briefs:briefs.list(),jobs:[...jobs.values()].map(({child,...row})=>row),halted,
        policy:{models:'manual Codex CLI judgment',outbound:'disabled',scheduler:'disabled',maxWorkers:2,incrementalSpendTnd:0,accountCost:'unknown'}});
      if(String(req.headers['if-match']||'')!==version())return json(res,409,{error:'Station state changed. Reload before saving.'});
      stateSchema.validate(body);
      const state=readState();Object.assign(state,body);state.history.push({at:new Date().toISOString(),fields:Object.keys(body)});
      state.history=state.history.slice(-200);writeState(state);return json(res,200,{version:version()});
    }
    if(p==='/api/ultra/switches'){
      if(req.method==='GET')return json(res,200,{switches:switches.list(),version:switches.version(),problem:switches.problem()});
      if(req.method!=='POST')return json(res,405,{error:'Owner action requires POST.'});
      if(String(req.headers['if-match']||'')!==switches.version())return json(res,409,{error:'Switches changed. Reload before saving.'});
      try{switches.set(body.id,body.value);}catch(e){return json(res,e.code==='not_ready'?409:400,{error:e.message});}
      return json(res,200,{switches:switches.list(),version:switches.version()});
    }
    if(p==='/api/ultra/route-classes'&&req.method==='GET'){
      const routes=routeTable.map(r=>({key:policy.routeKey(r),cls:policy.classifyPath(policy.routeKey(r))}));
      return json(res,200,{routes,unclassified:routes.filter(r=>r.cls==='unclassified').map(r=>r.key)});
    }
    if(p==='/api/ultra/crew'&&req.method==='GET')return json(res,200,await crew.status());
    if(p==='/api/ultra/readiness'&&req.method==='GET')return json(res,200,{
      providers:registry.listProviderProfiles().map(p=>({...p,connected:false,modelInvoked:false,status:'disabled by campaign policy'})),
      connectors:connectorCatalog.list().map(c=>({id:c.id,name:c.name,category:c.category,authType:c.authType,connected:false})),
      integration:{id:'1ultra-campaign',transport:'private Python pipe',tools:workflows.TOOLS,version:1,
        digest:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'ultra-host.js'))).update(fs.readFileSync(path.join(__dirname,'..','scripts','campaign_rpc.py'))).digest('hex'),
        status:'built-in, fixed local routes'},extensions:'Third-party plugin execution is disabled. Hash-bound approval code is retained; installing or connecting requires separate scope.'});
    if(p==='/api/ultra/memory'){
      if(req.method!=='POST')return json(res,405,{error:'Owner action requires POST.'});
      if(req.headers['if-match']!==version())return json(res,409,{error:'Memory changed. Reload before saving.'});
      const state=readState(),note=state.memory.find(n=>n.id===body.id);if(!note)throw Error('Select an existing note.');
      if(body.action==='pin')state.memory=memcore.applyPin(state.memory,body.id,body.pinned===true).records;
      else if(body.action==='forget')state.memory=memcore.applyForget(state.memory,body.id).records;
      else if(body.action==='feedback'){
        state.memory=memcore.reduceStats(state.memory,{name:'memory.feedback',payload:{id:body.id,delta:2}},{now:Date.now()});
        state.memory.find(n=>n.id===body.id).feedback=[...(note.feedback||[]),{action:'useful',at:new Date().toISOString()}];
      }else throw Error('Choose pin, forget or feedback.');
      state.history.push({action:'memory.'+body.action,id:body.id,at:new Date().toISOString()});writeState(state);return json(res,200,{version:version()});
    }
    if(p==='/api/ultra/briefs'){
      if(req.method!=='POST')return json(res,405,{error:'Owner action requires POST.'});
      if(typeof body.directive!=='string'||!body.directive.trim()||typeof body.answer!=='string'||!body.answer.trim()||typeof body.question!=='string'||!body.question.trim())throw Error('Supply a task, one question and an owner answer.');
      if(!readState().workstreams?.workstreams?.some(w=>w.id===body.streamId))throw Error('Select a saved session first.');
      const key='session:'+body.streamId,prior=briefs.active(key),id='brief-'+crypto.randomBytes(6).toString('hex');
      await briefs.prepare({key,id,streamId:body.streamId,text:prior?.originalDirective||body.directive,source:'interactive'},Date.now());
      await briefs.ask(id,{text:body.question,options:['Keep current scope','Apply owner correction']},Date.now(),{source:'marker'});
      await briefs.answerInTurn(id,(prior&&body.directive!==prior.originalDirective?'Task correction: '+body.directive+' · ':'')+body.answer,Date.now());return json(res,200,{brief:briefs.active(key)});
    }
    if(['/api/ultra/jobs','/api/ultra/control','/api/ultra/workflows/step','/api/ultra/agents/run','/api/ultra/agents/adopt'].includes(p)&&req.method!=='POST')return json(res,405,{error:'Owner action requires POST.'});
    if(p==='/api/ultra/agents/run')return json(res,200,startAgent(body));
    if(p==='/api/ultra/agents/adopt'&&halted)throw Error('Emergency stop is active.');
    if(p==='/api/ultra/jobs')return json(res,200,startJob(body));
    if(p==='/api/ultra/workflows/step')return json(res,200,await workflowStep(body));
    if(p==='/api/ultra/control'){
      if(body.action==='stop'){const problems=[];try{onStationHalt();}catch(e){problems.push(e.message);}try{stationHalt();}catch(e){problems.push('Starnet halt failed: '+((e&&e.message)||e));}return json(res,problems.length?500:200,{halted:true,problems});}
      else if(body.action==='resume'){try{onStationResume();}catch(e){return json(res,500,{halted:true,problems:[(e&&e.message)||String(e)]});}}
      else if(body.action==='cancel'){const job=jobs.get(body.id);if(job?.cancellable===false)throw Error('This short atomic preparation write is finishing; new preparation is stopped separately.');if(job?.child){job.status='cancelled';terminateJob(job);saveJobs();}durable(controlFile,{halted});}
      else throw new Error('Choose stop, resume or cancel.');return json(res,200,{halted});
    }
    const request={route:req.url.replace('/api/ultra/','/api/'),method:req.method,body,version:req.headers['if-match']||'',task_version:req.headers['x-task-version']||''};
    if(req.method==='POST'&&['/api/ultra/automate','/api/ultra/draft','/api/ultra/simulate','/api/ultra/prepare'].includes(p)){
      if(halted)throw Error('Emergency stop is active.');
      const roleTools={ultra_research:['research','lead-audit'],ultra_sales:['sales','outreach-drafts'],ultra_delivery:['delivery','scope-check'],ultra_qa:['qa','validate-records'],ultra_ops:['qa','daily-pack'],ultra_finance:['qa','finance-pack'],ultra_customer:['sales','rehearsal']};
      let tool=p.endsWith('/automate')?body.automation:p.endsWith('/simulate')?'rehearsal':p.endsWith('/prepare')?'daily-pack':roleTools[body.role]?.[1];
      const desk=tool==='lead-audit'?'research':['outreach-drafts','rehearsal'].includes(tool)?'sales':['scope-check','csv-workbench'].includes(tool)?'delivery':'qa';
      const job=startJob({desk,tool,params:p.endsWith('/automate')?body.params||{}:p.endsWith('/simulate')?{scenario:body.scenario||'messy-pilot'}:{}});
      await new Promise((resolve,reject)=>{const until=Date.now()+185000,timer=setInterval(()=>{const row=jobs.get(job.id);if(row.status!=='running'){clearInterval(timer);resolve();}else if(Date.now()>until){clearInterval(timer);reject(Error('Job timed out. Inspect runtime receipts.'));}},30);});
      const row=jobs.get(job.id);return json(res,['prepared','needs_review'].includes(row.status)?200:400,row.result||{error:row.error||row.status});
    }
    if(req.method==='POST'&&['/api/ultra/campaign/proof','/api/ultra/campaign/variant','/api/ultra/prospecting/draft','/api/ultra/prospecting/draft-edit','/api/ultra/prospecting/import','/api/ultra/judgment'].includes(p)){
      if(halted)throw Error('Emergency stop is active.');
      const desk=p.endsWith('/import')?'research':p!=='/api/ultra/judgment'?'sales':({ultra_research:'research',ultra_sales:'sales',ultra_delivery:'delivery',ultra_qa:'qa'})[body.role];if(!desk)throw Error('Choose a known judgment desk.');
      gate.enter(desk);const id='job-'+crypto.randomBytes(6).toString('hex'),job={id,desk,tool:p==='/api/ultra/judgment'?'judgment-prompt':p.split('/').slice(-2).join('-'),engine:'script',modelInvoked:false,status:'running',cancellable:false,started:new Date().toISOString(),events:[{type:'ultra.script.started',at:new Date().toISOString()}]};jobs.set(id,job);saveJobs();
      try{const response=await call(request);job.result=response.value;job.status=response.status===200?'prepared':'failed';return json(res,response.status,response.value);}
      catch(e){job.status='failed';job.error=e.message;throw e;}
      finally{gate.leave(desk);job.finished=new Date().toISOString();job.events.push({type:'ultra.script.finished',at:job.finished,status:job.status});saveJobs();}
    }
    const response=await call(request);return json(res,response.status,response.value);
  }catch(e){json(res,e.status||400,{error:e.message||'Local action failed.'});}
}
function classic(req,res,token){
  let name;try{name=decodeURIComponent(req.url.split('?')[0].slice('/classic'.length));if(!name||name==='/')name='/index.html';}catch{res.writeHead(400);return res.end();}
  const base=path.join(__dirname,'..','web'),file=path.resolve(base,'.'+name);
  if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()||fs.realpathSync(file)!==file){res.writeHead(404);return res.end();}
  const ext=path.extname(file),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
  let data=fs.readFileSync(file);
  if(ext==='.html')data=Buffer.from(data.toString().replace('<head>','<head><script>window.ULTRA_API_BASE="/api/ultra";window.__STARNET_API_TOKEN__='+JSON.stringify(token)+';</script>').replace(/(src|href)="\//g,'$1="/classic/'));
  if(ext==='.css')data=Buffer.from(data.toString().replace(/url\(['"]?\/assets\//g,"url('/classic/assets/"));
  res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream'});res.end(data);
}
// The campaign page is 1Ultra's own station page, framed inside Starnet. Path-jailed to frontend/campaign/.
const CAMPAIGN_BASE=fs.realpathSync(path.join(__dirname,'frontend','campaign'));
function campaign(req,res,token){
  let name;try{name=decodeURIComponent(String(req.url).split('?')[0].slice('/campaign'.length));}catch{res.writeHead(400);return res.end();}
  if(!name){res.writeHead(302,{Location:'/campaign/'});return res.end();}
  if(name==='/')name='/index.html';
  const file=path.resolve(CAMPAIGN_BASE,'.'+name);
  if(!file.startsWith(CAMPAIGN_BASE+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()||fs.realpathSync(file)!==file){res.writeHead(404);return res.end();}
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8'};
  let data=fs.readFileSync(file);
  if(path.basename(file)==='index.html')data=Buffer.from(data.toString().replace('<head>','<head><script>window.__STARNET_API_TOKEN__='+JSON.stringify(token)+';</script>'));
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Frame-Options':'SAMEORIGIN','Content-Security-Policy':"frame-ancestors 'self'",'X-Content-Type-Options':'nosniff'});
  res.end(data);
}
// One emergency stop: the 1Ultra stop also halts Starnet (runs, lines, cron, dispatch), Starnet's E-STOP also sets the
// 1Ultra stop, and Starnet's RESUME clears both. While stopped, every agent run is refused before it reaches a model.
let stationHalt=()=>{};
function registerStationHalt(fn){if(typeof fn==='function')stationHalt=fn;}
// Model requests listen to this signal; the stop aborts the ones already in flight, resume hands out a fresh one.
let stopCtl=new AbortController();
function stopSignal(){return stopCtl.signal;}
function onStationHalt(){
  halted=true;try{stopCtl.abort(Object.assign(new Error('Emergency stop is on. Resume before any model call.'),{code:'ULTRA_EMERGENCY_STOP'}));}catch(_){}for(const job of jobs.values())if(job.child){job.status='cancelled';terminateJob(job);}
  try{saveJobs();durable(controlFile,{halted});}
  catch(e){throw new Error('Emergency stop is on, but its state was not saved: '+((e&&e.message)||e));}
}
function onStationResume(){durable(controlFile,{halted:false});halted=false;if(stopCtl.signal.aborted)stopCtl=new AbortController();}
function isHalted(){return halted;}
function beforeRun(o){const r=policy.admitRun({halted});if(!r.ok)throw Object.assign(new Error(r.error),{code:'ULTRA_EMERGENCY_STOP'});crew.rewriteLeadRun(o);}
function assertProviderAllowed(opts){const r=policy.providerAllowed(opts&&opts.provider,switches);if(!r.ok)throw Object.assign(new Error(r.error),{code:'ULTRA_PROVIDER_OFF'});}
// Checked on every model request (each stream call, each Codex token use), not only when an adapter is built.
function assertModelRequest(opts){if(halted)throw Object.assign(new Error('Emergency stop is on. Resume before any model call.'),{code:'ULTRA_EMERGENCY_STOP'});assertProviderAllowed(opts);}
let routeTable=[];
function registerRoutes(routes){routeTable=routes;}
const preGate=(method,url)=>policy.preGate(method,url,switches);
const routeGate=r=>policy.routeGate(r,switches);
process.on('exit',()=>{if(rpc)rpc.kill('SIGTERM');for(const job of jobs.values())terminateJob(job);});
module.exports={root,runtime,policy,handle,classic,campaign,switches,preGate,routeGate,registerRoutes,beforeRun,assertProviderAllowed,assertModelRequest,stopSignal,onStationHalt,onStationResume,registerStationHalt,isHalted,crew,registerProviderConfig:fn=>crew.registerProviderConfig(fn),registerCodexState:fn=>crew.registerCodexState(fn)};
policy.setProtectedRoots({root,runtime});
policy.install(runtime,switches,{freellmapiPort:crewPort});
