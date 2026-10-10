const assert = require('node:assert/strict');
const test = require('node:test');
const Policy = require('../station/ultra-policy.js');
const switches = (...on) => ({ isOn: id => on.includes(id) || (id === 'channels' && on.some(x => x.startsWith('channels.'))) || (id === 'providers' && on.some(x => x.startsWith('providers.'))) });
test('path classes use prefix boundaries and longest match', () => {
  const cases = {'/api/memory/notes':'local','/api/runs':'local','/api/run-recoveries':'local','/api/run':'lead.codex','/api/agents/affinity':'local',
    '/api/agent':'lead.codex','/api/auth/codex/start':'lead.codex','/api/auth/grok/start':'providers','/api/execution-profiles':'tools.shell',
    '/api/channels/telegram/bots':'channels','/api/cron/arm':'cron','/api/nightshift':'nightshift','/api/connectors':'tools.mcp',
    '/api/tts':'voice','/api/browser/reset':'tools.browser','/api/credits':'blocked','/api/update/prepare':'blocked','/api/nope':'unclassified',
    '/shared/events.js':'local','/workshop-run/abc/index.html':'lead.codex','/view/t/index.html':'local',
    '/plugin-ui/p/index.html':'tools.mcp','/plugin-draft/d':'tools.mcp','/app-ui/a/index.html':'lead.codex',
    '/api/file?agent=agent&path=deliverable.html':'local','/api/fs/dirstat':'tools.shell',
    '/api/channels/events?cursor=0':'local','/api/channels/telegram/connect':'channels'};
  for (const [p, cls] of Object.entries(cases)) assert.equal(Policy.classifyPath(p), cls, p);
});
test('route keys come from string matchers or the literal prefix of a regex', () => {
  assert.equal(Policy.routeKey({ exact: '/api/save?x=1' }), '/api/save');
  assert.equal(Policy.routeKey({ qprefix: '/api/memory/' }), '/api/memory');
  assert.equal(Policy.routeKey({ rx: /^\/api\/hooks\/(trg_[a-z0-9]{8,24})(?:\?.*)?$/ }), '/api/hooks');
  assert.equal(Policy.routeKey({ rx: /^\/api\/channels\/telegram\/bots\/([^/]+)\/owner$/ }), '/api/channels/telegram/bots');
  assert.equal(Policy.routeKey({ qrx: /^\/shared\// }), '/shared');
  assert.equal(Policy.routeKey({}), '');
});
test('gates refuse switch families until the owner turns the switch on', () => {
  const off = switches();
  assert.equal(Policy.routeGate({ exact: '/api/memory' }, off).ok, true);
  const refused = Policy.routeGate({ exact: '/api/run' }, off);
  assert.deepEqual([refused.ok, refused.switch], [false, 'lead.codex']); assert.match(refused.error, /lead\.codex/);
  assert.equal(Policy.routeGate({ exact: '/api/run' }, switches('lead.codex')).ok, true);
  assert.equal(Policy.routeGate({ exact: '/api/channels/x' }, switches('channels.telegram')).ok, true);
  assert.equal(Policy.routeGate({ exact: '/api/credits' }, switches('lead.codex')).ok, false);
  assert.equal(Policy.routeGate({ exact: '/api/nope' }, off).ok, false);
});
test('pre-gate: static GET only, external API and webhooks refused', () => {
  const off = switches();
  assert.equal(Policy.preGate('GET', '/', off).ok, true);
  assert.equal(Policy.preGate('POST', '/', off).ok, false);
  assert.equal(Policy.preGate('POST', '/v1/chat/completions', off).ok, false);
  assert.equal(Policy.preGate('POST', '/api/hooks/trg_abcdefgh', off).ok, false);
  assert.equal(Policy.preGate('GET', '/workshop-run/x/index.html', off).ok, false);
  assert.equal(Policy.preGate('POST', '/api/ultra/runtime', off).ok, true);
  assert.equal(Policy.preGate('GET', '/health', off).ok, true);
});
test('worker limit follows the concurrency value', () => {
  const gate = Policy.makeGate(() => 3); gate.enter('research'); gate.enter('sales');
  assert.throws(() => gate.enter('research'), /already/); gate.enter('qa');
  assert.throws(() => gate.enter('delivery'), /Only 3 preparation workers/);
  assert.throws(() => Policy.assertModelAllowed(), /disabled/);
});
test('runtime paths cannot overlap business records', () => {
  assert.equal(Policy.runtimeAllowed('/home/adem/1ultra','/home/adem/1ultra/data'),false);
  assert.equal(Policy.runtimeAllowed('/tmp/fixture','/tmp/fixture/data'),false);
  assert.equal(Policy.runtimeAllowed('/home/adem/1ultra','/home/adem/1ultra/runs/station-runtime'),true);
  assert.equal(Policy.runtimeAllowed('/tmp/fixture','/tmp/fixture/runtime'),true);
});
test('only a deliberate 1Ultra launch uses the real runtime; isolated callers keep their own workspace and port', () => {
  const scratch = () => '/tmp/1ultra-runtime-scratch';
  assert.equal(Policy.resolveRuntime({ ULTRA_ROOT: '/home/adem/1ultra' }, '/home/adem/1ultra', scratch), '/home/adem/1ultra/runs/station-runtime');
  assert.equal(Policy.resolveRuntime({ ULTRA_ROOT: '/r', ULTRA_RUNTIME: '/tmp/a', STARNET_WORKSPACES: '/tmp/b' }, '/r', scratch), '/tmp/a');
  assert.equal(Policy.resolveRuntime({ SKYNET_WORKSPACES: '/tmp/t1/ws' }, '/home/adem/1ultra', scratch), '/tmp/t1/ws');
  assert.equal(Policy.resolveRuntime({ STARNET_WORKSPACES: '/tmp/t2/ws', ULTRA_ROOT: '/home/adem/1ultra' }, '/home/adem/1ultra', scratch), '/tmp/t2/ws');
  assert.equal(Policy.resolveRuntime({}, '/home/adem/1ultra', scratch), '/tmp/1ultra-runtime-scratch');
  assert.equal(Policy.resolvePort({ SKYNET_PORT: '9123' }), '9123');
  assert.equal(Policy.resolvePort({ ULTRA_PORT: '8550', STARNET_PORT: '9' }), '8550');
  assert.equal(Policy.resolvePort({}), '8541');
});
const fsx = require('node:fs'), osx = require('node:os'), px = require('node:path');
test('each provider needs its own switch; Starnet cloud never runs', () => {
  const on = (...ids) => ({ isOn: id => ids.includes(id) });
  assert.equal(Policy.providerSwitch('codex'), 'lead.codex');
  assert.equal(Policy.providerSwitch('custom'), 'crew.freellmapi');
  assert.equal(Policy.providerSwitch('openai-compatible'), 'crew.freellmapi');
  assert.equal(Policy.providerSwitch('anthropic'), 'providers.anthropic');
  assert.equal(Policy.providerSwitch('starnet'), null);
  assert.deepEqual(Policy.providerAllowed('codex', on('lead.codex')), { ok: true, switch: 'lead.codex' });
  const off = Policy.providerAllowed('codex', on());
  assert.equal(off.ok, false); assert.match(off.error, /lead\.codex/);
  assert.equal(Policy.providerAllowed('starnet', on('lead.codex')).ok, false);
  assert.equal(Policy.providerAllowed('', on('lead.codex')).ok, false);
  assert.equal(Policy.providerAllowed('custom', { isOn: () => { throw new Error('broken store'); } }).ok, false);
});
test('the emergency stop refuses every run', () => {
  assert.deepEqual(Policy.admitRun({ halted: false }), { ok: true });
  const r = Policy.admitRun({ halted: true });
  assert.equal(r.ok, false); assert.match(r.error, /Emergency stop/);
});
test('outbound targets follow the switches and never reach private addresses', () => {
  const on = (...ids) => id => ids.includes(id);
  const t = (host, port, protocol = 'https:') => ({ host, port, protocol });
  const opts = { freellmapiPort: 3001 };
  assert.equal(Policy.allowedTarget(t('chatgpt.com'), on(), opts), false);
  assert.equal(Policy.allowedTarget(t('chatgpt.com'), on('lead.codex'), opts), true);
  assert.equal(Policy.allowedTarget(t('auth.openai.com'), on('lead.codex'), opts), true);
  assert.equal(Policy.allowedTarget(t('www.mojeek.com'), on('lead.codex'), opts), false);
  assert.equal(Policy.allowedTarget(t('www.mojeek.com'), on('tools.web'), opts), true);
  assert.equal(Policy.allowedTarget(t('127.0.0.1', 3001, 'http:'), on(), opts), false);
  assert.equal(Policy.allowedTarget(t('127.0.0.1', 3001, 'http:'), on('crew.freellmapi'), opts), true);
  assert.equal(Policy.allowedTarget(t('localhost', 3001, 'http:'), on('crew.freellmapi'), opts), true);
  assert.equal(Policy.allowedTarget(t('127.0.0.1', 8541, 'http:'), on('crew.freellmapi', 'tools.web'), opts), false);
  for (const h of ['192.168.1.10', '10.0.0.5', '172.20.1.1', '169.254.169.254', '::1', 'fd00::1', 'metadata.google.internal'])
    assert.equal(Policy.allowedTarget(t(h, 80, 'http:'), on('tools.web', 'lead.codex'), opts), false, h);
  assert.equal(Policy.allowedTarget(t('93.184.216.34', 443), on('tools.web'), opts), true);
});
test('agents cannot reach 1Ultra project files, except their own runtime', () => {
  const root = fsx.mkdtempSync(px.join(osx.tmpdir(), 'ultra-root-'));
  const runtime = px.join(root, 'runs', 'station-runtime');
  fsx.mkdirSync(px.join(runtime, 'agent'), { recursive: true }); fsx.mkdirSync(px.join(root, 'data'));
  Policy.setProtectedRoots({ root, runtime });
  try {
    assert.match(Policy.protectedPathReason(px.join(root, 'data', 'leads.json')), /off-limits/);
    assert.match(Policy.protectedPathReason(root), /off-limits/);
    assert.equal(Policy.protectedPathReason(px.join(runtime, 'agent', 'note.md')), null);
    fsx.symlinkSync(px.join(root, 'data'), px.join(runtime, 'agent', 'link'));
    assert.match(Policy.protectedPathReason(px.join(runtime, 'agent', 'link', 'leads.json')), /off-limits/);
    assert.equal(Policy.protectedPathReason(osx.tmpdir()), null);
    assert.match(Policy.blessRefusal(root), /1Ultra project/);
    assert.match(Policy.blessRefusal(px.dirname(root)), /1Ultra project/);
    assert.match(Policy.blessRefusal(px.join(root, 'data')), /1Ultra project/);
    assert.equal(Policy.blessRefusal(fsx.mkdtempSync(px.join(osx.tmpdir(), 'ultra-other-'))), null);
  } finally { Policy.setProtectedRoots(null); }
  assert.equal(Policy.protectedPathReason(px.join(root, 'data')), null, 'no roots set: upstream behaviour unchanged');
});
test('provider routes open while the lead or crew switch is on', () => {
  const on = (...ids) => ({ isOn: id => ids.includes(id) });
  assert.equal(Policy.routeGate({ exact: '/api/providers/engine-key' }, on()).ok, false);
  assert.equal(Policy.routeGate({ exact: '/api/providers/engine-key' }, on('lead.codex')).ok, true);
  assert.equal(Policy.routeGate({ exact: '/api/key' }, on('crew.freellmapi')).ok, true);
});

function withProtectedCache(check) {
  const root = fsx.mkdtempSync(px.join(osx.tmpdir(), 'ultra-cache-root-'));
  fsx.mkdirSync(px.join(root, '..cache'));
  Policy.setProtectedRoots({ root });
  try { check(root); }
  finally { Policy.setProtectedRoots(null); fsx.rmSync(root, { recursive: true, force: true }); }
}
test('project files in two-dot child directories remain off-limits', () => {
  withProtectedCache(root => {
    assert.match(Policy.protectedPathReason(px.join(root, '..cache', 'file')), /off-limits/);
  });
});
test('two-dot child directories cannot be blessed as projects', () => {
  withProtectedCache(root => {
    assert.match(Policy.blessRefusal(px.join(root, '..cache')), /1Ultra project/);
  });
});
test('host canonicalization normalizes case, trailing dots and IPv4/IPv6 spellings', () => {
  assert.equal(Policy.canonicalHost('LOCALHOST.'), 'localhost');
  assert.equal(Policy.canonicalHost('127.1'), '127.0.0.1');
  assert.equal(Policy.canonicalHost('2130706433'), '127.0.0.1');
  assert.equal(Policy.canonicalHost('0:0:0:0:0:0:0:1'), '::1');
});
for (const host of ['localhost.', '127.1', '2130706433', '0x7f.1', '0177.0.0.1', '0:0:0:0:0:0:0:1', '[::ffff:7f00:1]']) {
  test('private host spelling stays blocked with web and lead on: ' + host, () => {
    const on = (...ids) => id => ids.includes(id);
    assert.equal(Policy.allowedTarget({ host, port: 443, protocol: 'https:' }, on('tools.web', 'lead.codex'), { freellmapiPort: 3001 }), false);
    assert.equal(Policy.isPrivateHost(host), true);
  });
}
test('FreeLLMAPI accepts canonical loopback aliases only with its crew switch', () => {
  const on = (...ids) => id => ids.includes(id);
  const target = { host: '127.1', port: 3001, protocol: 'http:' };
  const opts = { freellmapiPort: 3001 };
  assert.equal(Policy.allowedTarget(target, on('crew.freellmapi'), opts), true);
  assert.equal(Policy.allowedTarget(target, on('tools.web', 'lead.codex'), opts), false);
});
test('invalid numeric and IPv6 hosts fail closed during canonicalization', () => {
  const on = (...ids) => id => ids.includes(id);
  for (const host of ['999.1', '4294967296', '::gg', '1:2:3']) {
    assert.equal(Policy.canonicalHost(host), '', host);
    assert.equal(Policy.isPrivateHost(host), true, host);
    assert.equal(Policy.allowedTarget({ host, port: 443, protocol: 'https:' }, on('tools.web', 'lead.codex', 'crew.freellmapi'), { freellmapiPort: 3001 }), false, host);
  }
});
