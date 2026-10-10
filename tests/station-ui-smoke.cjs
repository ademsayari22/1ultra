const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
test('campaign station renders sourced lead and tabs from the imported world/session modules',async()=>{
  const elements=new Map();function el(id){if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',style:{},dataset:{},classList:{remove(){},toggle(){}},addEventListener(){},querySelectorAll(){return [];},close(){this.open=false;},showModal(){this.open=true;},onclick:null});return elements.get(id);}
  const W={hunt:{leads:[{id:'local',company:'Local ERP',country:'TN',location:'Sousse',industry:'ERP',pipeline_stage:'scout',source_url:'https://example.tn',observed_fact:'Published ERP services',checked_date:'2026-10-05',contact_route:'info@example.tn'}],offers:[{id:'documents',name:'Document to checked table'}]},record_versions:{leads:'v1'},tasks:[],runs:[],automations:[{id:'validate-records',name:'Record sentinel',description:'Check records'},{id:'csv-workbench',name:'CSV workbench',description:'Check supplied CSV'}],scenarios:[],progression:{xp:0},local_date:'2026-10-05'};
  const C={rankings:[{id:'local',score:85,factors:[{factor:'fit',reason:'Observed',points:40,weight:40}],unknowns:[]}],weights:{fit:40,evidence:25,contact:20,freshness:15},experiment_results:[],experiments:[],analytics:{counts:{sourced:1,shortlisted:0,contacted:0,replied:0},attempts:0,cohort:'Tunisia companies'},events:[],contacts:[],signals:[],followups:[],variants:[],proofs:[],suppressed_ids:[]};
  const R={state:{settings:{theme:'dark',text:16},world:null,workstreams:null},jobs:[],version:'v1'};
  const A={reasoning_efforts:['low','medium','high','xhigh'],desks:Object.fromEntries(['research','sales','delivery','qa'].map(d=>[d,{defaults:{enabled:true,reasoning_effort:'xhigh',skills:d==='sales'?['ultra-sales']:[],instructions:''},role:{id:'ultra_'+d,path:'.codex/agents/ultra_'+d+'.toml',available:true},skills:d==='sales'?[{id:'ultra-sales',available:true}]:[]}]))};
  const requests=[];
  const context=vm.createContext({console,Date,Math,JSON,URL,URLSearchParams,TextEncoder,Uint8Array,crypto:globalThis.crypto,setTimeout,clearTimeout,setInterval:()=>0,clearInterval,
    FormData:class {constructor(form){this.values=form.fixtureFields;}*[Symbol.iterator](){yield*Object.entries(this.values);}},
    history:{state:null,replaceState(state){this.state=state;},pushState(state){this.state=state;},back(){}},location:{origin:'http://127.0.0.1:8543',hash:'#campaign'},window:{__STARNET_API_TOKEN__:'fixture',scrollTo(){},addEventListener(){}},document:{body:{dataset:{},style:{}},getElementById:el,addEventListener(){},querySelector(){return {dataset:{},classList:{remove(){},toggle(){}}};}},
    fetch:async(url,options)=>{requests.push({url,body:options.body});if(url.endsWith('/runtime')&&options.body)Object.assign(R.state,JSON.parse(options.body));return {ok:true,json:async()=>url.endsWith('/jobs')?{id:'job-fixture',status:'running'}:url.endsWith('/agents/catalog')?A:url.endsWith('/workflows/step')?{id:'job-scope',status:'running'}:url.includes('/workspace')?W:url.includes('/campaign')?C:R};},scrollTo(){},confirm(){return false}});
  for(const file of ['lib/util.js','lib/pipeline.js','lib/worldmodel.js','lib/workstreams.js','lib/recipes.js','ultra-workflows.js','ultra-experience.js','ultra-app.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../station/frontend/campaign',file),'utf8'),context,{filename:file});
  await new Promise(resolve=>setTimeout(resolve,20));
  const html=el('content').innerHTML;
  assert.match(html,/Local ERP/);assert.match(html,/Why this company ranks here/);assert.match(html,/Apollo/);assert.match(el('nav').innerHTML,/Workflows/);
  assert.doesNotMatch(html,/Station could not load records/);
  for(const tab of ['station','sessions','tasks','workflows','recipes','crew','memory','outbox','settings']){vm.runInContext(`go('${tab}')`,context);assert.ok(el('content').innerHTML.length>100,tab);}
  await vm.runInContext("action('agent-settings:sales')",context);
  assert.match(el('modal-body').innerHTML,/xhigh · default/);
  assert.match(el('modal-body').innerHTML,/ultra-sales/);
  await vm.runInContext("submit({dataset:{submit:'agent-settings:sales'},fixtureFields:{reasoning_effort:'high',instructions:'One question only.'},elements:{enabled:{checked:true},'skill_ultra-sales':{checked:false}}})",context);
  assert.equal(R.state.crew.sales.reasoning_effort,'high');assert.deepEqual(R.state.crew.sales.skills,[]);
  assert.equal(R.state.crew.sales.instructions,'One question only.');
  vm.runInContext('closeModal()',context);
  await vm.runInContext("action('typed-script:validate-records')",context);
  const launches=requests.filter(row=>row.url.endsWith('/jobs'));
  assert.equal(launches.length,1,'A no-input script must run on the first click');
  assert.deepEqual(JSON.parse(launches[0].body),{desk:'qa',tool:'validate-records',params:{}});
  assert.equal(!!el('modal').open,false,'Running a no-input script does not open its source or an empty form');
  await vm.runInContext("action('typed-script:csv-workbench')",context);
  assert.match(el('modal-body').innerHTML,/CSV to check/);
  assert.equal(requests.filter(row=>row.url.endsWith('/jobs')).length,1,'Input-dependent tools wait for their supplied input');
  vm.runInContext("closeModal(); typedRecipe={id:'pilot',requirements:{kind:'pilot',lead_ids:['local']}}",context);
  await vm.runInContext("submit({dataset:{submit:'typed-script:scope-check'},fixtureFields:{fields:'id,amount',quantity:'5',price_minor:'10000',currency:'TND',sample_reference:'FICTIONAL UNIT TEST sample'},elements:{input_permission:{checked:true}}})",context);
  const boundRuns=requests.filter(row=>row.url.endsWith('/workflows/step'));
  assert.equal(boundRuns.length,1,'Run local script must execute the configured pilot check, rather than only save its workflow');
  const bound=R.state.workflows.find(f=>f.id===JSON.parse(boundRuns[0].body).id);
  assert.equal(bound.nodes[0].tool,'scope-check');assert.equal(bound.nodes[1].kind,'owner');
  assert.deepEqual(bound.nodes[0].params.scope.fields,['id','amount']);
  await vm.runInContext("action('pitch')",context);
  const pitches=requests.filter(row=>row.url.endsWith('/agents/run'));
  assert.equal(pitches.length,1,'Generate pitch launches a Sales agent rather than a fixed template');
  assert.equal(JSON.parse(pitches[0].body).desk,'sales');
  assert.equal(JSON.parse(pitches[0].body).lead_id,'local');
  assert.equal(JSON.parse(pitches[0].body).offer,'documents');
  await vm.runInContext("action('agent:qa')",context);
  assert.match(el('modal-body').innerHTML,/What should the specialist decide/);
  vm.runInContext('clearTimeout(toast.timer)',context);
});
