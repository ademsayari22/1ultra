'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeCampaignTools } = require('../station/ultra-campaign-tools.js');

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

test('a worker refusal comes back as a readable tool error, never a crash', async () => {
  const tools = makeCampaignTools({ call: async () => { throw new Error('Unknown or out-of-scope company.'); }, isHalted: () => false });
  const reg = fakeRegistry(); tools.register(reg);
  const out = await reg.tools.get('campaign.lead').run({ id: 'x' }, {});
  assert.equal(out.summary, 'error');
  assert.match(out.content, /Unknown or out-of-scope company/);
});

test('the emergency stop refuses every campaign tool before the worker is called', async () => {
  let called = false;
  const tools = makeCampaignTools({ call: async () => { called = true; return {}; }, isHalted: () => true });
  const reg = fakeRegistry(); tools.register(reg);
  const out = await reg.tools.get('campaign.leads').run({}, {});
  assert.equal(called, false);
  assert.match(out.content, /emergency stop/i);
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
    assert.deepEqual(await tool.run({ id: 'tn' }, {}), { content: 'The emergency stop is on: campaign tools are paused.', summary: 'error' });
  }
  assert.equal(called, 0);
  halted = false;
  await reg.tools.get('campaign.lead').run({ id: 'tn' }, {});
  assert.equal(called, 1);
});

test('a normal worker 400 envelope is marked as a tool error', async () => {
  const result = { id: 1, status: 400, value: { error: 'Invalid campaign request.' } };
  const tools = makeCampaignTools({ call: async () => result, isHalted: () => false });
  const reg = fakeRegistry(); tools.register(reg);
  const out = await reg.tools.get('campaign.lead').run({ id: 'missing' }, {});
  assert.equal(out.summary, 'error');
  assert.deepEqual(JSON.parse(out.content), result);
});
