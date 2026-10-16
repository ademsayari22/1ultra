'use strict';
// The owner quest gate: an `ultra:` quest is recorded through the worker before Starnet completes it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeQuestGate } = require('../station/ultra-quest-gate.js');

const ultraQuest = { id: 'q:7', status: 'open', contract: { type: 'attest', key: 'ultra:send:tn:0123456789abcdef' } };
const evidence = '2026-10-16 email to info@example.tn';

function recorder(reply) {
  const calls = [];
  return { calls, call: async req => { calls.push(req); if (reply instanceof Error) throw reply; return reply; } };
}

test('a quest that is not 1Ultra\'s passes without touching the worker', async () => {
  const r = recorder({});
  const gate = makeQuestGate({ call: r.call, isHalted: () => false });
  assert.deepEqual(await gate({ id: 'q:1', contract: { type: 'attest', key: '' } }, ''), { ok: true });
  assert.deepEqual(await gate({ id: 'q:2', contract: { type: 'run', key: 'r1' } }, ''), { ok: true });
  assert.deepEqual(await gate(null, ''), { ok: true });
  assert.equal(r.calls.length, 0);
});

test('an ultra quest needs at least ten characters of evidence', async () => {
  const r = recorder({ recorded: true });
  const gate = makeQuestGate({ call: r.call, isHalted: () => false });
  const out = await gate(ultraQuest, '  9 chars ');
  assert.equal(out.ok, false);
  assert.match(out.error, /date, channel, recipient/);
  assert.equal(r.calls.length, 0);
});

test('an ultra quest is recorded through the worker hook with exactly its id, key and evidence', async () => {
  const r = recorder({ status: 200, value: { recorded: true, event: { id: 'ev1' } } });
  const gate = makeQuestGate({ call: r.call, isHalted: () => false });
  assert.deepEqual(await gate(ultraQuest, evidence), { ok: true });
  assert.deepEqual(r.calls, [{ route: '/api/hooks/quest-event', method: 'POST', version: '',
    body: { quest_id: 'q:7', key: 'ultra:send:tn:0123456789abcdef', evidence } }]);
});

test('a worker refusal keeps the quest open and says why', async () => {
  const r = recorder({ status: 400, value: { error: 'The draft changed since you approved it. Approve the current draft again.' } });
  const gate = makeQuestGate({ call: r.call, isHalted: () => false });
  assert.deepEqual(await gate(ultraQuest, evidence), { ok: false, error: 'The draft changed since you approved it. Approve the current draft again.' });
});

test('a worker that stops or times out keeps the quest open', async () => {
  const r = recorder(new Error('Campaign request timed out. Refresh before retrying a save.'));
  const gate = makeQuestGate({ call: r.call, isHalted: () => false });
  assert.deepEqual(await gate(ultraQuest, evidence), { ok: false, error: 'Campaign request timed out. Refresh before retrying a save.' });
});

test('the emergency stop refuses before the worker is called', async () => {
  const r = recorder({ recorded: true });
  const gate = makeQuestGate({ call: r.call, isHalted: () => true });
  const out = await gate(ultraQuest, evidence);
  assert.equal(out.ok, false);
  assert.match(out.error, /emergency stop/i);
  assert.equal(r.calls.length, 0);
});

test('nothing is recorded for a quest the store will refuse anyway', async () => {
  const r = recorder({ status: 200, value: { recorded: true } });
  const gate = makeQuestGate({ call: r.call, isHalted: () => false });
  assert.deepEqual(await gate({ ...ultraQuest, status: 'dismissed' }, evidence), { ok: true });
  assert.deepEqual(await gate({ ...ultraQuest, status: 'done' }, evidence), { ok: true });
  // a confirm needs a pending agent attest; without one Starnet refuses the confirm, so the gate stays out of it
  assert.deepEqual(await gate({ ...ultraQuest, status: 'open', attest: null }, evidence, { attest: true }), { ok: true });
  assert.equal(r.calls.length, 0);
  assert.deepEqual(await gate({ ...ultraQuest, status: 'open', attest: { confirmed: null } }, evidence, { attest: true }), { ok: true });
  assert.equal(r.calls.length, 1);
});
