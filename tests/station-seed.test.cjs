const assert=require('node:assert/strict'),test=require('node:test');
const Seed=require('../station/ultra-seed.js');
test('seed resumes straight into the station on the codex provider without inventing business facts',()=>{
  const files=Seed.files(1760054400000);
  assert.deepEqual(Object.keys(files).sort(),['_commander.dossier.json','agent.roster.json','agent.save.json']);
  const save=files['agent.save.json'];
  assert.equal(save.agentId,'agent');assert.equal(save.doc.schema,'starnet.save');assert.equal(save.doc.version,5);
  assert.equal(save.doc.prov,'codex');assert.equal(save.doc.agent.name,'ULTRA');assert.equal(save.doc.agent.model,'gpt-6.1-sol');
  assert.equal(save.doc.reasoningEffort,'xhigh');assert.equal(files['agent.roster.json'].agents[0].reasoningEffort,'xhigh');
  assert.deepEqual(save.doc.agents,[]);assert.equal(save.doc.agent.stats.xp,0);
  assert.equal(files['agent.roster.json'].agents[0].provider,'codex');
  assert.doesNotMatch(JSON.stringify(files),/StarNet|STARNET/);
  assert.doesNotMatch(JSON.stringify(files),/revenue|\bTND\b/i);
  assert.match(save.doc.agent.docs.manual,/^Drafts go to the Outbox for review\. Never claim a message was sent/);
  assert.deepEqual(save.doc.usage,{tokens:0,cost:0,calls:0});
  assert.match(files['_commander.dossier.json'].block,/Adem sends messages and records outcomes himself/);
});
