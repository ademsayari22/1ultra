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
    assert.match(diagnostic, /1Ultra: could not update agent instructions/);
  } finally {
    fs.rmSync(runtime, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('host boot migrates old agent instructions once and tells Adem to reopen station tabs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-texts-root-'));
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-texts-runtime-'));
  const { oldTexts, newTexts } = require('./fixtures/station-agent-texts.cjs');
  const { makeRoster } = require('../station/ultra-crew-roster.js');
  const seed = require('../station/ultra-seed.js');
  const durable = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(path.join(runtime, name), 'utf8'));
  const boot = () => {
    const stdoutPath = path.join(root, 'stdout.txt'), stderrPath = path.join(root, 'stderr.txt');
    const stdout = fs.openSync(stdoutPath, 'w'), stderr = fs.openSync(stderrPath, 'w');
    let child;
    try {
      child = spawnSync(process.execPath, ['-e', 'require(process.argv[1]);', path.resolve(__dirname, '../station/ultra-host.js')], {
        env: { ...process.env, ULTRA_ROOT: root, ULTRA_RUNTIME: runtime },
        stdio: ['ignore', stdout, stderr], timeout: 15000
      });
    } finally { fs.closeSync(stdout); fs.closeSync(stderr); }
    assert.ifError(child.error);
    const diagnostic = fs.readFileSync(stderrPath, 'utf8');
    assert.equal(child.status, 0, diagnostic);
    return diagnostic;
  };
  try {
    for (const [name, value] of Object.entries(seed.files(1000))) durable(path.join(runtime, name), value);
    makeRoster({ fs, path, runtime, durable, now: () => 1000 }).seed();
    const env = read('agent.save.json');
    for (const agent of [env.doc.agent, ...env.doc.agents]) {
      agent.docs = { ...oldTexts[agent.id] }; agent.purpose = oldTexts[agent.id].purpose;
    }
    durable(path.join(runtime, 'agent.save.json'), env);
    const roster = read('agent.roster.json');
    for (const row of roster.agents) row.system = Object.values(oldTexts[row.agentId]).join('\n\n');
    durable(path.join(runtime, 'agent.roster.json'), roster);

    assert.match(boot(), /1Ultra: agent instructions updated \(agent, research, delivery, sales, qa\)\. Close and reopen any station tab\./);
    for (const agent of [read('agent.save.json').doc.agent, ...read('agent.save.json').doc.agents]) assert.deepEqual(agent.docs, newTexts[agent.id]);
    assert.equal(read('agent.save.json').doc._saveRevision, 2);
    assert.equal(read('ultra-crew.json').textsVersion, 2);
    const files = ['agent.save.json', 'agent.roster.json', 'ultra-crew.json'];
    const before = files.map(name => fs.readFileSync(path.join(runtime, name), 'utf8'));
    assert.doesNotMatch(boot(), /agent instructions updated/);
    assert.deepEqual(files.map(name => fs.readFileSync(path.join(runtime, name), 'utf8')), before);
  } finally {
    fs.rmSync(runtime, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
