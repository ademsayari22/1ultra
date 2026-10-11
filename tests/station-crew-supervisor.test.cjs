'use strict';
const assert = require('node:assert/strict'), test = require('node:test');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const H = require('../station/ultra-crew-health.js');
const { makeSupervisor } = require('../station/ultra-crew-supervisor.js');
const { makeOrchestrationTools } = require('../station/sidecar/tools/builtin/orchestration.js');
const { parseVerdict } = require('../station/sidecar/routing/verdict.js');
const { makeCrew } = require('../station/ultra-crew.js');
const { makeRunStore } = require('../station/sidecar/runstore.js');
const seed = require('../station/ultra-seed.js');

const TIERS = { models: { 'p/smart': { canonicalId: 'smart', tier: 'smart', tools: true }, 'p/fast': { canonicalId: 'fast', tier: 'fast', tools: true } } };
const IDS = ['research', 'delivery', 'sales', 'qa'];
const PROFILES = Object.fromEntries(IDS.map(id => [id, H.normalizeProfile(H.DEFAULT_PROFILES[id])]));
const IDENT = Object.fromEntries(IDS.map(id => [id, { provider: 'custom', model: H.ROUTING[PROFILES[id].minTier], system: id }]));

function harness({ ready = () => true, on = ['crew.freellmapi', 'crew.escalate_to_lead', 'lead.codex'], halted = () => false } = {}) {
  const receipts = new Map(), state = { value: H.emptyState() }, calls = [];
  const sup = makeSupervisor({
    profileFor: id => PROFILES[id] || null, memberIds: () => IDS,
    readiness: async profile => (ready(profile) ? { ready: true, reason: '' } : { ready: false, reason: 'no ready ' + profile.minTier + ' model' }),
    receiptsFor: id => receipts.get(id) || [], tiers: () => TIERS,
    switches: { isOn: id => on.includes(id) }, isHalted: halted,
    store: { load: () => JSON.parse(JSON.stringify(state.value)), save: s => { state.value = s; } },
    parseVerdict, now: () => 1000 });
  // Each scripted reply { via, reason, text } becomes one worker row whose run FreeLLMAPI routed via `via`.
  const worker = script => async (job, o2) => {
    const reply = script[Math.min(calls.length, script.length - 1)];
    const runId = 'w' + calls.length;
    calls.push({ agentId: job.agentId, model: job.ident.model, runId: o2 && o2.runId });
    receipts.set(runId, reply.via ? [{ status: 200, routedVia: reply.via }] : []);
    const row = { agentId: job.agentId, reason: reply.reason || 'done', result: reply.text || 'result ' + calls.length, usd: 0, runId };
    if (row.reason === 'done' && !sup.accept(job, row)) row.crewHeld = true;
    return row;
  };
  const h = script => ({ runWorkerOnce: worker(script), crew: new Map(IDS.map(id => [id, IDENT[id]])), leadId: 'agent', leadProvider: 'codex', parentRunId: 'lead-run' });
  const job = (agentId = 'research') => ({ agentId, prompt: 'find two Tunisian logistics companies', ident: IDENT[agentId] });
  return { sup, calls, h, job, state, receipts };
}

test('a job for a non-crew agent runs once, untouched', async () => {
  const t = harness();
  const row = await t.sup.supervise({ agentId: 'scout', prompt: 'x', ident: {} }, {}, t.h([{ via: 'p/fast' }]));
  assert.equal(t.calls.length, 1);
  assert.equal(row.crewMoves, undefined);
});

test('a checked result is returned with no moves and recorded as ok', async () => {
  const t = harness();
  const row = await t.sup.supervise(t.job(), { runId: 'first' }, t.h([{ via: 'p/smart' }]));
  assert.deepEqual([t.calls.length, t.calls[0].runId, row.reason, row.crewMoves], [1, 'first', 'done', undefined]);
  assert.deepEqual(t.state.value.members.research.recent.map(r => r.kind), ['ok']);
});

test('a downgraded result is retried once on auto:smart, with a fresh run id', async () => {
  const t = harness();
  const row = await t.sup.supervise(t.job('delivery'), { runId: 'first' }, t.h([{ via: 'p/fast' }, { via: 'p/smart', text: 'good' }]));
  assert.deepEqual(t.calls.map(c => [c.agentId, c.model]), [['delivery', 'auto:balanced'], ['delivery', 'auto:smart']]);
  assert.equal(t.calls[1].runId, undefined);
  assert.deepEqual([row.result, row.crewHeld, row.crewMoves.map(m => m.step)], ['good', undefined, ['retry']]);
  assert.deepEqual(t.sup.movesFor('lead-run').map(m => [m.step, m.outcome]), [['retry', 'downgraded']]);
});

