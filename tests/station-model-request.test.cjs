'use strict';
// Every model request re-checks the owner's emergency stop and provider switch, not only when an adapter is built.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Policy = require('../station/ultra-policy.js');

test('a guarded adapter checks before every stream call and leaves everything else untouched', async () => {
  let calls = 0, allow = true, closed = 0;
  const listModels = async () => ['m'];
  const fake = {
    name: 'fake', listModels,
    async *stream(req) { calls++; try { yield { type: 'text', req }; yield { type: 'done' }; } finally { closed++; } }
  };
  const check = () => { if (!allow) throw Object.assign(new Error('Emergency stop is on.'), { code: 'ULTRA_EMERGENCY_STOP' }); };
  const guarded = Policy.guardAdapter(fake, check);
  assert.equal(guarded.name, 'fake');
  assert.equal(guarded.listModels, listModels);
  const seen = [];
  for await (const ev of guarded.stream('first')) seen.push(ev.type);
  assert.deepEqual(seen, ['text', 'done']);
  for await (const ev of guarded.stream('early')) { assert.equal(ev.type, 'text'); break; }
  assert.equal(closed, 2, 'breaking out of a guarded stream still closes the adapter stream');
  allow = false;
  await assert.rejects(async () => { for await (const ev of guarded.stream('second')) void ev; }, { code: 'ULTRA_EMERGENCY_STOP' });
  assert.equal(calls, 2, 'the adapter is never called once the check fails');
  assert.equal(Policy.guardAdapter(null, check), null);
});

test('a gated fetch checks before every request and ties each request to the station stop', async () => {
  let allow = true; const seen = [];
  const check = () => { if (!allow) throw Object.assign(new Error('Lead agent on Codex is off.'), { code: 'ULTRA_PROVIDER_OFF' }); };
  let stop = new AbortController();
  const fakeFetch = async (url, init) => { seen.push({ url, signal: init && init.signal }); return { ok: true }; };
  const gated = Policy.gateFetch(fakeFetch, check, () => stop.signal);
  await gated('https://x.test/a', { method: 'POST' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].signal.aborted, false);
  stop.abort(Object.assign(new Error('Emergency stop is on.'), { code: 'ULTRA_EMERGENCY_STOP' }));
  assert.equal(seen[0].signal.aborted, true, 'the stop aborts a request already in flight');
  const own = new AbortController(); stop = new AbortController();
  await gated('https://x.test/b', { signal: own.signal });
  own.abort();
  assert.equal(seen[1].signal.aborted, true, "the caller's own signal still aborts the request");
  allow = false;
  await assert.rejects(gated('https://x.test/c'), { code: 'ULTRA_PROVIDER_OFF' });
  assert.equal(seen.length, 2, 'a refused request never reaches fetch');
});

test('without AbortSignal.any a gated request fails closed instead of dropping the stop', async () => {
  const saved = AbortSignal.any; let called = 0;
  const gated = Policy.gateFetch(async () => { called++; return { ok: true }; }, () => {}, () => new AbortController().signal);
  try {
    AbortSignal.any = undefined;
    await assert.rejects(gated('https://x.test/', { signal: new AbortController().signal }), { code: 'ULTRA_NODE_TOO_OLD' });
    assert.equal(called, 0);
  } finally { AbortSignal.any = saved; }
});

