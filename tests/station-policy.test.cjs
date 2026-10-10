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
    '/plugin-ui/p/index.html':'tools.mcp','/plugin-draft/d':'tools.mcp','/app-ui/a/index.html':'lead.codex'};
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
