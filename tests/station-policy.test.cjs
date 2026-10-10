const assert = require('node:assert/strict');
const test = require('node:test');
const Policy = require('../station/ultra-policy.js');
test('all upstream external/model routes fail closed including restored scheduler settings', () => {
  for (const route of ['/api/run','/v1/chat/completions','/api/cron/arm','/api/providers/probe','/api/connectors','/api/autonomy/posture','/api/plugins/approve']) {
    assert.equal(Policy.routeAllowed('POST',route), false, route);
  }
  assert.equal(Policy.routeAllowed('GET','/api/ultra/workspace'),true);
  assert.equal(Policy.routeAllowed('POST','/api/ultra/campaign/event'),true);
  assert.throws(() => Policy.assertModelAllowed(), /disabled/);
});
test('script job limits reject duplicate desks and the third worker', () => {
  const gate=Policy.makeGate(); gate.enter('research');
  assert.throws(()=>gate.enter('research'),/already/); gate.enter('sales');
  assert.throws(()=>gate.enter('qa'),/two/); gate.leave('research');gate.enter('qa');
});
test('runtime paths cannot overlap business records', () => {
  assert.equal(Policy.runtimeAllowed('/home/adem/1ultra','/home/adem/1ultra/data'),false);
  assert.equal(Policy.runtimeAllowed('/tmp/fixture','/tmp/fixture/data'),false);
  assert.equal(Policy.runtimeAllowed('/home/adem/1ultra','/home/adem/1ultra/runs/station-runtime'),true);
  assert.equal(Policy.runtimeAllowed('/tmp/fixture','/tmp/fixture/runtime'),true);
});