test('the station refuses to start on a Node.js without AbortSignal.any', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-node-root-'));
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-node-runtime-'));
  const hostPath = path.resolve(__dirname, '../station/ultra-host.js');
  try {
    const stderrPath = path.join(root, 'stderr.txt'), stderr = fs.openSync(stderrPath, 'w');
    let child;
    try {
      child = spawnSync(process.execPath, ['-e', 'AbortSignal.any = undefined; require(process.argv[1]);', hostPath], {
        env: { ...process.env, ULTRA_ROOT: root, ULTRA_RUNTIME: runtime }, stdio: ['ignore', 'ignore', stderr], timeout: 15000
      });
    } finally { fs.closeSync(stderr); }
    assert.ifError(child.error);
    assert.notEqual(child.status, 0);
    assert.match(fs.readFileSync(stderrPath, 'utf8'), /Node\.js 20\.3 or newer/);
  } finally {
    fs.rmSync(runtime, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("1Ultra's own refusals are never retried or handed to a fallback provider", () => {
  const { classifyApiError } = require('../station/sidecar/providers/errorClass.js');
  for (const code of ['ULTRA_EMERGENCY_STOP', 'ULTRA_PROVIDER_OFF', 'ULTRA_OUTBOUND_BLOCKED']) {
    const c = classifyApiError(Object.assign(new Error('refused by 1Ultra'), { code }), { model: 'gpt-6.1-sol' });
    assert.equal(c.retryable, false, code); assert.equal(c.shouldFallback, false, code);
  }
});

test('the Codex adapter cannot retry or list models after the switch is turned off', async () => {
  const { makeCodexProvider } = require('../station/sidecar/providers/codex.js');
  let allow = true, calls = 0;
  const check = () => { if (!allow) throw Object.assign(new Error('Lead agent on Codex is off.'), { code: 'ULTRA_PROVIDER_OFF' }); };
  const fixtureFetch = async () => { calls++; allow = false; return new Response('busy', { status: 503 }); };
  const provider = makeCodexProvider({ fetch: Policy.gateFetch(fixtureFetch, check, null), token: 'fixture', baseUrl: 'https://codex.fixture.test' });
  await assert.rejects(async () => {
    for await (const ev of provider.stream({ model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'fixture' }] })) void ev;
  }, e => /off/i.test(String(e && e.message)) || (e && e.code) === 'ULTRA_PROVIDER_OFF');
  assert.equal(calls, 1, 'the retry after the 503 is refused before any request');
  await provider.listModels();
  assert.equal(calls, 1, 'the model catalog makes no request either');
});

test('assertModelRequest refuses during the emergency stop and while the provider switch is off', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-model-root-'));
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-model-runtime-'));
  const hostPath = path.resolve(__dirname, '../station/ultra-host.js');
  const probe = String.raw`
    const host = require(process.argv[1]);
    const attempt = () => { try { host.assertModelRequest({ provider: 'codex' }); return 'ok'; } catch (e) { return e.code || e.message; } };
    const result = {};
    result.switchOff = attempt();
    host.switches.set('lead.codex', true);
    result.switchOn = attempt();
    const before = host.stopSignal();
    host.onStationHalt();
    result.signalAbortedByStop = before.aborted;
    result.halted = attempt();
    result.constructionWhileHalted = (() => { try { host.assertProviderAllowed({ provider: 'codex' }); return 'ok'; } catch (e) { return e.code; } })();
    host.onStationResume();
    result.freshSignalAfterResume = host.stopSignal().aborted === false;
    result.resumed = attempt();
    host.switches.set('lead.codex', false);
    result.switchedOff = attempt();
    process.stdout.write(JSON.stringify(result));
  `;
  try {
    // Regular files let the child report JSON without creating socket-backed stdio pipes.
    const stdoutPath = path.join(root, 'stdout.json'), stderrPath = path.join(root, 'stderr.txt');
    const stdout = fs.openSync(stdoutPath, 'w'), stderr = fs.openSync(stderrPath, 'w');
    let child;
    try {
      child = spawnSync(process.execPath, ['-e', probe, hostPath], {
        env: { ...process.env, ULTRA_ROOT: root, ULTRA_RUNTIME: runtime },
        stdio: ['ignore', stdout, stderr], timeout: 15000
      });
    } finally {
      fs.closeSync(stdout); fs.closeSync(stderr);
    }
    assert.ifError(child.error);
    assert.equal(child.status, 0, fs.readFileSync(stderrPath, 'utf8'));
    assert.deepEqual(JSON.parse(fs.readFileSync(stdoutPath, 'utf8')), {
      switchOff: 'ULTRA_PROVIDER_OFF', switchOn: 'ok', halted: 'ULTRA_EMERGENCY_STOP',
      constructionWhileHalted: 'ok', resumed: 'ok', switchedOff: 'ULTRA_PROVIDER_OFF',
      signalAbortedByStop: true, freshSignalAfterResume: true
    });
  } finally {
    fs.rmSync(runtime, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
