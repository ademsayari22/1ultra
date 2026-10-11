'use strict';
const assert = require('node:assert/strict'), test = require('node:test');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const H = require('../station/ultra-crew-health.js');
const { makeSupervisor } = require('../station/ultra-crew-supervisor.js');
const { makeOrchestrationTools } = require('../station/sidecar/tools/builtin/orchestration.js');
const { parseVerdict } = require('../station/sidecar/routing/verdict.js');
const { makeCrew } = require('../station/ultra-crew.js');
const { makeRunStore } = require('../station/sidecar/runstore.js');
const { makeSubagentManager } = require('../station/sidecar/subagents.js');
const policy = require('../station/ultra-policy.js');
const seed = require('../station/ultra-seed.js');

const TIERS = { models: { 'p/smart': { canonicalId: 'smart', tier: 'smart', tools: true }, 'p/mid': { canonicalId: 'mid', tier: 'standard', tools: true }, 'p/fast': { canonicalId: 'fast', tier: 'fast', tools: true } } };
const IDS = ['research', 'delivery', 'sales', 'qa'];
const PROFILES = Object.fromEntries(IDS.map(id => [id, H.normalizeProfile(H.DEFAULT_PROFILES[id])]));
const IDENT = Object.fromEntries(IDS.map(id => [id, { provider: 'custom', model: H.ROUTING[PROFILES[id].minTier], system: id }]));

const isCrewProvider = provider => policy.providerSwitch(provider) === 'crew.freellmapi';

