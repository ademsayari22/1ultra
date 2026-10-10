const assert = require('node:assert/strict'), test = require('node:test'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const POLICY = path.join(__dirname, '../station/ultra-policy.js');
// Runs in a child process: install() replaces process-wide network functions. The "real" functions are stubbed
// BEFORE install, so an allowed call returns a REAL marker without opening any socket.
const CHILD = `
const P = require(process.argv[1]); const on = new Set(JSON.parse(process.argv[2]));
globalThis.fetch = async () => 'REAL';
const http = require('node:http'), https = require('node:https'), net = require('node:net');
http.request = () => 'REAL'; http.get = () => 'REAL'; https.request = () => 'REAL'; https.get = () => 'REAL';
net.Socket.prototype.connect = function () { return 'REAL'; };
P.install(require('node:os').tmpdir() + '/ultra-outbound', { isOn: id => on.has(id) }, { freellmapiPort: 3001 });
(async () => { const out = {};
  const run = async (k, f) => { try { out[k] = await f(); } catch (e) { out[k] = e.code || e.message; } };
  await run('codex', () => fetch('https://chatgpt.com/backend-api/codex/models'));
  await run('auth', () => https.request('https://auth.openai.com/oauth/token'));
  await run('crew', () => fetch(new URL('http://127.0.0.1:3001/v1/models')));
  await run('crewSocket', () => new net.Socket().connect({ host: '127.0.0.1', port: 3001 }));
  await run('station', () => fetch('http://127.0.0.1:8541/api/health'));
  await run('web', () => fetch({ url: 'https://www.mojeek.com/search?q=sfax' }));
  await run('webIp', () => new net.Socket().connect(443, '93.184.216.34'));
  await run('private', () => fetch('http://192.168.1.10/'));
  await run('metadata', () => http.get('http://169.254.169.254/latest'));
  await run('ipc', () => new net.Socket().connect('/tmp/ultra-test.sock'));
  await run('spawn', () => require('node:child_process').spawn('true'));
  console.log(JSON.stringify(out)); })();`;
const probe = (...on) => JSON.parse(execFileSync(process.execPath, ['-e', CHILD, POLICY, JSON.stringify(on)], { encoding: 'utf8' }).trim().split('\n').pop());
const B = 'ULTRA_OUTBOUND_BLOCKED';
test('with every switch off nothing leaves the machine', () => {
  const r = probe();
  for (const k of ['codex', 'auth', 'crew', 'crewSocket', 'station', 'web', 'webIp', 'private', 'metadata']) assert.equal(r[k], B, k);
  assert.equal(r.ipc, 'REAL', 'local IPC sockets are not network'); assert.match(String(r.spawn), /disabled/);
});
test('lead.codex opens only the Codex hosts', () => {
  const r = probe('lead.codex');
  assert.equal(r.codex, 'REAL'); assert.equal(r.auth, 'REAL');
  for (const k of ['crew', 'web', 'webIp', 'private', 'station']) assert.equal(r[k], B, k);
});
test('crew.freellmapi opens only FreeLLMAPI on 127.0.0.1:3001', () => {
  const r = probe('crew.freellmapi');
  assert.equal(r.crew, 'REAL'); assert.equal(r.crewSocket, 'REAL');
  for (const k of ['codex', 'station', 'web', 'private']) assert.equal(r[k], B, k);
});
test('tools.web opens public hosts but never private ones', () => {
  const r = probe('tools.web');
  assert.equal(r.web, 'REAL'); assert.equal(r.webIp, 'REAL'); assert.equal(r.codex, 'REAL');
  for (const k of ['private', 'metadata', 'station', 'crew']) assert.equal(r[k], B, k);
});

const CONNECT_CHILD = `
const assert = require('node:assert/strict'), P = require(process.argv[1]), net = require('node:net');
let received;
net.Socket.prototype.connect = function (...args) { received = args; return args[0]; };
P.install(require('node:os').tmpdir() + '/ultra-outbound', { isOn: id => ['tools.web', 'crew.freellmapi'].includes(id) }, { freellmapiPort: 3001 });
`;
function checkConnect(code) {
  execFileSync(process.execPath, ['-e', CONNECT_CHILD + code, POLICY], { encoding: 'utf8' });
}
test('socket hostname options receive a guarded lookup; IP options are unchanged', () => {
  checkConnect(`
const hostname = new net.Socket().connect({ host: 'www.mojeek.com', port: 443 });
assert.equal(typeof hostname, 'object');
assert.equal(hostname.host, 'www.mojeek.com'); assert.equal(hostname.port, 443);
assert.equal(typeof hostname.lookup, 'function');
const ipOptions = { host: '93.184.216.34' };
const ip = new net.Socket().connect(ipOptions);
assert.equal(ip, ipOptions); assert.equal(Object.hasOwn(ip, 'lookup'), false);
`);
});
test('socket port and host arguments become guarded options without losing the callback', () => {
  checkConnect(`
const callback = () => {};
const options = new net.Socket().connect(443, 'www.mojeek.com', callback);
assert.equal(options.host, 'www.mojeek.com'); assert.equal(options.port, 443);
assert.equal(typeof options.lookup, 'function'); assert.equal(received[1], callback);
const normalized = new net.Socket().connect([{ host: 'www.mojeek.com', port: 443 }, callback]);
assert.equal(typeof normalized.lookup, 'function'); assert.equal(received[1], callback);
`);
});
test('socket guards preserve caller lookups and FreeLLMAPI loopback options', () => {
  checkConnect(`
const lookup = () => {}, custom = { host: 'www.mojeek.com', port: 443, lookup };
assert.equal(new net.Socket().connect(custom), custom);
assert.equal(received[0].lookup, lookup);
const local = { host: 'localhost', port: 3001 };
assert.equal(new net.Socket().connect(local), local);
assert.equal(Object.hasOwn(local, 'lookup'), false);
`);
});
