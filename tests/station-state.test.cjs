const assert=require('node:assert/strict'),test=require('node:test');
const {validate}=require('../station/ultra-state.js');
test('runtime saves validate shape and cannot inject authoritative workflow receipts',()=>{
  assert.throws(()=>validate({workflowRuns:{fake:{completed:['sent']}}}),/Unsupported/);
  assert.throws(()=>validate({memory:{}}),/bounded list/);
  assert.throws(()=>validate({memory:[{id:'note',status:'hypothesis',content:'Buyer might need help'}]}),/source/);
  assert.throws(()=>validate({crew:{finance:{}}}),/known/);
  assert.throws(()=>validate({settings:{theme:'x',text:100,reducedMotion:false}}),/supported/);
  assert.doesNotThrow(()=>validate({memory:[{id:'note',status:'hypothesis',content:'Possible need',source:'https://example.tn'}]}));
});
test('agent settings reject unknown skills, unsafe fields and invalid effort',()=>{
  assert.doesNotThrow(()=>validate({crew:{sales:{enabled:true,reasoning_effort:'xhigh',skills:['ultra-sales'],instructions:'Ask one question.'}}}));
  for(const settings of [{reasoning_effort:'unlimited'},{skills:['../../private']},{skills:['ultra-prospect']},{enabled:'yes'},{instructions:'x'.repeat(4001)},{shell:true}])assert.throws(()=>validate({crew:{sales:settings}}));
});
