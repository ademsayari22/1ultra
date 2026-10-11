'use strict';
const assert = require('node:assert/strict'), test = require('node:test');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { makeWire, portFrom, freeTierUsd } = require('../station/ultra-crew-wire.js');
const { makeCrew } = require('../station/ultra-crew.js');
const KEY = 'freellmapi-' + 'ab'.repeat(24);
const durable = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
function runtime() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-crew-')); }
function writeWire(rt, value) {
  fs.mkdirSync(path.join(rt, '.secrets'), { recursive: true });
  fs.writeFileSync(path.join(rt, '.secrets', 'freellmapi.json'), JSON.stringify(value));
}

test('every crew adapter uses the local wire even when the caller overrides endpoint and key', () => {
  const rt = runtime();
  try {
    writeWire(rt, { baseUrl: 'http://127.0.0.1:3901/v1', key: KEY });
    const crew = makeCrew({ fs, path, runtime: rt, switches: { isOn: () => true }, port: 3901, durable });
    for (const ultraAgentId of ['qa', 'agent', undefined]) {
      const input = { provider: 'custom', baseUrl: 'https://example.com/v1', key: 'sk-other', ultraAgentId };
      const output = crew.adapterOptions(input);
      assert.deepEqual([output.baseUrl, output.key], ['http://127.0.0.1:3901/v1', KEY]);
      assert.equal(input.baseUrl, 'https://example.com/v1', 'caller options are not mutated');
    }
    const input = { provider: 'codex', baseUrl: 'https://example.com/v1', key: 'sk-other' };
    assert.equal(crew.adapterOptions(input), input);
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

test('a crew adapter without a loaded wire refuses every endpoint override', () => {
  const rt = runtime();
  try {
    const crew = makeCrew({ fs, path, runtime: rt, switches: { isOn: () => true }, port: 3901, durable });
    assert.throws(() => crew.adapterOptions({ provider: 'custom', baseUrl: 'https://example.com/v1', key: 'sk-other' }),
      error => error.code === 'ULTRA_CREW_NO_WIRE' && error.message.includes('python3 scripts/freellmapi.py key'));
    const input = { provider: 'openrouter', key: 'sk-other' };
    assert.equal(crew.adapterOptions(input), input);
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

test('the FreeLLMAPI port comes from ULTRA_FREELLMAPI_PORT and defaults to 3001', () => {
  assert.equal(portFrom({}), 3001);
  assert.equal(portFrom({ ULTRA_FREELLMAPI_PORT: '3901' }), 3901);
  for (const bad of ['80', '70000', 'x', '3001.5']) assert.throws(() => portFrom({ ULTRA_FREELLMAPI_PORT: bad }), /ULTRA_FREELLMAPI_PORT/);
});

test('free-tier runs book only paid media and skip ordinary model cost computation', () => {
  let calls = 0;
  const compute = usd => () => { calls++; return usd; };
  assert.equal(freeTierUsd(true, 0.10, compute(0.25)), 0.10);
  assert.equal(freeTierUsd(true, 0, compute(0.15)), 0);
  assert.equal(freeTierUsd(true, undefined, compute(0.15)), 0);
  assert.equal(calls, 0, 'free-tier accounting never computes model cost');
  assert.equal(freeTierUsd(false, 0.10, compute(0.25)), 0.25);
  assert.equal(calls, 1, 'other providers retain ordinary cost computation');
});

test('provider custom is configured only from a loopback URL on the configured port and a well-formed key', () => {
  const rt = runtime(), calls = [];
  try {
    const wire = makeWire({ fs, path, runtime: rt, port: 3901 });
    wire.register((id, patch) => calls.push([id, patch]));
    assert.deepEqual(calls.pop(), ['custom', { baseUrl: '', key: '' }]);
    assert.equal(wire.status().problem, 'not_configured');
    writeWire(rt, { baseUrl: 'http://127.0.0.1:3901/v1', key: KEY });
    wire.refresh();
    assert.deepEqual(calls.pop(), ['custom', { baseUrl: 'http://127.0.0.1:3901/v1', key: KEY }]);
    assert.equal(wire.isFreeTier('custom'), true);
    assert.equal(wire.isFreeTier('codex'), false);
    wire.refresh();
    assert.equal(calls.length, 0, 'an unchanged file is not applied again');
    for (const [value, problem] of [
      [{ baseUrl: 'http://example.com:3901/v1', key: KEY }, 'wrong_endpoint'],
      [{ baseUrl: 'http://127.0.0.1:3001/v1', key: KEY }, 'wrong_endpoint'],
      [{ baseUrl: 'http://127.0.0.1:3901/v1', key: 'sk-other' }, 'bad_key']]) {
      writeWire(rt, value);
      wire.refresh();
      assert.equal(wire.status().problem, problem);
      assert.equal(wire.isFreeTier('custom'), false);
    }
    assert.deepEqual(calls.at(-1), ['custom', { baseUrl: '', key: '' }]);
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});

test('crew status asks FreeLLMAPI only while the switch is on, and counts only ready models', async () => {
  const rt = runtime(), seen = [];
  try {
    writeWire(rt, { baseUrl: 'http://127.0.0.1:3901/v1', key: KEY });
    let on = false;
    let reply = { status: 200, body: { data: [{ id: 'auto', available: true }, { id: 'm1', execution_status: 'ready' }, { id: 'm2', execution_status: 'exhausted' }] } };
    const fetchFn = async (url, init) => { seen.push([url, init.headers.Authorization]); return { status: reply.status, ok: reply.status < 400, json: async () => reply.body }; };
    const crew = makeCrew({ fs, path, runtime: rt, switches: { isOn: id => id === 'crew.freellmapi' && on }, port: 3901, durable, fetchFn });
    assert.equal((await crew.status()).reachable, false);
    assert.equal(seen.length, 0, 'nothing is asked while crew.freellmapi is off');
    on = true;
    const s = await crew.status();
    assert.deepEqual([s.reachable, s.keyAccepted, s.readyModels], [true, true, 1]);
    assert.deepEqual(seen[0], ['http://127.0.0.1:3901/v1/models?execution_status=ready', 'Bearer ' + KEY]);
    reply = { status: 401, body: {} };
    const rejected = await crew.status();
    assert.deepEqual([rejected.reachable, rejected.keyAccepted], [true, false]);
  } finally { fs.rmSync(rt, { recursive: true, force: true }); }
});
