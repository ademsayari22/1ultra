const {test}=require('node:test');
const assert=require('node:assert/strict');
const Experience=require('../station/frontend/campaign/ultra-experience.js');

test('Back restores company and room context, survives refresh, and never leaves the app',()=>{
  const nav=Experience.navigation(['campaign','station','recipes'],{tab:'campaign',selected:'company-a'});
  assert.equal(nav.canBack(),false);
  nav.visit({tab:'station',room:'pitch-room'});
  nav.visit({tab:'recipes'});
  assert.equal(nav.back().room,'pitch-room');
  const restored=Experience.navigation(['campaign','station','recipes'],{tab:'station'},nav.snapshot());
  assert.equal(restored.back().selected,'company-a');
  assert.equal(restored.back(),null);
  assert.throws(()=>restored.visit({tab:'https://example.com'}),/Unknown/);
  restored.visit({tab:'recipes'});
  assert.equal(restored.snapshot().entries.length,2,'Forward history is replaced after going back');
});

test('Running progress is indeterminate; failed and cancelled jobs never show 100 percent',()=>{
  const started='2026-10-05T12:00:00Z',finished='2026-10-05T12:00:04Z';
  assert.equal(Experience.jobProgress({status:'running',started},Date.parse(finished)).value,null);
  assert.equal(Experience.jobProgress({status:'running',started},Date.parse(finished)).elapsed,'4s');
  assert.equal(Experience.jobProgress({status:'prepared',started,finished}).value,100);
  const review=Experience.jobProgress({status:'needs_review',started,finished});
  assert.equal(review.value,100);assert.match(review.detail,/review/i);
  for(const status of ['failed','cancelled','interrupted','timed_out']){
    assert.equal(Experience.jobProgress({status,started,finished}).value,0,status);
  }
  assert.equal(Experience.jobProgress({status:'starting',started:'invalid'}).elapsed,'0s');
});

test('Workflow percentage counts only distinct passed scripts and confirmed owner steps',()=>{
  const plan={nodes:[{id:'audit',kind:'script'},{id:'review',kind:'owner'},{id:'pitch',kind:'script'}]};
  const result=Experience.workflowProgress(plan,{completed:['audit','audit','review','ghost'],checkpoints:['audit']});
  assert.equal(result.done,1);assert.equal(result.total,3);assert.equal(result.percent,33);
  assert.equal(Experience.workflowProgress(plan,{completed:['audit'],checkpoints:['review']}).percent,67);
  assert.equal(Experience.workflowProgress(plan,{completed:['audit'],checkpoints:['review']},false).percent,0,'Changed plans discard stale progress');
});
