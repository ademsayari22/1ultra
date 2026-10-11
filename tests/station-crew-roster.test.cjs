'use strict';
const assert = require('node:assert/strict'), test = require('node:test');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { makeRoster } = require('../station/ultra-crew-roster.js');
const { makeCrew } = require('../station/ultra-crew.js');
const seed = require('../station/ultra-seed.js');
const durable = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const read = (rt, name) => JSON.parse(fs.readFileSync(path.join(rt, name), 'utf8'));
function seededRuntime() {
  const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-roster-'));
  for (const [name, value] of Object.entries(seed.files(1000))) durable(path.join(rt, name), value);
  return rt;
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
    assert.match(rows.agents[1].system, /never send messages/);
    assert.ok(rows.updatedAt >= 5000);
    assert.deepEqual(read(rt, 'ultra-crew.json').seeded, ['research', 'delivery', 'sales', 'qa']);
    assert.equal(roster.profileFor('sales').taskType, 'chat');
    assert.deepEqual(roster.memberIds(), ['research', 'delivery', 'sales', 'qa']);
    assert.deepEqual(roster.seed().added, [], 'a second boot adds nothing');
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
    assert.equal(fs.existsSync(path.join(rt, 'ultra-crew.json')), false);
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

test("crew requests carry the member's task type; other providers and agents are untouched", () => {
  const rt = seededRuntime();
  try {
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
    const crew = makeCrew({ fs, path, runtime: rt, switches: { isOn: () => false }, port: 3901, durable, now: () => 5000 });
    crew.seedRoster();
    const f = async () => ({ status: 200, headers: { get: () => '' } });
    const headers = { 'x-freellm-task-type': 'chat' };
    const options = crew.adapterOptions({ provider: 'custom', fetch: f, ultraAgentId: 'delivery', headers });
    assert.deepEqual(options.headers, { 'x-freellm-task-type': 'chat' });
    assert.equal(options.headers, headers, 'an explicit header object is passed through unchanged');
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});
