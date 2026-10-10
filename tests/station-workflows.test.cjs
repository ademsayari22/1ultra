const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../station/frontend/campaign/ultra-workflows.js');
test('typed script workflow compiles and enforces owner checkpoints',()=>{
 const plan=F.compile({nodes:[{id:'audit',kind:'script',tool:'lead-audit',desk:'research',params:{}},{id:'review',kind:'owner',label:'Review sources'},{id:'draft',kind:'script',tool:'outreach-drafts',desk:'sales',params:{}}],edges:[['audit','review'],['review','draft']]});
 assert.deepEqual(plan.order,['audit','review','draft']);assert.equal(F.next(plan,[],[]).id,'audit');
 assert.equal(F.next(plan,['audit'],[]).kind,'owner');assert.equal(F.next(plan,['audit'],['review']).id,'draft');
});
test('cycles, unknown tools, recursive model steps and excessive nodes are refused',()=>{
 assert.throws(()=>F.compile({nodes:[{id:'a',kind:'script',tool:'shell.exec',desk:'research'}],edges:[]}),/catalogued/);
 assert.throws(()=>F.compile({nodes:[{id:'a',kind:'model'}],edges:[]}),/script or owner/);
 assert.throws(()=>F.compile({nodes:[{id:'a',kind:'owner'},{id:'b',kind:'owner'}],edges:[['a','b'],['b','a']]}),/cycle/);
 assert.throws(()=>F.compile({nodes:Array.from({length:13},(_,i)=>({id:'n'+i,kind:'owner'})),edges:[]}),/12/);
});
