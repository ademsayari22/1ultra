'use strict';
const assert = require('node:assert/strict'), test = require('node:test');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { makeReceipts } = require('../station/ultra-crew-receipts.js');
const { makeCrew } = require('../station/ultra-crew.js');
const { makeRunStore } = require('../station/sidecar/runstore.js');
const vm = require('node:vm');
const response = (status, headers = {}) => ({ status, headers: { get: name => headers[name.toLowerCase()] || null } });

test('only chat completions are recorded, with the routing headers FreeLLMAPI returned', async () => {
  const r = makeReceipts({ now: () => 7 });
  const upstream = async url => url.endsWith('/models') ? response(200) : response(200, { 'x-routed-via': 'groq/llama-3.3-70b', 'x-fallback-attempts': '1', 'x-fallback-trail': 'ovh/x key1=rate_limited' });
  const f = r.observe(upstream, 'run-1');
  await f('http://127.0.0.1:3901/v1/models');
  await f('http://127.0.0.1:3901/v1/chat/completions', { method: 'POST' });
  assert.deepEqual(r.get('run-1'), [{ at: 7, status: 200, routedVia: 'groq/llama-3.3-70b', fallbackAttempts: 1, fallbackTrail: 'ovh/x key1=rate_limited' }]);
  const copy = r.get('run-1'); copy[0].status = 0;
  assert.equal(r.get('run-1')[0].status, 200, 'get returns copies');
  assert.deepEqual(r.get('other'), []);
});

test('a failed connection is recorded and still thrown; a run keeps at most 20 receipts', async () => {
  const r = makeReceipts({ now: () => 1 });
  const refused = r.observe(async () => { throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }); }, 'run-2');
  await assert.rejects(refused('http://127.0.0.1:3901/v1/chat/completions'), /refused/);
  assert.deepEqual(r.get('run-2'), [{ at: 1, status: 0, routedVia: '', fallbackAttempts: 0, fallbackTrail: '', error: 'ECONNREFUSED' }]);
  const busy = r.observe(async () => response(429), 'run-3');
  for (let i = 0; i < 25; i++) await busy('http://127.0.0.1:3901/v1/chat/completions');
  assert.equal(r.get('run-3').length, 20);
});

test('a run keeps its newest 20 receipts, including a success after 20 failures', async () => {
  let at = 0, requests = 0;
  const r = makeReceipts({ now: () => ++at });
  const f = r.observe(async () => ++requests <= 20 ? response(429) : response(200, { 'x-routed-via': 'ovh/m' }), 'run-8');
  for (let i = 0; i < 21; i++) await f('http://127.0.0.1:3901/v1/chat/completions');
  const rows = r.get('run-8');
  assert.equal(rows.length, 20);
  assert.deepEqual(rows[rows.length - 1], { at: 21, status: 200, routedVia: 'ovh/m', fallbackAttempts: 0, fallbackTrail: '' });
  assert.equal(rows[0].at, 2, 'the oldest receipt is dropped');
});

test('adapterOptions wraps fetch only for crew providers with a run id', async () => {
  const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-receipts-'));
  try {
    fs.mkdirSync(path.join(rt, '.secrets'));
    fs.writeFileSync(path.join(rt, '.secrets', 'freellmapi.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3901/v1', key: 'freellmapi-' + 'ab'.repeat(24) }));
    const crew = makeCrew({ fs, path, runtime: rt, switches: { isOn: () => false }, port: 3901, durable: () => {}, now: () => 3 });
    const upstream = async () => response(200, { 'x-routed-via': 'ovh/m' });
    const wrapped = crew.adapterOptions({ provider: 'custom', fetch: upstream, ultraRunId: 'run-4' });
    await wrapped.fetch('http://127.0.0.1:3901/v1/chat/completions');
    assert.equal(crew.receiptsFor('run-4')[0].routedVia, 'ovh/m');
    const codex = { provider: 'codex', fetch: upstream, ultraRunId: 'run-5' };
    assert.equal(crew.adapterOptions(codex), codex);
    assert.equal(crew.adapterOptions({ provider: 'custom', fetch: upstream }).fetch, upstream, 'no run id, nothing to attribute');
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

test('the run store keeps a sanitized routing receipt', () => {
  const appended = [];
  const store = makeRunStore({ io: { readAll: () => [], append: e => appended.push(e) }, clock: { now: () => 1 } });
  store.record({ runId: 'run-6', agentId: 'sales', ultraRouting: [{ status: 200, routedVia: 'ovh/m', fallbackAttempts: 1, fallbackTrail: 'groq/x key1=timeout', secret: 'drop me' }] });
  store.record({ runId: 'run-7', agentId: 'agent' });
  const rows = store.all();
  assert.deepEqual(rows.find(r => r.runId === 'run-6').ultraRouting, [{ status: 200, routedVia: 'ovh/m', fallbackAttempts: 1, fallbackTrail: 'groq/x key1=timeout' }]);
  assert.equal('ultraRouting' in rows.find(r => r.runId === 'run-7'), false, 'other runs keep their shape');
});

test('run details render the answered model, fallback title and ordinary tool duration', () => {
  const source = fs.readFileSync(path.join(__dirname, '../station/frontend/app/chat.js'), 'utf8');
  const telemetry = source.indexOf('  function telemetryRun(');
  const helper = source.indexOf('  function telemetryCrewRouting(');
  const snippet = source.slice(helper < 0 ? telemetry : helper, source.indexOf('\n  }', telemetry) + 4);
  const context = vm.createContext({
    document: { createElement: () => ({ children: [], appendChild(child) { this.children.push(child); } }) },
    runCallCount: entry => (entry.toolTrace || []).length, fmtMs: ms => ms + 'ms'
  });
  vm.runInContext(snippet, context);
  const wrap = vm.runInContext(`telemetryRun({agentId:'qa', ultraRouting:[
    {routedVia:'p/smart',fallbackTrail:'p/fast failed'}, {routedVia:'p/smart'}, {routedVia:'p/other'}
  ],toolTrace:[{name:'web.search',ms:42}]}, 'worker')`, context);
  assert.equal(wrap.children[1].className, 'rt-tool');
  assert.equal(wrap.children[1].textContent, '⤳ answered by p/smart, p/other');
  assert.equal(wrap.children[1].title, 'FreeLLMAPI fallbacks: p/fast failed');
  assert.match(wrap.children[2].textContent, /web.search · 42ms · ok/);
  const failed = vm.runInContext("telemetryRun({ultraRouting:[{status:429}]}, 'worker')", context);
  assert.equal(failed.children[1].textContent, '⤳ answered by no model (every request failed)');
  const ordinary = vm.runInContext("telemetryRun({toolTrace:[{name:'fs.read',ms:3}]}, 'lead')", context);
  assert.equal(ordinary.children.length, 2);
});
