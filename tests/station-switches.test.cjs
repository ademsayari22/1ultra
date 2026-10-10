const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const test=require('node:test');
const {makeSwitches}=require('../station/ultra-switches.js');
function store(extra={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ultra-switches-'));return makeSwitches({fs,path,file:path.join(dir,'ultra-switches.json'),now:()=>'2026-10-10T00:00:00.000Z',...extra});}
test('defaults: everything off except escalation (inert) and concurrency 2',()=>{
  const s=store();const byId=Object.fromEntries(s.list().map(r=>[r.id,r]));
  assert.equal(byId['lead.codex'].value,false);assert.equal(byId['crew.freellmapi'].value,false);
  assert.equal(byId['crew.escalate_to_lead'].value,true);assert.equal(byId.concurrency.value,2);assert.equal(byId.spend_cap_usd.value,0);
  for(const id of ['tools.web','tools.browser','tools.shell','tools.computer','tools.mcp','cron','nightshift','voice','skills.market','channels.telegram','channels.discord','channels.slack','channels.signal','channels.matrix'])assert.equal(byId[id].value,false,id);
  assert.deepEqual(s.list().filter(r=>r.ready).map(r=>r.id).sort(),['concurrency','spend_cap_usd']);
  assert.equal(s.isOn('channels'),false);assert.equal(s.isOn('providers'),false);
});
test('only ready switches change, with type and range checks and history',()=>{
  const s=store();
  assert.throws(()=>s.set('tools.web',true),e=>e.code==='not_ready');
  assert.throws(()=>s.set('nope',true),e=>e.code==='unknown');
  assert.throws(()=>s.set('concurrency','3'),e=>e.code==='invalid');
  assert.throws(()=>s.set('concurrency',0),e=>e.code==='invalid');
  assert.throws(()=>s.set('concurrency',9),e=>e.code==='invalid');
  assert.throws(()=>s.set('spend_cap_usd',-1),e=>e.code==='invalid');
  const before=s.version();s.set('concurrency',3);assert.notEqual(s.version(),before);assert.equal(s.value('concurrency'),3);
  const saved=JSON.parse(fs.readFileSync(s.file,'utf8'));
  assert.deepEqual(saved.history.at(-1),{at:'2026-10-10T00:00:00.000Z',id:'concurrency',from:2,to:3});
});
test('values persist across instances and provider switches are generated',()=>{
  const s=store({providerIds:['anthropic','openrouter']});s.set('spend_cap_usd',5);
  const again=makeSwitches({fs,path,file:s.file,providerIds:['anthropic','openrouter']});
  assert.equal(again.value('spend_cap_usd'),5);
  assert.deepEqual(again.list().filter(r=>r.id.startsWith('providers.')).map(r=>[r.id,r.value,r.ready]),[['providers.anthropic',false,false],['providers.openrouter',false,false]]);
  assert.throws(()=>again.value('providers.gemini'),/Unknown switch/);
});
