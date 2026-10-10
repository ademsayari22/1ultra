'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('invalid seeded lead save reports a startup diagnostic', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-seed-root-'));
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-seed-runtime-'));
  const hostPath = path.resolve(__dirname, '../station/ultra-host.js');
  const probe = String.raw`
    require(process.argv[1]);
  `;
  try {
    fs.writeFileSync(path.join(runtime, 'agent.save.json'), '{not json');
    // Regular files let the child report diagnostics without creating socket-backed stdio pipes.
    const stdoutPath = path.join(root, 'stdout.txt'), stderrPath = path.join(root, 'stderr.txt');
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
    const diagnostic = fs.readFileSync(stderrPath, 'utf8');
    assert.equal(child.status, 0, diagnostic);
    assert.match(diagnostic, /1Ultra: could not apply the xhigh default/);
  } finally {
    fs.rmSync(runtime, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