test('an unavailable member is not retried; the subtask moves to a member who covers it', async () => {
  const t = harness();
  const row = await t.sup.supervise(t.job(), {}, t.h([{ reason: 'timeout' }, { via: 'p/smart', text: 'from qa\nVERDICT: approved' }]));
  assert.deepEqual(t.calls.map(c => c.agentId), ['research', 'qa']);
  assert.deepEqual([row.agentId, row.result, row.crewMoves.map(m => [m.step, m.to])], ['qa', 'from qa\nVERDICT: approved', [['reassign', 'qa']]]);
});

test('retry, reassign, then the subtask goes back to the lead with the unchecked draft', async () => {
  const t = harness();
  const row = await t.sup.supervise(t.job(), {}, t.h([{ via: 'p/fast', text: 'weak draft' }]));
  assert.deepEqual(t.calls.map(c => c.agentId), ['research', 'research', 'qa']);
  assert.equal(row.reason, 'escalated');
  assert.match(row.result, /find two Tunisian logistics companies/);
  assert.match(row.result, /weak draft/);
  assert.deepEqual(row.crewMoves.map(m => m.step), ['retry', 'reassign', 'lead']);
  assert.equal(t.state.value.escalations, 1);
});

test('without crew.escalate_to_lead, or with the lead off Codex, the subtask fails with its full trail', async () => {
  for (const variant of ['switch', 'provider']) {
    const t = harness(variant === 'switch' ? { on: ['crew.freellmapi', 'lead.codex'] } : {});
    const h = t.h([{ via: 'p/fast' }]);
    if (variant === 'provider') h.leadProvider = 'custom';
    const row = await t.sup.supervise(t.job(), {}, h);
    assert.equal(row.reason, 'error', variant);
    assert.match(row.result, /FAILED/);
    assert.deepEqual(row.crewMoves.map(m => m.step), ['retry', 'reassign', 'fail'], variant);
  }
});

test('a subtask moves at most three times', async () => {
  const t = harness({ on: ['crew.freellmapi', 'lead.codex'] });
  const row = await t.sup.supervise(t.job('sales'), {}, t.h([{ via: 'p/fast' }]));
  assert.deepEqual(t.calls.map(c => c.agentId), ['sales', 'sales', 'research', 'qa']);
  assert.equal(row.crewMoves.length, 3);
  assert.match(row.result, /within 3 moves/);
});

test('the emergency stop ends a ladder: nothing more runs', async () => {
  let stop = false;
  const t = harness({ halted: () => stop });
  const h = t.h([{ via: 'p/fast' }]);
  const once = h.runWorkerOnce;
  h.runWorkerOnce = async (job, o2) => { const row = await once(job, o2); stop = true; return row; };
  const row = await t.sup.supervise(t.job(), {}, h);
  assert.equal(t.calls.length, 1);
  assert.equal(row.reason, 'error');
  assert.match(row.result, /emergency stop/i);
});

test("a member that is not ready never runs, and nothing runs on the lead's model", async () => {
  const qaOnly = harness({ ready: p => p.requiresVerdict });
  const row = await qaOnly.sup.supervise(qaOnly.job(), {}, qaOnly.h([{ via: 'p/smart', text: 'qa did it\nVERDICT: approved' }]));
  assert.deepEqual([qaOnly.calls.map(c => c.agentId), row.result], [['qa'], 'qa did it\nVERDICT: approved']);
  const down = harness({ ready: () => false });
  const handed = await down.sup.supervise(down.job(), {}, down.h([{ via: 'p/smart' }]));
  assert.equal(down.calls.length, 0, 'FreeLLMAPI down: no worker run at all');
  assert.equal(handed.reason, 'escalated');
  assert.match(handed.crewMoves[0].detail, /no ready smart model/);
});

test('a benched member waits until its tier is ready again', async () => {
  let ready = false;
  const t = harness({ ready: () => ready, on: ['crew.freellmapi'] });
  for (let i = 0; i < 3; i++) t.state.value = H.recordOutcome(t.state.value, 'research', 'unavailable', 1000);
  assert.equal(t.state.value.members.research.benched, true);
  const waiting = await t.sup.supervise(t.job(), {}, t.h([{ via: 'p/smart' }]));
  assert.equal(t.calls.length, 0);
  assert.match(waiting.crewMoves[0].detail, /benched/);
  ready = true;
  const back = await t.sup.supervise(t.job(), {}, t.h([{ via: 'p/smart', text: 'back' }]));
  assert.deepEqual([back.result, t.state.value.members.research.benched], ['back', false]);
});

test('accept holds a failed crew row and passes everything else', () => {
  const t = harness();
  t.receipts.set('r', [{ status: 200, routedVia: 'p/fast' }]);
  const held = { agentId: 'research', reason: 'done', result: 'x', runId: 'r' };
  assert.equal(t.sup.accept(t.job(), held), false);
  assert.equal(held.crewOutcome.kind, 'downgraded');
  t.receipts.set('s', [{ status: 200, routedVia: 'p/smart' }]);
  assert.equal(t.sup.accept(t.job(), { agentId: 'research', reason: 'done', result: 'x', runId: 's' }), true);
  assert.equal(t.sup.accept({ agentId: 'scout' }, { reason: 'done', result: 'x' }), true);
});

