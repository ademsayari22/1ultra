'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('control resume delegates persistence to onStationResume', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../station/ultra-host.js'), 'utf8');
  const branch = source.match(/else if\s*\(body\.action\s*===\s*'resume'\)([\s\S]*?)else if\s*\(body\.action\s*===\s*'cancel'\)/);
  assert.ok(branch, 'the control resume branch must exist');
  assert.match(branch[1], /\bonStationResume\s*\(\s*\)/);
});

test('persistence failures keep emergency stop active and cannot skip station cancellation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-stop-root-'));
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-stop-runtime-'));
  const hostPath = path.resolve(__dirname, '../station/ultra-host.js');
  const probe = String.raw`
    const fs = require('node:fs');
    const path = require('node:path');
    const { Readable } = require('node:stream');
    const host = require(process.argv[1]);
    const runtime = process.env.ULTRA_RUNTIME;
    const result = {};
    const failure = fn => {
      try { fn(); return null; }
      catch (e) { return { message: e.message, code: e.code || null }; }
    };
    let stationHalts = 0;
    host.registerStationHalt(() => {
      stationHalts++;
      throw new Error('fixture station halt failure');
    });
    (async () => {
      fs.chmodSync(runtime, 0o500);
      try {
        result.haltError = failure(() => host.onStationHalt());
        result.afterHaltAdmission = failure(() => host.beforeRun({}));
        result.resumeError = failure(() => host.onStationResume());
        result.afterFailedResumeAdmission = failure(() => host.beforeRun({}));
        const body = JSON.stringify({ action: 'stop' });
        const req = Readable.from([Buffer.from(body)]);
        Object.assign(req, {
          method: 'POST', url: '/api/ultra/control',
          headers: {
            'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
            host: '127.0.0.1:8541', origin: 'http://127.0.0.1:8541'
          }
        });
        await host.handle(req, {
          writeHead(status) { result.stopStatus = status; },
          end(body) { result.stopResponse = JSON.parse(body); }
        });
        result.stationHalts = stationHalts;
      } finally {
        fs.chmodSync(runtime, 0o700);
      }
      result.recoveredResumeError = failure(() => host.onStationResume());
      result.recoveredAdmission = failure(() => host.beforeRun({}));
      result.savedControl = JSON.parse(fs.readFileSync(path.join(runtime, 'ultra-control.json'), 'utf8'));
      process.stdout.write(JSON.stringify(result));
    })().catch(e => { process.stderr.write(e.stack + '\n'); process.exitCode = 1; });
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
    const result = JSON.parse(fs.readFileSync(stdoutPath, 'utf8'));
    assert.match(result.haltError?.message || '', /not saved/);
    assert.equal(result.afterHaltAdmission?.code, 'ULTRA_EMERGENCY_STOP');
    assert.ok(result.resumeError, 'a failed resume write must throw');
    assert.equal(result.afterFailedResumeAdmission?.code, 'ULTRA_EMERGENCY_STOP');
    assert.equal(result.stationHalts, 1, 'persistence failure must not skip Starnet cancellation');
    assert.equal(result.stopStatus, 500);
    assert.equal(result.stopResponse.halted, true);
    assert.equal(result.stopResponse.problems.length, 2);
    assert.match(result.stopResponse.problems[0], /not saved/);
    assert.equal(result.stopResponse.problems[1], 'Starnet halt failed: fixture station halt failure');
    assert.equal(result.recoveredResumeError, null);
    assert.equal(result.recoveredAdmission, null);
    assert.deepEqual(result.savedControl, { halted: false });
  } finally {
    fs.chmodSync(runtime, 0o700);
    fs.rmSync(runtime, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
