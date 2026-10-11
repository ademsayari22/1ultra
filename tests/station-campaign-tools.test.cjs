'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeCampaignTools } = require('../station/ultra-campaign-tools.js');
const { makeRegistry } = require('../station/sidecar/tools/registry.js');

function fakeRegistry() { const tools = new Map(); return { tools, register: t => tools.set(t.name, t) }; }

test('campaign tools register as read tools on the campaign capability and call the worker in process', async () => {
  const calls = [];
  const tools = makeCampaignTools({ call: async req => { calls.push(req); return { ok: true, route: req.route }; }, isHalted: () => false });
  const reg = fakeRegistry();
  tools.register(reg);
  for (const name of ['campaign.leads', 'campaign.lead']) {
    const t = reg.tools.get(name);
    assert.ok(t, name);
    assert.equal(t.capability, 'campaign');
    assert.equal(t.scope, 'read');
    assert.equal(t.requiresConsent, false);
  }
  const out = await reg.tools.get('campaign.lead').run({ id: 'tn' }, {});
  assert.equal(calls[0].route, '/api/tools/lead?id=tn');
  assert.equal(calls[0].method, 'GET');
  assert.match(out.content, /"route"/);
  await reg.tools.get('campaign.leads').run({ query: 'ERP & co', limit: 5 }, {});
  assert.equal(calls[1].route, '/api/tools/leads?query=ERP+%26+co&limit=5');
  assert.match(tools.brief(), /campaign\.lead/);
});

test('a worker refusal rejects with a readable tool error', async () => {
  const tools = makeCampaignTools({ call: async () => { throw new Error('Unknown or out-of-scope company.'); }, isHalted: () => false });
  const reg = fakeRegistry(); tools.register(reg);
  await assert.rejects(reg.tools.get('campaign.lead').run({ id: 'x' }, {}), /Campaign tool error: Unknown or out-of-scope company/);
});

test('the emergency stop refuses every campaign tool before the worker is called', async () => {
  let called = false;
  const tools = makeCampaignTools({ call: async () => { called = true; return {}; }, isHalted: () => true });
  const reg = fakeRegistry(); tools.register(reg);
  await assert.rejects(reg.tools.get('campaign.leads').run({}, {}), /The emergency stop is on: campaign tools are paused\./);
  assert.equal(called, false);
});

test('campaign tools forward only allowed arguments and the fixed read request shape', async () => {
  const calls = [];
  const tools = makeCampaignTools({ call: async req => { calls.push(req); return { count: 0 }; }, isHalted: () => false });
  const reg = fakeRegistry(); tools.register(reg);
  await reg.tools.get('campaign.leads').run({ offer: 'catalogue', query: 'Sfax', limit: 3, route: '/api/leads', body: 'private' }, { agentId: 'crew' });
  assert.deepEqual(calls[0], { route: '/api/tools/leads?offer=catalogue&query=Sfax&limit=3', method: 'GET', body: null, version: '' });
  await reg.tools.get('campaign.lead').run({ id: 'tn & 2', offer: 'cleanup', private: 'secret' }, {});
  assert.equal(calls[1].route, '/api/tools/lead?id=tn+%26+2');
  await reg.tools.get('campaign.leads').run({}, {});
  assert.equal(calls[2].route, '/api/tools/leads');
});

test('every registered tool stops and can resume without invoking the worker while halted', async () => {
  let halted = true, called = 0;
  const tools = makeCampaignTools({ call: async () => { called++; return {}; }, isHalted: () => halted });
  const reg = fakeRegistry(); tools.register(reg);
  for (const tool of reg.tools.values()) {
    await assert.rejects(tool.run({ id: 'tn' }, {}), /The emergency stop is on: campaign tools are paused\./);
  }
  assert.equal(called, 0);
  halted = false;
  await reg.tools.get('campaign.lead').run({ id: 'tn' }, {});
  assert.equal(called, 1);
});

test('a normal worker 400 envelope rejects with its readable error', async () => {
  const result = { id: 1, status: 400, value: { error: 'Invalid campaign request.' } };
  const tools = makeCampaignTools({ call: async () => result, isHalted: () => false });
  const reg = fakeRegistry(); tools.register(reg);
  await assert.rejects(reg.tools.get('campaign.lead').run({ id: 'missing' }, {}), /Campaign tool error: Invalid campaign request\./);
});

test('bad arguments reject before calling the worker', async () => {
  let called = false;
  const tools = makeCampaignTools({ call: async () => { called = true; return {}; }, isHalted: () => false });
  const reg = fakeRegistry(); tools.register(reg);
  const cases = [
    ['campaign.lead', null], ['campaign.lead', {}], ['campaign.lead', { id: 3 }],
    ['campaign.leads', { offer: 'missing' }], ['campaign.leads', { query: 'x'.repeat(101) }],
    ['campaign.leads', { limit: 0 }], ['campaign.leads', { limit: 51 }], ['campaign.leads', { limit: 1.5 }],
  ];
  for (const [name, args] of cases) {
    await assert.rejects(reg.tools.get(name).run(args, {}), /Campaign tool error: invalid arguments/);
  }
  assert.equal(called, false);
});

test('the real dispatcher marks campaign failures as errors and successful packets as success', async () => {
  let halted = true, failure = null, called = 0;
  const packet = { lead: { id: 'tn', company: 'Local ERP' } };
  const tools = makeCampaignTools({ call: async () => {
    called++;
    if (failure instanceof Error) throw failure;
    return failure || { status: 200, value: packet };
  }, isHalted: () => halted });
  const registry = makeRegistry(); tools.register(registry);
  const ctx = { agentId: 'crew', canUse: (call, tool) => ({ ok: tool.capability === 'campaign' && tool.scope === 'read' }) };
  const call = { name: 'campaign.lead', args: { id: 'tn' } };
  const stopped = await registry.dispatch(call, ctx);
  assert.equal(stopped.ok, false);
  assert.equal(stopped.isError, true);
  assert.match(stopped.content, /The emergency stop is on: campaign tools are paused\./);
  assert.equal(called, 0);

  halted = false;
  failure = new Error('Company excluded.');
  const thrown = await registry.dispatch(call, ctx);
  assert.equal(thrown.ok, false);
  assert.equal(thrown.isError, true);
  assert.match(thrown.content, /Campaign tool error: Company excluded\./);

  failure = { status: 400, value: { error: 'Invalid campaign request.' } };
  const refused = await registry.dispatch(call, ctx);
  assert.equal(refused.ok, false);
  assert.equal(refused.isError, true);
  assert.match(refused.content, /Campaign tool error: Invalid campaign request\./);

  failure = null;
  const successful = await registry.dispatch(call, ctx);
  assert.equal(successful.ok, true);
  assert.equal(successful.isError, false);
  assert.deepEqual(JSON.parse(successful.content), { status: 200, value: packet });
  assert.equal(called, 3);

  const invalid = await registry.dispatch({ name: 'campaign.lead', args: {} }, ctx);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.isError, true);
  assert.match(invalid.content, /invalid arguments/);
  assert.equal(called, 3);
});
