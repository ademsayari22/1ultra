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
test('socket custom lookups allow public address results', () => {
  checkConnect(`
const lookup = (hostname, options, callback) => {
  assert.equal(hostname, 'www.mojeek.com');
  if (options.all) callback(null, [{ address: '93.184.216.34', family: 4 }]);
  else callback(null, '93.184.216.34', 4);
};
const options = new net.Socket().connect({ host: 'www.mojeek.com', port: 443, lookup });
let result;
options.lookup('www.mojeek.com', { all: false }, (...args) => { result = args; });
assert.deepEqual(result, [null, '93.184.216.34', 4]);
`);
});
test('socket custom lookups refuse private address results', () => {
  checkConnect(`
const lookup = (hostname, options, callback) => {
  assert.equal(hostname, 'www.mojeek.com');
  if (options.all) callback(null, [{ address: '10.0.0.5', family: 4 }]);
  else callback(null, '10.0.0.5', 4);
};
const options = new net.Socket().connect({ host: 'www.mojeek.com', port: 443, lookup });
let result;
options.lookup('www.mojeek.com', { all: false }, (...args) => { result = args; });
assert.equal(result.length, 1); assert.ok(result[0] instanceof Error);
assert.equal(result[0].code, 'ULTRA_OUTBOUND_BLOCKED');
`);
});
test('socket hostname lookups guard localhost while allowing the FreeLLMAPI exception', () => {
  checkConnect(`
const local = { host: 'localhost', port: 3001 };
const options = new net.Socket().connect(local);
assert.equal(typeof options.lookup, 'function');
const lookup = (hostname, lookupOptions, callback) => {
  if (lookupOptions.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
  else callback(null, '127.0.0.1', 4);
};
const custom = new net.Socket().connect({ ...local, lookup });
let result;
custom.lookup('localhost', { all: false }, (...args) => { result = args; });
assert.deepEqual(result, [null, '127.0.0.1', 4]);
`);
});

const REQUEST_CHILD = `
const P = require(process.argv[1]), on = new Set(JSON.parse(process.argv[2]));
const http = require('node:http'), https = require('node:https');
http.request = () => 'REAL'; http.get = () => 'REAL'; https.request = () => 'REAL'; https.get = () => 'REAL';
P.install(require('node:os').tmpdir() + '/ultra-outbound', { isOn: id => on.has(id) }, JSON.parse(process.argv[3]));
const out = {};
const run = (key, f) => { try { out[key] = f(); } catch (e) { out[key] = e.code || e.message; } };
run('hostnameOut', () => https.request('https://chatgpt.com/x', { hostname: 'evil.example' }));
run('hostnameIn', () => https.request('https://www.mojeek.com/', { hostname: 'chatgpt.com' }));
run('hostOut', () => https.request('https://chatgpt.com/x', { host: 'evil.example' }));
run('hostIn', () => https.request('https://www.mojeek.com/', { host: 'chatgpt.com' }));
run('hostUrlOut', () => https.get(new URL('https://chatgpt.com/x'), { host: 'evil.example' }));
run('hostUrlIn', () => https.get(new URL('https://www.mojeek.com/'), { host: 'chatgpt.com' }));
run('optionsOnly', () => https.request({ host: 'chatgpt.com', path: '/' }));
run('crewIpv6', () => http.request({ host: '::1', port: 3001, path: '/' }));
run('webIpv6', () => https.request({ host: '2001:4860:4860::8888', path: '/' }));
run('crewPort', () => http.request('http://127.0.0.1:9/', { port: 3001 }));
run('wrongPort', () => http.get(new URL('http://127.0.0.1:3001/'), { port: 9 }));
run('ipc', () => https.request('https://chatgpt.com/x', { socketPath: '/tmp/ultra-test.sock' }));
run('privateIpc', () => http.get(new URL('http://192.168.1.10/'), { socketPath: '/tmp/ultra-test.sock' }));
run('httpsOverride', () => http.request('http://localhost/', { protocol: 'https:' }));
run('httpOverride', () => https.get(new URL('https://localhost/'), { protocol: 'http:' }));
run('callback', () => https.request('https://chatgpt.com/x', () => {}));
console.log(JSON.stringify(out));
`;
function probeRequests(on = [], opts = { freellmapiPort: 3001 }) {
  return JSON.parse(execFileSync(process.execPath, ['-e', REQUEST_CHILD, POLICY, JSON.stringify(on), JSON.stringify(opts)], { encoding: 'utf8' }).trim().split('\n').pop());
}
test('HTTP guards apply explicit hostname overrides and ignore callback arguments', () => {
  const r = probeRequests(['lead.codex']);
  assert.equal(r.hostnameOut, B); assert.equal(r.hostnameIn, 'REAL');
  assert.equal(r.callback, 'REAL', 'a callback is not an options override');
});
test('HTTP host-only overrides cannot admit an external URL with only the lead switch on', () => {
  const r = probeRequests(['lead.codex']);
  assert.equal(r.hostIn, B); assert.equal(r.hostUrlIn, B);
});
test('HTTP host-only overrides keep Codex URL destinations allowed with only the lead switch on', () => {
  const r = probeRequests(['lead.codex']);
  assert.equal(r.hostOut, 'REAL'); assert.equal(r.hostUrlOut, 'REAL');
});
test('HTTP options-only requests use the host when no hostname is supplied', () => {
  assert.equal(probeRequests(['lead.codex']).optionsOnly, 'REAL');
});
test('HTTP options-only IPv6 loopback requests require the crew switch', () => {
  assert.equal(probeRequests().crewIpv6, B);
  assert.equal(probeRequests(['crew.freellmapi']).crewIpv6, 'REAL');
});
test('HTTPS options-only public IPv6 requests require the web switch', () => {
  assert.equal(probeRequests().webIpv6, B);
  assert.equal(probeRequests(['tools.web']).webIpv6, 'REAL');
});
test('HTTP guards apply port overrides before checking the FreeLLMAPI switch', () => {
  assert.equal(probeRequests(['crew.freellmapi']).crewPort, 'REAL');
  assert.equal(probeRequests(['crew.freellmapi']).wrongPort, B);
  assert.equal(probeRequests().crewPort, B);
  assert.equal(probeRequests(['tools.web']).crewPort, B);
});
test('HTTP socket-path overrides are local IPC even when every switch is off', () => {
  const r = probeRequests();
  assert.equal(r.ipc, 'REAL'); assert.equal(r.privateIpc, 'REAL');
});
test('HTTP protocol overrides determine the effective default port', () => {
  const r = probeRequests(['crew.freellmapi'], { freellmapiPort: 443 });
  assert.equal(r.httpsOverride, 'REAL'); assert.equal(r.httpOverride, B);
});