test('team.dispatch runs crew subtasks through the supervisor and returns only the checked result', async () => {
  const t = harness(), runs = [];
  let n = 0;
  const runOnce = async o => {
    runs.push([o.agentId, o.provider, o.model]);
    t.receipts.set(o.runId, [{ status: 200, routedVia: runs.length === 1 ? 'p/fast' : 'p/smart' }]);
    return { reason: 'done', messages: [{ role: 'assistant', content: 'answer ' + runs.length }], usd: 0, runId: o.runId };
  };
  const { dispatchTool } = makeOrchestrationTools({ runOnce, roster: () => new Map(IDS.map(id => [id, IDENT[id]])), key: 'k', model: 'gpt-6.1-sol', provider: 'codex',
    newId: () => 'run' + (++n), providerAuth: id => (id === 'custom' ? { provider: 'custom', key: 'freellmapi-x', baseUrl: 'http://127.0.0.1:3901/v1' } : null), crewSupervisor: t.sup });
  const out = await dispatchTool.run({ workers: [{ agentId: 'delivery', prompt: 'build a proof pack' }] }, { agentId: 'agent', emit: () => {}, runId: 'lead-run' });
  const rows = JSON.parse(out.content);
  assert.deepEqual(runs, [['delivery', 'custom', 'auto:balanced'], ['delivery', 'custom', 'auto:smart']]);
  assert.deepEqual([rows[0].result, rows[0].crewMoves.map(m => m.step)], ['answer 2', ['retry']]);
  assert.deepEqual(t.sup.movesFor('lead-run').map(m => m.step), ['retry']);
});

test('readiness says why a crew member cannot take work, and team.health reports it read-only', async () => {
  const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-ready-'));
  try {
    const durable = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
    for (const [name, value] of Object.entries(seed.files(1000))) durable(path.join(rt, name), value);
    let on = false, clock = 1000, reply = () => ({ status: 200, ok: true, json: async () => ({ data: [{ id: 'smart', execution_status: 'ready' }] }) });
    const crew = makeCrew({ fs, path, runtime: rt, switches: { isOn: id => on && id === 'crew.freellmapi' }, port: 3901, durable, now: () => clock,
      fetchFn: async () => { const r = reply(); if (r instanceof Error) throw r; return r; } });
    crew.seedRoster();
    const reason = async () => { clock += 60000; return (await crew.status()).members.find(m => m.agentId === 'research').reason; };
    assert.equal(await reason(), 'crew.freellmapi is off');
    on = true;
    assert.match(await reason(), /key not loaded \(not_configured\)/);
    fs.mkdirSync(path.join(rt, '.secrets'));
    durable(path.join(rt, '.secrets', 'freellmapi.json'), { baseUrl: 'http://127.0.0.1:3901/v1', key: 'freellmapi-' + 'ab'.repeat(24) });
    assert.match(await reason(), /model tiers not seeded/);
    durable(path.join(rt, 'model-tiers.json'), TIERS);
    assert.equal(await reason(), '');
    reply = () => ({ status: 401, ok: false, json: async () => ({}) });
    assert.match(await reason(), /rejected the key/);
    reply = () => new Error('connect ECONNREFUSED');
    assert.match(await reason(), /unreachable/);
    reply = () => ({ status: 200, ok: true, json: async () => ({ data: [{ id: 'fast', execution_status: 'ready' }] }) });
    assert.equal(await reason(), 'no ready smart model with tools');
    const registered = [];
    crew.registerTools({ register: def => registered.push(def) });
    assert.deepEqual([registered[0].name, registered[0].capability, registered[0].scope, registered[0].requiresConsent], ['team.health', 'orchestrator', 'read', false]);
    const health = JSON.parse((await registered[0].run({}, {})).content);
    assert.deepEqual(health.members.map(m => m.agentId), IDS);
    assert.equal(JSON.stringify(health).includes('freellmapi-ab'), false, 'team.health never shows the key');
    assert.match(crew.leadBrief(), /team\.health/);
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

test('the run store keeps the sanitized crew moves on the lead run', () => {
  const store = makeRunStore({ io: { readAll: () => [], append: () => {} }, clock: { now: () => 1 } });
  store.record({ runId: 'lead', agentId: 'agent', ultraMoves: [{ step: 'retry', from: 'delivery', to: 'delivery', outcome: 'downgraded', detail: 'p/fast is fast', extra: 'drop' }] });
  assert.deepEqual(store.all()[0].ultraMoves, [{ step: 'retry', from: 'delivery', to: 'delivery', outcome: 'downgraded', detail: 'p/fast is fast' }]);
});
