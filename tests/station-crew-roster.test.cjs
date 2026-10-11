'use strict';
const assert = require('node:assert/strict'), test = require('node:test');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { makeRoster } = require('../station/ultra-crew-roster.js');
const { makeCrew } = require('../station/ultra-crew.js');
const seed = require('../station/ultra-seed.js');
const { oldTexts, newTexts } = require('./fixtures/station-agent-texts.cjs');
const durable = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const read = (rt, name) => JSON.parse(fs.readFileSync(path.join(rt, name), 'utf8'));
function seededRuntime() {
  const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-roster-'));
  for (const [name, value] of Object.entries(seed.files(1000))) durable(path.join(rt, name), value);
  return rt;
}
function writeWire(rt) {
  fs.mkdirSync(path.join(rt, '.secrets'), { recursive: true });
  durable(path.join(rt, '.secrets', 'freellmapi.json'), { baseUrl: 'http://127.0.0.1:3901/v1', key: 'freellmapi-' + 'ab'.repeat(24) });
}

test('the four crew members are added once, to the save and the roster, on the free tier', () => {
  const rt = seededRuntime();
  try {
    const roster = makeRoster({ fs, path, runtime: rt, durable, now: () => 5000 });
    assert.deepEqual(roster.seed().added, ['research', 'delivery', 'sales', 'qa']);
    const env = read(rt, 'agent.save.json');
    const crew = env.doc.agents;
    assert.deepEqual(crew.map(a => [a.id, a.provider, a.model]), [['research', 'custom', 'auto:smart'], ['delivery', 'custom', 'auto:balanced'], ['sales', 'custom', 'auto:smart'], ['qa', 'custom', 'auto:smart']]);
    assert.match(crew[3].docs.identity, /VERDICT: approved or VERDICT: revise/);
    assert.equal(env.doc._saveRevision, 1, 'a new save revision makes a reloaded page adopt the crew');
    assert.ok(env.doc.updatedAt >= 5000 && env.updatedAt === env.doc.updatedAt);
    const rows = read(rt, 'agent.roster.json');
    assert.deepEqual(rows.agents.map(r => r.agentId), ['agent', 'research', 'delivery', 'sales', 'qa']);
    assert.match(rows.agents[1].system, /nothing leaves the station without Adem/);
    assert.ok(rows.updatedAt >= 5000);
    assert.deepEqual(read(rt, 'ultra-crew.json').seeded, ['research', 'delivery', 'sales', 'qa']);
    assert.equal(roster.profileFor('sales').taskType, 'chat');
    assert.deepEqual(roster.memberIds(), ['research', 'delivery', 'sales', 'qa']);
    assert.deepEqual(roster.seed().added, [], 'a second boot adds nothing');
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

function oldRuntime() {
  const rt = seededRuntime();
  makeRoster({ fs, path, runtime: rt, durable, now: () => 1000 }).seed();
  const env = read(rt, 'agent.save.json');
  for (const agent of [env.doc.agent, ...env.doc.agents]) {
    agent.docs = { ...oldTexts[agent.id] };
    agent.purpose = oldTexts[agent.id].purpose;
  }
  env.updatedAt = 12000; env.doc.updatedAt = 16000; env.requestUpdatedAt = 16000;
  env.doc._saveRevision = 7; env.doc._saveDirty = true;
  durable(path.join(rt, 'agent.save.json'), env);
  const roster = read(rt, 'agent.roster.json');
  roster.updatedAt = 18000;
  for (const row of roster.agents) {
    const text = Object.values(oldTexts[row.agentId]).join('\n\n');
    row.system = 'Owner prefix\n' + text + '\n' + text + '\nOwner suffix';
  }
  durable(path.join(rt, 'agent.roster.json'), roster);
  return rt;
}

test('old seeded texts migrate in every saved field and every roster occurrence with a new revision', () => {
  const rt = oldRuntime();
  try {
    const before = read(rt, 'agent.save.json');
    const beforeCrew = read(rt, 'ultra-crew.json');
    const crew = makeCrew({ fs, path, runtime: rt, durable, switches: { isOn: () => false }, port: 3901, now: () => 5000 });
    assert.deepEqual(crew.migrateTexts().changed, ['agent', 'research', 'delivery', 'sales', 'qa']);
    const env = read(rt, 'agent.save.json');
    for (const agent of [env.doc.agent, ...env.doc.agents]) {
      assert.deepEqual(agent.docs, newTexts[agent.id], agent.id + ': all four docs');
      assert.equal(agent.purpose, newTexts[agent.id].purpose, agent.id + ': top-level purpose');
      const original = [before.doc.agent, ...before.doc.agents].find(a => a.id === agent.id);
      assert.deepEqual({ ...agent, docs: original.docs, purpose: original.purpose }, original, 'other agent settings stay unchanged');
    }
    assert.equal(env.doc._saveRevision, 8);
    assert.equal(env.doc._saveDirty, false);
    assert.equal(env.updatedAt, 16001); assert.equal(env.doc.updatedAt, 16001);
    assert.equal(env.requestUpdatedAt, 16001); assert.equal(env.savedAt, 5000);
    const roster = read(rt, 'agent.roster.json');
    assert.equal(roster.updatedAt, 18001);
    for (const row of roster.agents) {
      const text = Object.values(newTexts[row.agentId]).join('\n\n');
      assert.equal(row.system, 'Owner prefix\n' + text + '\n' + text + '\nOwner suffix', row.agentId + ': every occurrence');
    }
    assert.deepEqual(read(rt, 'ultra-crew.json'), { ...beforeCrew, textsVersion: 2 });
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

test('migration keeps owner-edited Sales fields while migrating its old identity', () => {
  const rt = oldRuntime();
  try {
    const env = read(rt, 'agent.save.json');
    const sales = env.doc.agents.find(a => a.id === 'sales');
    const editedManual = 'Adem added a note. ' + oldTexts.sales.manual;
    sales.docs.manual = editedManual;
    sales.purpose = 'My Sales purpose';
    env.doc.agents.push({ id: 'ordinary', docs: { ...oldTexts.sales }, purpose: oldTexts.sales.purpose });
    durable(path.join(rt, 'agent.save.json'), env);
    makeRoster({ fs, path, runtime: rt, durable, now: () => 5000 }).migrateTexts();
    const saved = read(rt, 'agent.save.json').doc.agents;
    const migrated = saved.find(a => a.id === 'sales');
    assert.equal(migrated.docs.manual, editedManual, 'docs require an exact match, not a substring');
    assert.equal(migrated.docs.identity, newTexts.sales.identity);
    assert.equal(migrated.docs.purpose, newTexts.sales.purpose);
    assert.equal(migrated.purpose, 'My Sales purpose');
    assert.deepEqual(saved.find(a => a.id === 'ordinary'), env.doc.agents.at(-1), 'unrelated agents stay unchanged');
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

test('a second boot skips migration without writing any runtime file', () => {
  const rt = oldRuntime();
  try {
    makeRoster({ fs, path, runtime: rt, durable }).migrateTexts();
    const files = ['agent.save.json', 'agent.roster.json', 'ultra-crew.json'];
    const before = files.map(name => fs.readFileSync(path.join(rt, name), 'utf8'));
    const writes = [];
    const crew = makeCrew({ fs, path, runtime: rt, durable: (file, value) => { writes.push(file); durable(file, value); },
      switches: { isOn: () => false }, port: 3901, now: () => 999999 });
    assert.deepEqual(crew.seedRoster().added, []);
    assert.deepEqual(crew.migrateTexts().changed, []);
    assert.deepEqual(writes, []);
    assert.deepEqual(files.map(name => fs.readFileSync(path.join(rt, name), 'utf8')), before);
    assert.equal(makeRoster({ fs, path, runtime: rt, durable }).readCrew().textsVersion, 2);
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

test('new crew seeds use the lenient texts and name each owner-only external action', () => {
  const rt = seededRuntime();
  try {
    makeRoster({ fs, path, runtime: rt, durable }).seed();
    for (const agent of read(rt, 'agent.save.json').doc.agents) {
      assert.deepEqual(agent.docs, newTexts[agent.id]);
      assert.equal(agent.purpose, newTexts[agent.id].purpose);
      assert.match(agent.docs.manual, /nothing leaves the station without Adem/);
      for (const action of ['send', 'publish', 'buy', 'sign', 'record']) assert.match(agent.docs.manual, new RegExp('\\b' + action + '\\b'));
    }
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

test('already current texts mark the version without rewriting agent files', () => {
  const rt = seededRuntime();
  try {
    const roster = makeRoster({ fs, path, runtime: rt, durable });
    roster.seed();
    const files = ['agent.save.json', 'agent.roster.json'];
    const before = files.map(name => fs.readFileSync(path.join(rt, name), 'utf8'));
    const writes = [];
    const migrator = makeRoster({ fs, path, runtime: rt, durable: (file, value) => { writes.push(path.basename(file)); durable(file, value); } });
    assert.deepEqual(migrator.migrateTexts().changed, []);
    assert.deepEqual(writes, ['ultra-crew.json']);
    assert.deepEqual(files.map(name => fs.readFileSync(path.join(rt, name), 'utf8')), before);
    assert.equal(read(rt, 'ultra-crew.json').textsVersion, 2);
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

test('an interrupted text migration retries the missing roster write before marking the version', () => {
  const rt = oldRuntime();
  try {
    const interrupted = makeRoster({ fs, path, runtime: rt, now: () => 5000, durable: (file, value) => {
      if (path.basename(file) === 'agent.roster.json') throw new Error('interrupted migration');
      durable(file, value);
    } });
    assert.throws(() => interrupted.migrateTexts(), /interrupted migration/);
    assert.notEqual(read(rt, 'ultra-crew.json').textsVersion, 2);
    assert.equal(read(rt, 'agent.save.json').doc._saveRevision, 8);
    const writes = [];
    const retry = makeRoster({ fs, path, runtime: rt, now: () => 6000, durable: (file, value) => {
      writes.push(path.basename(file)); durable(file, value);
    } });
    assert.deepEqual(retry.migrateTexts().changed, ['agent', 'research', 'delivery', 'sales', 'qa']);
    assert.deepEqual(writes, ['agent.roster.json', 'ultra-crew.json']);
    assert.equal(read(rt, 'agent.save.json').doc._saveRevision, 8, 'the completed save is not rewritten');
    assert.equal(read(rt, 'ultra-crew.json').textsVersion, 2);
    for (const row of read(rt, 'agent.roster.json').agents) {
      assert.ok(row.system.includes(newTexts[row.agentId].identity));
      assert.ok(!row.system.includes(oldTexts[row.agentId].identity));
    }
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

test('a member Adem deleted is not added back, and an agent Adem already has keeps its settings', () => {
  const rt = seededRuntime();
  try {
    const env = read(rt, 'agent.save.json');
    env.doc.agents = [{ id: 'sales', name: 'My Sales', provider: 'openrouter', model: 'x' }];
    durable(path.join(rt, 'agent.save.json'), env);
    const roster = makeRoster({ fs, path, runtime: rt, durable, now: () => 5000 });
    assert.deepEqual(roster.seed().added, ['research', 'delivery', 'qa']);
    const saved = read(rt, 'agent.save.json');
    assert.deepEqual(saved.doc.agents.find(a => a.id === 'sales'), { id: 'sales', name: 'My Sales', provider: 'openrouter', model: 'x' });
    saved.doc.agents = saved.doc.agents.filter(a => a.id !== 'qa');
    durable(path.join(rt, 'agent.save.json'), saved);
    assert.deepEqual(roster.seed().added, []);
    assert.equal(read(rt, 'agent.save.json').doc.agents.some(a => a.id === 'qa'), false);
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

test('without a station save nothing is written, so the next boot tries again', () => {
  const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-roster-'));
  try {
    const roster = makeRoster({ fs, path, runtime: rt, durable, now: () => 5000 });
    assert.deepEqual(roster.seed().added, []);
    assert.deepEqual(roster.migrateTexts().changed, []);
    assert.equal(fs.existsSync(path.join(rt, 'ultra-crew.json')), false);
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

test("crew requests carry the member's task type; other providers and agents are untouched", () => {
  const rt = seededRuntime();
  try {
    writeWire(rt);
    const crew = makeCrew({ fs, path, runtime: rt, switches: { isOn: () => false }, port: 3901, durable, now: () => 5000 });
    crew.seedRoster();
    const f = async () => ({ status: 200, headers: { get: () => '' } });
    assert.deepEqual(crew.adapterOptions({ provider: 'custom', fetch: f, ultraAgentId: 'sales' }).headers, { 'X-FreeLLM-Task-Type': 'chat' });
    assert.deepEqual(crew.adapterOptions({ provider: 'custom', fetch: f, ultraAgentId: 'delivery', headers: { 'X-FreeLLM-Task-Type': 'chat' } }).headers, { 'X-FreeLLM-Task-Type': 'chat' }, 'an explicit header wins');
    assert.equal(crew.adapterOptions({ provider: 'custom', fetch: f, ultraAgentId: 'agent' }).headers, undefined);
    const codex = { provider: 'codex', fetch: f, ultraAgentId: 'sales' };
    assert.equal(crew.adapterOptions(codex), codex);
    const raw = read(rt, 'ultra-crew.json');
    raw.profiles.qa.minTier = 'mega';
    durable(path.join(rt, 'ultra-crew.json'), raw);
    assert.equal(crew.profileFor('qa'), null, 'a broken profile is ignored, never guessed');
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

test('an interrupted roster write is retried without duplicating saved crew members', () => {
  const rt = seededRuntime();
  try {
    const ids = ['research', 'delivery', 'sales', 'qa'];
    let failRoster = true;
    const interruptedDurable = (file, value) => {
      if (path.basename(file) === 'agent.roster.json' && failRoster) {
        failRoster = false;
        throw new Error('interrupted roster write');
      }
      durable(file, value);
    };
    const first = makeRoster({ fs, path, runtime: rt, durable: interruptedDurable, now: () => 5000 });
    assert.throws(() => first.seed(), /interrupted roster write/);
    assert.ok(fs.existsSync(path.join(rt, 'ultra-crew.json')), 'the pending journal must precede the save and roster writes');
    const pending = read(rt, 'ultra-crew.json');
    assert.deepEqual(pending.pending, ids);
    assert.deepEqual(pending.seeded, []);
    assert.deepEqual(Object.keys(pending.profiles), ids);
    assert.deepEqual(read(rt, 'agent.save.json').doc.agents.map(a => a.id), ids);
    assert.deepEqual(read(rt, 'agent.roster.json').agents.map(a => a.agentId), ['agent']);

    const retry = makeRoster({ fs, path, runtime: rt, durable, now: () => 6000 });
    assert.deepEqual(retry.seed().added, ids, 'repairing only the roster still counts as adding the members');
    const saved = read(rt, 'agent.save.json').doc.agents;
    assert.deepEqual(saved.map(a => a.id), ids);
    for (const id of ids) assert.equal(saved.filter(a => a.id === id).length, 1);
    assert.deepEqual(read(rt, 'agent.roster.json').agents.map(a => a.agentId), ['agent', ...ids]);
    const completed = read(rt, 'ultra-crew.json');
    assert.deepEqual(completed.seeded, ids);
    assert.deepEqual(completed.pending, []);
    assert.deepEqual(retry.seed().added, []);
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

test('an explicit task-type header wins regardless of key casing and is kept unchanged', () => {
  const rt = seededRuntime();
  try {
    writeWire(rt);
    const crew = makeCrew({ fs, path, runtime: rt, switches: { isOn: () => false }, port: 3901, durable, now: () => 5000 });
    crew.seedRoster();
    const f = async () => ({ status: 200, headers: { get: () => '' } });
    const headers = { 'x-freellm-task-type': 'chat' };
    const options = crew.adapterOptions({ provider: 'custom', fetch: f, ultraAgentId: 'delivery', headers });
    assert.deepEqual(options.headers, { 'x-freellm-task-type': 'chat' });
    assert.equal(options.headers, headers, 'an explicit header object is passed through unchanged');
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

test('known crew membership survives a broken or removed profile and includes profile-only members', () => {
  const rt = seededRuntime();
  try {
    const roster = makeRoster({ fs, path, runtime: rt, durable });
    roster.seed();
    const raw = read(rt, 'ultra-crew.json');
    raw.profiles.qa.minTier = 'Smart';
    delete raw.profiles.sales;
    raw.profiles.extra = { minTier: 'broken' };
    durable(path.join(rt, 'ultra-crew.json'), raw);
    assert.equal(roster.profileFor('qa'), null, 'broken profiles remain null');
    assert.equal(roster.profileFor('sales'), null);
    for (const id of ['qa', 'sales', 'extra']) assert.equal(roster.isKnownMember(id), true, id);
    assert.equal(roster.isKnownMember('ordinary'), false);
    assert.deepEqual(roster.memberIds(), ['research', 'delivery', 'sales', 'qa', 'extra']);
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

test('a known crew member with an invalid profile stays supervised and cannot deliver a done result', async () => {
  const rt = seededRuntime();
  try {
    const crew = makeCrew({ fs, path, runtime: rt, switches: { isOn: () => true }, port: 3901, durable });
    crew.seedRoster();
    const raw = read(rt, 'ultra-crew.json');
    raw.profiles.qa.minTier = 'Smart';
    durable(path.join(rt, 'ultra-crew.json'), raw);
    const job = { agentId: 'qa', prompt: 'check the draft', ident: { provider: 'custom', model: 'auto:smart' } };
    const row = { reason: 'done', result: 'unchecked draft', runId: 'no-receipts' };
    assert.equal(crew.accept(job, row), false);
    assert.deepEqual(row.crewOutcome, { kind: 'unavailable', detail: 'invalid capability profile in ultra-crew.json — fix or reset it', routedVia: '' });
    assert.deepEqual(await crew.resumeCheck('qa'), { ready: false, reason: row.crewOutcome.detail });
    const member = (await crew.status()).members.find(m => m.agentId === 'qa');
    assert.deepEqual([member.profile, member.ready, member.reason], [null, false, row.crewOutcome.detail]);
    let calls = 0;
    const hooks = { runWorkerOnce: async () => { calls++; return { ...row }; }, crew: new Map(), leadProvider: 'codex', leadId: 'agent' };
    const result = await crew.supervise(job, {}, hooks);
    assert.equal(calls, 0);
    assert.notEqual(result.reason, 'done');
    assert.match(result.result, /invalid capability profile in ultra-crew.json — fix or reset it/);
    const ordinary = { ...job, agentId: 'ordinary' };
    assert.equal(crew.accept(ordinary, { reason: 'done', result: 'ordinary draft' }), true);
    assert.deepEqual(await crew.resumeCheck('ordinary'), { ready: true, reason: '' });
    assert.equal((await crew.supervise(ordinary, {}, hooks)).reason, 'done');
    assert.equal(calls, 1);
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});