function harness({ ready = () => true, on = ['crew.freellmapi', 'crew.escalate_to_lead', 'lead.codex'], halted = () => false, now = () => 1000 } = {}) {
  const receipts = new Map(), state = { value: H.emptyState() }, calls = [];
  const sup = makeSupervisor({
    profileFor: id => PROFILES[id] || null, memberIds: () => IDS, isCrewProvider,
    readiness: async profile => (ready(profile) ? { ready: true, reason: '' } : { ready: false, reason: 'no ready ' + profile.minTier + ' model' }),
    receiptsFor: id => receipts.get(id) || [], tiers: () => TIERS,
    switches: { isOn: id => on.includes(id) }, isHalted: halted,
    store: { load: () => JSON.parse(JSON.stringify(state.value)), save: s => { state.value = s; } },
    parseVerdict, now });
  // Each scripted reply { via, reason, text } becomes one worker row whose run FreeLLMAPI routed via `via`.
  const worker = script => async (job, o2) => {
    const reply = script[Math.min(calls.length, script.length - 1)];
    const runId = 'w' + calls.length;
    calls.push({ agentId: job.agentId, model: job.ident.model, runId: o2 && o2.runId, wallMs: o2 && o2.wallMs, ultraNeeds: job.ultraNeeds });
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

test('a reassigned QA subtask still requires a verdict from Research', async () => {
  for (const verdict of [false, true]) {
    for (const escalate of [false, true]) {
      const t = harness(escalate ? {} : { on: ['crew.freellmapi', 'lead.codex'] });
      const row = await t.sup.supervise(t.job('qa'), {}, t.h([
        { via: 'p/smart', text: 'QA draft without verdict' },
        { via: 'p/smart', text: 'QA draft still without verdict' },
        { via: 'p/smart', text: 'Research draft' + (verdict ? '\nVERDICT: approved' : '') }
      ]));
      assert.deepEqual(t.calls.map(c => c.agentId), ['qa', 'qa', 'research']);
      assert.equal(row.reason, verdict ? 'done' : escalate ? 'escalated' : 'error');
      assert.deepEqual(t.calls[2].ultraNeeds, PROFILES.qa);
      if (!verdict) {
        assert.equal(row.crewMoves.at(-1).outcome, 'failed_check');
        assert.match(row.crewMoves.at(-1).detail, /no VERDICT/);
      }
    }
  }
});

test('acceptance combines the replacement profile with the original minimum tier and verdict', () => {
  const t = harness();
  t.receipts.set('mid', [{ status: 200, routedVia: 'p/mid' }]);
  t.receipts.set('smart', [{ status: 200, routedVia: 'p/smart' }]);
  const job = { ...t.job('delivery'), ultraNeeds: PROFILES.qa };
  const weak = { runId: 'mid', reason: 'done', result: 'checked\nVERDICT: approved' };
  assert.equal(t.sup.accept(job, weak), false);
  assert.equal(weak.crewOutcome.kind, 'downgraded');
  const unchecked = { runId: 'smart', reason: 'done', result: 'unchecked' };
  assert.equal(t.sup.accept(job, unchecked), false);
  assert.equal(unchecked.crewOutcome.kind, 'failed_check');
  assert.equal(t.sup.accept(job, { runId: 'smart', reason: 'done', result: 'checked\nVERDICT: approved' }), true);
  assert.equal(t.sup.accept({ ...t.job('qa'), ultraNeeds: PROFILES.delivery },
    { runId: 'smart', reason: 'done', result: 'unchecked' }), false, 'the replacement also keeps its own stricter verdict check');
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

test('a stop during the worker prevents success, moves and lead escalation', async () => {
  for (const reply of [{ reason: 'timeout' }, { via: 'p/smart' }, { via: 'p/fast' }]) {
    let stop = false;
    const t = harness({ halted: () => stop });
    const h = t.h([reply]), once = h.runWorkerOnce;
    h.crew.delete('qa'); // no covering candidate: without the stop check this would hand back to the lead
    h.runWorkerOnce = async (job, opts) => { const row = await once(job, opts); stop = true; return row; };
    const row = await t.sup.supervise(t.job(), {}, h);
    assert.equal(row.reason, 'error');
    assert.match(row.result, /FAILED.*emergency stop/);
    assert.equal(t.calls.length, 1);
    assert.deepEqual(row.crewMoves, []);
    assert.deepEqual(t.sup.movesFor('lead-run'), []);
    assert.equal(t.state.value.escalations, 0);
  }
});

test('a stop during candidate readiness prevents moves and lead escalation', async () => {
  let stop = false, checks = 0;
  const t = harness({ halted: () => stop, ready: () => {
    if (++checks === 2) stop = true;
    return checks === 1;
  } });
  const row = await t.sup.supervise(t.job(), {}, t.h([{ reason: 'timeout' }]));
  assert.equal(row.reason, 'error');
  assert.match(row.result, /FAILED.*emergency stop/);
  assert.equal(t.calls.length, 1);
  assert.deepEqual(row.crewMoves, []);
  assert.deepEqual(t.sup.movesFor('lead-run'), []);
  assert.equal(t.state.value.escalations, 0);
  assert.equal(checks, 2, 'no further candidate readiness calls after the stop');
});

test('a stop during member readiness prevents the first worker and any moves', async () => {
  let stop = false;
  const t = harness({ halted: () => stop, ready: () => { stop = true; return true; } });
  const row = await t.sup.supervise(t.job(), {}, t.h([{ via: 'p/smart' }]));
  assert.equal(row.reason, 'error');
  assert.match(row.result, /FAILED.*emergency stop/);
  assert.equal(t.calls.length, 0);
  assert.deepEqual(row.crewMoves, []);
  assert.equal(t.state.value.escalations, 0);
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

test('a crew member deliberately moved to another live identity provider runs once unsupervised', async () => {
  for (const provider of ['codex', 'openrouter']) {
    const t = harness();
    const job = Object.assign({}, t.job(), { ident: { provider, model: 'owner-selected-model' } });
    const row = await t.sup.supervise(job, { runId: 'first' }, t.h([{ via: 'p/fast' }]));
    assert.equal(t.calls.length, 1, provider);
    assert.equal(t.calls[0].model, 'owner-selected-model');
    assert.equal(row.crewMoves, undefined);
    assert.equal(row.crewOutcome, undefined);
    assert.equal(row.crewHeld, undefined);
    assert.deepEqual(t.state.value.members, {});
    const unchecked = { reason: 'done', result: 'owner-selected output', runId: 'no-receipt' };
    assert.equal(t.sup.accept(job, unchecked), true);
    assert.equal(unchecked.crewOutcome, undefined);
  }
});

test('reassignment skips a covering member deliberately moved off the crew provider', async () => {
  const t = harness();
  const h = t.h([{ reason: 'timeout' }]);
  h.crew.set('qa', Object.assign({}, IDENT.qa, { provider: 'codex', model: 'owner-selected-model' }));
  const row = await t.sup.supervise(t.job(), {}, h);
  assert.deepEqual(t.calls.map(c => c.agentId), ['research']);
  assert.equal(row.reason, 'escalated');
  assert.deepEqual(row.crewMoves.map(m => m.step), ['lead']);
});

test('the facade exposes the policy crew-provider predicate', () => {
  const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-provider-'));
  try {
    const crew = makeCrew({ fs, path, runtime: rt, switches: { isOn: () => false }, port: 3901, durable: () => {} });
    assert.equal(typeof crew.isCrewProvider, 'function');
    for (const provider of ['custom', 'codex', 'openrouter', '', undefined]) {
      assert.equal(crew.isCrewProvider(provider), isCrewProvider(provider));
    }
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

test('missing crew credentials never run the lead model and follow the unavailable ladder', async () => {
  for (const variant of ['escalate', 'fail', 'custom-lead']) {
    const t = harness(variant === 'fail' ? { on: ['crew.freellmapi', 'lead.codex'] } : {});
    const runs = [];
    let n = 0;
    const { dispatchTool } = makeOrchestrationTools({
      runOnce: async o => {
        runs.push(o.provider);
        t.receipts.set(o.runId, [{ status: 200, routedVia: 'p/smart' }]);
        return { reason: 'done', messages: [{ role: 'assistant', content: 'wrong provider\nVERDICT: approved' }], usd: 0, runId: o.runId };
      },
      roster: () => new Map(IDS.map(id => [id, IDENT[id]])), key: 'lead-key', model: 'lead-model',
      provider: variant === 'custom-lead' ? 'custom' : 'codex', newId: () => 'no-key-' + (++n),
      providerAuth: () => null, crewSupervisor: Object.assign({ isCrewProvider }, t.sup)
    });
    const out = await dispatchTool.run({ workers: [{ agentId: 'research', prompt: 'check this company' }] }, { agentId: 'agent', runId: 'lead-run', emit: () => {} });
    const row = JSON.parse(out.content)[0];
    assert.deepEqual(runs, [], variant + ': no model call without the crew credential');
    assert.equal(row.reason, variant === 'escalate' ? 'escalated' : 'error');
    assert.deepEqual(row.crewMoves.map(m => m.step), ['reassign', variant === 'escalate' ? 'lead' : 'fail']);
    assert.deepEqual(row.crewMoves.map(m => m.outcome), ['unavailable', 'unavailable']);
    assert.match(row.crewMoves[0].detail, /no FreeLLMAPI credential/);
    assert.match(row.result, /never falls back/);
  }
});

test('team.resume refuses a missing crew credential before any model call', async () => {
  const t = harness(), runs = [];
  const record = { id: 'background', leadId: 'agent', agentId: 'research', prompt: 'check this company' };
  let completed;
  const subagents = {
    get: () => record,
    resume: (id, runner) => {
      completed = runner({ record, runId: 'resumed', emit: () => {} });
      return { ok: true, record };
    }
  };
  const { resumeTool } = makeOrchestrationTools({
    runOnce: async o => { runs.push(o.provider); return { reason: 'done', messages: [{ role: 'assistant', content: 'wrong provider' }] }; },
    roster: () => new Map(IDS.map(id => [id, IDENT[id]])), key: 'lead-key', model: 'lead-model', provider: 'codex',
    providerAuth: () => null, crewSupervisor: Object.assign({ isCrewProvider }, t.sup), subagents
  });
  await resumeTool.run({ id: 'background' }, { agentId: 'agent', runId: 'new-lead' });
  const row = await completed;
  assert.deepEqual(runs, []);
  assert.deepEqual([row.status, row.reason], ['error', 'error']);
  assert.match(row.result, /no FreeLLMAPI credential/);
});

test('the real team.resume checks readiness and holds a QA reply without a verdict', async () => {
  for (const variant of ['unchecked', 'checked', 'not-ready', 'non-crew']) {
    const t = harness({ ready: () => variant !== 'not-ready' }), runs = [], authCalls = [];
    const record = { id: 'background', leadId: 'agent', agentId: 'qa', prompt: 'review this company' };
    let completed;
    const subagents = { get: () => record, resume: (id, runner) => {
      completed = runner({ record, runId: 'resumed', emit: () => {} });
      return { ok: true, record };
    } };
    const text = variant === 'checked' ? 'Review done\nVERDICT: approved' : 'Unchecked review ' + 'x'.repeat(2100);
    const { resumeTool } = makeOrchestrationTools({
      runOnce: async o => {
        runs.push(o.provider);
        t.receipts.set(o.runId, [{ status: 200, routedVia: 'p/smart' }]);
        return { reason: 'done', messages: [{ role: 'assistant', content: text }], usd: 0, runId: o.runId };
      },
      roster: () => new Map([['qa', { ...IDENT.qa, provider: variant === 'non-crew' ? 'openrouter' : 'custom' }]]),
      key: 'lead-key', model: 'lead-model', provider: 'codex', providerAuth: id => { authCalls.push(id); return { provider: id, key: 'fixture' }; },
      crewSupervisor: t.sup, subagents
    });
    await resumeTool.run({ id: 'background' }, { agentId: 'agent', runId: 'new-lead' });
    const row = await completed;
    if (variant === 'not-ready') {
      assert.deepEqual(runs, []);
      assert.deepEqual(authCalls, [], 'readiness is checked before resolving provider credentials');
      assert.equal(row.status, 'error');
      assert.match(row.result, /no ready smart model/);
    } else if (variant === 'unchecked') {
      assert.deepEqual([row.status, row.reason], ['error', 'error']);
      assert.match(row.result, /^FAILED — the resumed crew result did not pass its capability check \(failed_check: no VERDICT line\)\. Re-dispatch this subtask so the crew ladder can retry or reassign it\./);
      assert.equal(row.result.split('\n\nUnchecked crew draft (never checked work):\n')[1], text.slice(0, 2000));
    } else {
      assert.deepEqual([row.status, row.reason, row.result], ['done', 'done', text]);
      assert.deepEqual(runs, [variant === 'non-crew' ? 'openrouter' : 'custom']);
    }
  }
});

test('repaired output is classified against the repair run routing receipt', () => {
  const t = harness();
  t.receipts.set('original', [{ status: 200, routedVia: 'p/smart' }]);
  t.receipts.set('repair', [{ status: 200, routedVia: 'p/fast' }]);
  const row = { reason: 'done', result: 'repaired output', runId: 'original', repairRunId: 'repair' };
  assert.equal(t.sup.accept(t.job(), row), false);
  assert.equal(row.crewOutcome.kind, 'downgraded');
  assert.equal(row.crewOutcome.routedVia, 'p/fast');
  for (const repairRunId of ['', undefined, 42]) {
    assert.equal(t.sup.accept(t.job(), { reason: 'done', result: 'original output', runId: 'original', repairRunId }), true);
  }
});

test('background retry moves survive in durable completion after the parent run is recorded', { timeout: 2000 }, async () => {
  const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-background-'));
  try {
    const t = harness(), file = path.join(rt, 'subagents.json');
    let release, finish, completion, n = 0, attempts = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const settled = new Promise(resolve => { finish = resolve; });
    const manager = makeSubagentManager({ fs, pathMod: path, file, clock: { now: () => 1000 },
      emit: (name, payload) => { if (name === 'task' && payload.status !== 'running') finish(); } });
    const subagents = Object.assign({}, manager, {
      start: (meta, runner) => manager.start(meta, async h => { completion = await runner(h); return completion; })
    });
    const { dispatchTool } = makeOrchestrationTools({
      runOnce: async o => {
        attempts++;
        if (attempts === 1) await gate;
        t.receipts.set(o.runId, [{ status: 200, routedVia: attempts === 1 ? 'p/fast' : 'p/smart' }]);
        return { reason: 'done', messages: [{ role: 'assistant', content: 'answer ' + attempts }], usd: 0, runId: o.runId };
      },
      roster: () => new Map(IDS.map(id => [id, IDENT[id]])), key: 'lead-key', model: 'lead-model', provider: 'codex',
      newId: () => 'background-run-' + (++n), providerAuth: () => ({ provider: 'custom', key: 'crew-key' }),
      crewSupervisor: Object.assign({ isCrewProvider }, t.sup), subagents
    });
    const out = await dispatchTool.run({ background: true, workers: [{ agentId: 'delivery', prompt: 'build this proof pack' }] }, { agentId: 'agent', runId: 'lead-run', emit: () => {} });
    const id = JSON.parse(out.content)[0].id;
    const parent = makeRunStore({ io: { readAll: () => [], append: () => {} }, clock: { now: () => 1000 } });
    parent.record({ runId: 'lead-run', agentId: 'agent', ultraMoves: t.sup.movesFor('lead-run') });
    release();
    await settled;
    const durable = JSON.parse(fs.readFileSync(file, 'utf8')).records.find(r => r.id === id);
    assert.equal(durable.status, 'done');
    assert.match(durable.result, /answer 2\n\n\[1Ultra crew moves: .*retry/);
    assert.deepEqual(completion.crewMoves.map(m => m.step), ['retry']);
    assert.match(completion.note, /1Ultra crew moves/);
    assert.equal(parent.all()[0].ultraMoves, undefined, 'late moves do not rewrite the finished parent record');
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

test('retry and reassignment share one dispatch wall clock', async () => {
  for (const firstReason of ['done', 'timeout']) {
    let clock = 1000;
    const t = harness({ now: () => clock });
    const h = t.h([{ reason: firstReason, via: 'p/fast' }, { via: 'p/smart', text: 'checked\nVERDICT: approved' }]);
    const once = h.runWorkerOnce;
    h.runWorkerOnce = async (job, opts) => {
      const row = await once(job, opts);
      if (t.calls.length === 1) clock += 400000;
      return row;
    };
    const row = await t.sup.supervise(t.job(), { wallMs: 600000 }, h);
    assert.equal(row.reason, 'done');
    assert.deepEqual(t.calls.map(c => c.wallMs), [600000, 200000]);
    assert.deepEqual(row.crewMoves.map(m => m.step), [firstReason === 'done' ? 'retry' : 'reassign']);
  }
});

test('an exhausted dispatch wall clock stops the ladder before another worker call', async () => {
  let clock = 1000;
  const t = harness({ now: () => clock, on: ['crew.freellmapi', 'lead.codex'] });
  const h = t.h([{ via: 'p/fast' }]);
  const once = h.runWorkerOnce;
  h.runWorkerOnce = async (job, opts) => { const row = await once(job, opts); clock += 600000; return row; };
  const row = await t.sup.supervise(t.job(), { wallMs: 600000 }, h);
  assert.equal(t.calls.length, 1);
  assert.equal(row.reason, 'error');
  assert.match(row.result, /FAILED.*dispatch wall clock.*ran out/);
});

test('a ready benched covering member is unbenched before reassignment', async () => {
  const t = harness();
  for (let i = 0; i < 3; i++) t.state.value = H.recordOutcome(t.state.value, 'qa', 'unavailable', 1000);
  assert.equal(t.state.value.members.qa.benched, true);
  const h = t.h([{ reason: 'timeout' }, { via: 'p/smart', text: 'recovered\nVERDICT: approved' }]);
  const once = h.runWorkerOnce;
  h.runWorkerOnce = async (job, opts) => {
    if (job.agentId === 'qa') assert.equal(t.state.value.members.qa.benched, false, 'cleared before the worker runs');
    return once(job, opts);
  };
  const row = await t.sup.supervise(t.job(), {}, h);
  assert.deepEqual(t.calls.map(c => c.agentId), ['research', 'qa']);
  assert.equal(row.reason, 'done');
  assert.deepEqual(row.crewMoves.map(m => m.step), ['reassign']);
  assert.equal(t.state.value.members.qa.benched, false);
});

test('deadline expiry after an attempt hands back to the lead despite a covering candidate', async () => {
  for (const reason of ['done', 'timeout']) {
    let clock = 1000;
    const t = harness({ now: () => clock });
    const h = t.h([{ reason, via: 'p/fast', text: 'unchecked draft' }]);
    const once = h.runWorkerOnce;
    h.runWorkerOnce = async (job, opts) => { const row = await once(job, opts); clock += 600000; return row; };
    const row = await t.sup.supervise(t.job(), { wallMs: 600000 }, h);
    assert.equal(t.calls.length, 1);
    assert.equal(row.reason, 'escalated');
    assert.deepEqual(row.crewMoves, [{ step: 'lead', from: 'research', to: 'agent',
      outcome: reason === 'done' ? 'downgraded' : 'unavailable', detail: 'the dispatch wall clock for this subtask ran out' }]);
    assert.deepEqual(t.sup.movesFor('lead-run'), row.crewMoves);
    assert.equal(t.state.value.escalations, 1);
    assert.match(row.result, /ESCALATED TO YOU/);
    assert.match(row.result, /find two Tunisian logistics companies/);
    if (reason === 'done') assert.match(row.result, /Unchecked crew draft.*\nunchecked draft/);
  }
});

test('deadline expiry after an attempt fails without planning another crew move when escalation is off', async () => {
  let clock = 1000;
  const t = harness({ now: () => clock, on: ['crew.freellmapi', 'lead.codex'] });
  const h = t.h([{ via: 'p/fast' }]);
  const once = h.runWorkerOnce;
  h.runWorkerOnce = async (job, opts) => { const row = await once(job, opts); clock += 600000; return row; };
  const row = await t.sup.supervise(t.job(), { wallMs: 600000 }, h);
  assert.equal(t.calls.length, 1);
  assert.equal(row.reason, 'error');
  assert.match(row.result, /FAILED.*dispatch wall clock.*ran out/);
  assert.deepEqual(row.crewMoves, []);
  assert.deepEqual(t.sup.movesFor('lead-run'), []);
  assert.equal(t.state.value.escalations, 0);
});

test('deadline expiry during candidates keeps the wall-clock reason on the lead hand-back', async () => {
  let clock = 1000, checks = 0;
  const t = harness({ now: () => clock, ready: () => {
    checks++;
    if (checks === 2) clock += 600001;
    return checks === 1;
  } });
  const row = await t.sup.supervise(t.job(), { wallMs: 600000 }, t.h([{ reason: 'timeout' }]));
  assert.equal(t.calls.length, 1);
  assert.ok(checks > 1, 'candidate readiness consumed the remaining time');
  assert.equal(row.reason, 'escalated');
  assert.deepEqual(row.crewMoves, [{ step: 'lead', from: 'research', to: 'agent', outcome: 'unavailable',
    detail: 'the dispatch wall clock for this subtask ran out' }]);
  assert.deepEqual(t.sup.movesFor('lead-run'), row.crewMoves);
  assert.match(row.result, /dispatch wall clock.*ran out/);
  assert.equal(t.state.value.escalations, 1);
});
