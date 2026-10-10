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
    host.onStationHalt();
    result.halted = attempt();
    result.constructionWhileHalted = (() => { try { host.assertProviderAllowed({ provider: 'codex' }); return 'ok'; } catch (e) { return e.code; } })();
    host.onStationResume();
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
      constructionWhileHalted: 'ok', resumed: 'ok', switchedOff: 'ULTRA_PROVIDER_OFF'
    });
  } finally {
    fs.rmSync(runtime, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
