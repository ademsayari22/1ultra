'use strict';
const assert = require('node:assert/strict'), test = require('node:test');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { makeCrew } = require('../station/ultra-crew.js');
const KEY = 'freellmapi-' + 'ab'.repeat(24);
const durable = (file, value) => fs.writeFileSync(file, JSON.stringify(value));

function setup({ on = true, wire = true } = {}) {
  const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-lead-'));
  if (wire) { fs.mkdirSync(path.join(rt, '.secrets')); durable(path.join(rt, '.secrets', 'freellmapi.json'), { baseUrl: 'http://127.0.0.1:3901/v1', key: KEY }); }
  const crew = makeCrew({ fs, path, runtime: rt, switches: { isOn: id => on && id === 'crew.freellmapi' }, port: 3901, durable });
  return { rt, crew };
}

test('a Codex lead gets the free tier as its last fallback, only while the crew is on and keyed', () => {
  const ok = setup();
  try {
    assert.deepEqual(ok.crew.leadFallbacks('codex', 'agent'), [{ provider: 'custom', model: 'auto:smart' }]);
    assert.deepEqual(ok.crew.leadFallbacks('codex', 'research'), [], 'crew members have their own ladder');
    assert.deepEqual(ok.crew.leadFallbacks('openrouter', 'agent'), []);
  } finally { fs.rmSync(ok.rt, { recursive: true, force: true }); }
  for (const options of [{ on: false }, { wire: false }]) {
    const t = setup(options);
    try { assert.deepEqual(t.crew.leadFallbacks('codex', 'agent'), [], JSON.stringify(options)); }
    finally { fs.rmSync(t.rt, { recursive: true, force: true }); }
  }
});

test('a signed-out Codex lead run is rewritten to the free tier; anything else is left alone', () => {
  const t = setup();
  try {
    let signedIn = false;
    t.crew.registerCodexState(() => signedIn);
    const lead = { agentId: 'agent', provider: 'codex', model: 'gpt-6.1-sol', key: '' };
    assert.equal(t.crew.leadStartFallback('agent', 'codex'), true);
    t.crew.rewriteLeadRun(lead);
    assert.deepEqual([lead.provider, lead.model, lead.key, lead.baseUrl, lead.ultraLeadFreeTier], ['custom', 'auto:smart', KEY, 'http://127.0.0.1:3901/v1', { fromModel: 'gpt-6.1-sol' }]);
    const implicit = { agentId: 'agent', model: 'gpt-6.1-sol' };
    t.crew.rewriteLeadRun(implicit);
    assert.equal(implicit.provider, 'custom', 'the lead with no explicit provider is the Codex lead');
    const worker = { agentId: 'research', provider: 'custom', model: 'auto:smart' };
    t.crew.rewriteLeadRun(worker);
    assert.equal(worker.ultraLeadFreeTier, undefined);
    signedIn = true;
    const signed = { agentId: 'agent', provider: 'codex', model: 'gpt-6.1-sol' };
    t.crew.rewriteLeadRun(signed);
    assert.deepEqual([signed.provider, t.crew.leadStartFallback('agent', 'codex')], ['codex', false]);
  } finally { fs.rmSync(t.rt, { recursive: true, force: true }); }
});
