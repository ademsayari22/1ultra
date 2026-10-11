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
  for (const name of ['campaign.leads', 'campaign.lead', 'campaign.pitch_kit']) {
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
  await reg.tools.get('campaign.pitch_kit').run({}, {});
  assert.deepEqual(calls[2], { route: '/api/tools/pitch-kit', method: 'GET', body: null, version: '' });
  assert.match(tools.brief(), /campaign\.lead/);
  assert.match(tools.brief(), /campaign\.pitch_kit/);
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

test('drafting tools pass the calling agent and use the right scopes', async () => {
  const calls = [];
  const tools = makeCampaignTools({ call: async req => { calls.push(req); return { ok: true }; }, isHalted: () => false });
  const reg = fakeRegistry(); tools.register(reg);
  assert.equal(reg.tools.get('campaign.check_draft').scope, 'read');
  assert.equal(reg.tools.get('campaign.save_draft').scope, 'write');
  assert.equal(reg.tools.get('campaign.propose_lead').scope, 'write');
  await reg.tools.get('campaign.save_draft').run({ lead_id: 'tn', body: 'Bonjour', agent_id: 'forged' }, { agentId: 'sales' });
  assert.deepEqual(calls[0], { route: '/api/tools/save-draft', method: 'POST', body: { lead_id: 'tn', body: 'Bonjour', agent_id: 'sales' }, version: '' });
  await reg.tools.get('campaign.propose_lead').run({ company: 'Company', country: 'TN', source_url: 'https://company.tn',
    observed_on: '2026-10-10', quote: 'Des services ERP.' }, {});
  assert.equal(calls[1].body.agent_id, 'unknown');
});

test('a proposal missing quote is refused before calling the worker', async () => {
  let called = false;
  const reg = fakeRegistry();
  makeCampaignTools({ call: async () => { called = true; return {}; }, isHalted: () => false }).register(reg);
  await assert.rejects(reg.tools.get('campaign.propose_lead').run({ company: 'Company', country: 'TN',
    source_url: 'https://company.tn', observed_on: '2026-10-10' }, {}), /Campaign tool error: invalid arguments: .*quote: required/);
  assert.equal(called, false);
});


test('drafting tools filter arguments, keep checks read-only, and never request consent', async () => {
  const calls = [];
  const reg = fakeRegistry();
  makeCampaignTools({ call: async req => { calls.push(req); return { status: 200, value: {} }; }, isHalted: () => false }).register(reg);
  const args = { lead_id: 'tn', subject: 'ERP', body: 'Bonjour', language: 'en', agent_id: 'forged', route: '/api/leads' };
  await reg.tools.get('campaign.check_draft').run(args, { agentId: 'sales' });
  assert.deepEqual(calls[0], { route: '/api/tools/check-draft', method: 'POST', body: { lead_id: 'tn', subject: 'ERP', body: 'Bonjour' }, version: '' });
  await reg.tools.get('campaign.save_draft').run(args, { agentId: 'sales' });
  assert.deepEqual(calls[1].body, { lead_id: 'tn', subject: 'ERP', body: 'Bonjour', language: 'en', agent_id: 'sales' });
  const proposal = { company: 'Company', country: 'TN', location: 'Tunis', industry: 'ERP', website: 'https://company.tn',
    source_url: 'https://company.tn/about', observed_on: '2026-10-10', quote: 'Des services ERP.', agent_id: 'forged', status: 'accepted' };
  await reg.tools.get('campaign.propose_lead').run(proposal, { agentId: 'research' });
  assert.deepEqual(calls[2], { route: '/api/tools/propose-lead', method: 'POST', body: { company: 'Company', country: 'TN',
    location: 'Tunis', industry: 'ERP', website: 'https://company.tn', source_url: 'https://company.tn/about',
    observed_on: '2026-10-10', quote: 'Des services ERP.', agent_id: 'research' }, version: '' });
  for (const name of ['campaign.check_draft', 'campaign.save_draft', 'campaign.propose_lead']) {
    assert.equal(reg.tools.get(name).capability, 'campaign');
    assert.equal(reg.tools.get(name).requiresConsent, false);
  }
});

test('drafting tools reject invalid arguments and worker refusals', async () => {
  let calls = 0;
  const reg = fakeRegistry();
  makeCampaignTools({ call: async () => { calls++; return { status: 400, value: { error: 'Unknown or out-of-scope company.' } }; }, isHalted: () => false }).register(reg);
  for (const [name, args] of [
    ['campaign.check_draft', {}], ['campaign.check_draft', { lead_id: 4, body: 'Bonjour' }],
    ['campaign.save_draft', { lead_id: 'tn', body: 3 }], ['campaign.save_draft', { lead_id: 'tn', body: '' }],
    ['campaign.save_draft', { lead_id: 'tn', body: 'Bonjour', language: 'ar' }],
    ['campaign.propose_lead', { company: 3 }], ['campaign.propose_lead', { company: 'Company', country: 3 }],
  ]) await assert.rejects(reg.tools.get(name).run(args, {}), /Campaign tool error: invalid arguments/);
  assert.equal(calls, 0);
  for (const name of ['campaign.check_draft', 'campaign.save_draft', 'campaign.propose_lead']) {
    const args = name === 'campaign.propose_lead' ? { company: 'Company', country: 'TN', source_url: 'https://company.tn',
      observed_on: '2026-10-10', quote: 'Des services ERP.' } : { lead_id: 'tn', body: 'Bonjour' };
    await assert.rejects(reg.tools.get(name).run(args, {}), /Campaign tool error: Unknown or out-of-scope company\./);
  }
  assert.equal(calls, 3);
});
