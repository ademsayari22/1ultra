'use strict';
const deny = () => { throw new Error('Live models and external connections are disabled in this campaign.'); };
// Every Starnet API family by path prefix. 'local' = station state on this machine only. A switch id = answers only
// while the owner has that switch on ('channels'/'providers' = any switch of that family). 'blocked' = not part of
// 1Ultra. No match = 'unclassified' and refused. policy.install() guards outbound calls with the same switches.
const ROUTE_CLASSES = Object.freeze({
  '/api/activity':'local','/api/agent-skills':'local','/api/agents':'local','/api/attachments':'local','/api/budget':'local',
  '/api/cancel':'local','/api/checkpoint':'local','/api/config':'local','/api/consent':'local','/api/deliverables':'local',
  '/api/diagnostics':'local','/api/dossier':'local','/api/goals':'local','/api/groups':'local','/api/halt':'local',
  '/api/harness':'local','/api/health':'local','/api/journey':'local','/api/lifecycle':'local','/api/limits':'local',
  '/api/lineage':'local','/api/memory':'local','/api/notebook':'local','/api/permissions':'local','/api/personalization':'local',
  '/api/projects':'local','/api/quests':'local','/api/recipes':'local','/api/recommendations':'local','/api/roster':'local',
  '/api/run-recoveries':'local','/api/runs':'local','/api/runtime':'local','/api/save':'local','/api/session':'local',
  '/api/skills':'local','/api/state':'local','/api/station':'local','/api/task-briefs':'local','/api/threads':'local',
  '/api/toolsets':'local','/api/transcript':'local','/api/userprops':'local','/api/version':'local','/api/widgets':'local',
  '/api/workspace':'local','/shared':'local','/view':'local',
  '/api/file':'local', // Outbox: serves files jailed to an agent workspace or an owner-approved project folder
  '/workshop-run':'lead.codex','/app-ui':'lead.codex','/api/agent':'lead.codex','/api/apps':'lead.codex','/api/fallback':'lead.codex','/api/growth':'lead.codex','/api/insights':'lead.codex',
  '/api/line-jobs':'lead.codex','/api/model-tiers':'lead.codex','/api/models':'lead.codex','/api/overseer':'lead.codex',
  '/api/realtime':'lead.codex','/api/routing':'lead.codex','/api/run':'lead.codex','/api/scout':'lead.codex','/api/slash':'lead.codex',
  '/api/study':'lead.codex','/api/subagents':'lead.codex','/api/summon':'lead.codex','/api/workshop':'lead.codex','/api/auth/codex':'lead.codex',
  '/api/auth':'providers','/api/key':'providers','/api/providers':'providers',
  '/api/skill-exchange':'skills.market','/api/skill-market':'skills.market',
  '/api/channels':'channels',
  '/api/channels/events':'local', // the station's own server→page event bridge; connecting a channel stays switch-gated
  '/api/cron':'cron','/api/hooks':'cron','/api/loops':'cron',
  '/api/autonomy':'nightshift','/api/away':'nightshift','/api/discovery':'nightshift','/api/nightshift':'nightshift','/api/workflow-takeovers':'nightshift',
  '/api/connectors':'tools.mcp','/api/plugins':'tools.mcp','/api/servicekeys':'tools.mcp','/plugin-ui':'tools.mcp','/plugin-draft':'tools.mcp',
  '/api/local-voice':'voice','/api/stt':'voice','/api/tts':'voice',
  '/api/execution':'tools.shell','/api/execution-profiles':'tools.shell','/api/fs':'tools.shell','/api/pickpath':'tools.shell',
  '/api/computer-control':'tools.computer','/api/browser':'tools.browser',
  '/api/credits':'blocked','/api/dev':'blocked','/api/remote':'blocked','/api/spotify':'blocked','/api/update':'blocked',
});
function prefixMatches(p, prefix) { return p === prefix || p.startsWith(prefix + '/') || p.startsWith(prefix + '?'); }
function classifyPath(p) {
  let best = null;
  for (const prefix of Object.keys(ROUTE_CLASSES)) if (prefixMatches(p, prefix) && (!best || prefix.length > best.length)) best = prefix;
  return best ? ROUTE_CLASSES[best] : 'unclassified';
}
function literalPrefix(rx) {
  const s = rx.source.replace(/^\^/, ''); let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { const n = s[i + 1]; if (n === '/' || n === '-' || n === '.') { out += n; i++; continue; } break; }
    if ('([{?*+.|$'.includes(c)) break;
    out += c;
  }
  return out.replace(/\/+$/, '');
}
function routeKey(r) {
  if (!r) return '';
  for (const k of ['exact', 'qsplit', 'prefix', 'qprefix']) if (typeof r[k] === 'string') return r[k].split('?')[0].replace(/\/+$/, '');
  const rx = r.rx || r.qrx;
  return rx instanceof RegExp ? literalPrefix(rx) : '';
}
function gate(cls, switches) {
  if (cls === 'local') return { ok: true, cls };
  if (cls === 'blocked' || cls === 'unclassified') return { ok: false, cls, error: 'This Starnet feature is not part of 1Ultra.' };
  const isOn = id => { try { return switches.isOn(id) === true; } catch (_) { return false; } };
  const open = cls === 'providers' ? (isOn('providers') || isOn('lead.codex') || isOn('crew.freellmapi')) : isOn(cls);
  if (open) return { ok: true, cls };
  return { ok: false, cls, switch: cls, error: 'Turn on "' + cls + '" in 1Ultra switches first.' };
}
function routeGate(r, switches) { return gate(classifyPath(routeKey(r)), switches); }
function preGate(method, url, switches) {
  const p = String(url || '/').split('?')[0];
  if (p === '/v1' || p.startsWith('/v1/')) return gate('blocked', switches);
  if (p.startsWith('/api/hooks/')) return gate('cron', switches);
  if (p.startsWith('/workshop-run/')) return gate('lead.codex', switches);
  if (p === '/health') return { ok: method === 'GET', cls: 'local' };
  if (p === '/api' || p.startsWith('/api/')) return { ok: true, cls: 'table' };
  return (method === 'GET' || method === 'HEAD') ? { ok: true, cls: 'static' } : { ok: false, cls: 'static', error: 'Static files are read-only.' };
}
// Which owner switch a model provider needs: Codex is the lead, the custom OpenAI-compatible endpoint is FreeLLMAPI's crew,
// every other provider has its own switch. Starnet's own paid cloud ('starnet') is never part of 1Ultra.
function providerSwitch(providerId) {
  const id = String(providerId || '').trim().toLowerCase();
  if (!id || id === 'starnet') return null;
  if (id === 'codex') return 'lead.codex';
  if (id === 'custom' || id === 'openai-compatible' || id === 'local') return 'crew.freellmapi';
  return 'providers.' + id;
}
function providerAllowed(providerId, switches) {
  const sw = providerSwitch(providerId);
  if (!sw) return { ok: false, error: 'This model provider is not part of 1Ultra.' };
  let on = false; try { on = switches.isOn(sw) === true; } catch (_) { on = false; }
  return on ? { ok: true, switch: sw } : { ok: false, switch: sw, error: 'Turn on "' + sw + '" in 1Ultra switches first.' };
}
function admitRun(state) {
  if (state && state.halted) return { ok: false, error: 'Emergency stop is active. Resume it in 1Ultra before starting agent work.' };
  return { ok: true };
}
const CODEX_HOSTS = ['chatgpt.com', 'auth.openai.com'];
function canonicalHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (/^(0x[0-9a-f]*|\d+)(\.(0x[0-9a-f]*|\d+)){0,3}$/i.test(h)) {
    try { return new URL('http://' + h).hostname; }
    catch (_) { return ''; }
  }
  if (h.includes(':')) {
    try { return new URL('http://[' + h + ']').hostname.replace(/^\[|\]$/g, ''); }
    catch (_) { return ''; }
  }
  return h;
}
function isPrivateHost(host) {
  const h = canonicalHost(host);
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.') && !h.includes(':')) return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) { const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224; }
  if (h.includes(':')) return h === '::' || h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  return false;
}
// May this process open a connection to target? FreeLLMAPI is the one local service agents may reach.
function allowedTarget(target, isOn, opts = {}) {
  const host = canonicalHost(target && target.host);
  const port = Number(target && target.port) || ((target && target.protocol) === 'http:' ? 80 : 443);
  const on = id => { try { return isOn(id) === true; } catch (_) { return false; } };
  if ((host === '127.0.0.1' || host === 'localhost' || host === '::1') && port === Number(opts.freellmapiPort || 3001)) return on('crew.freellmapi');
  if (isPrivateHost(host)) return false;
  if (CODEX_HOSTS.some(h => host === h || host.endsWith('.' + h))) return on('lead.codex') || on('tools.web');
  return on('tools.web');
}
function makeGuardedLookup(baseLookup, isOn, opts = {}) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    options = options || {};
    baseLookup(hostname, { ...options, all: true }, (err, list) => {
      if (err) return callback(err);
      // The socket wrapper already authorized the hostname; DNS adds the private-address check.
      if (list.some(a => {
        const ok = !isPrivateHost(a.address) || allowedTarget({ host: a.address, port: opts.port, protocol: opts.protocol }, isOn, opts);
        return !ok;
      }))
        return callback(Object.assign(new Error('1Ultra blocked an outbound connection to ' + hostname + '. Turn on the matching switch.'), { code: 'ULTRA_OUTBOUND_BLOCKED' }));
      return options.all ? callback(null, list) : callback(null, list[0].address, list[0].family);
    });
  };
}
// The 1Ultra project folder is never an agent's to read or write; only the station runtime inside it is.
let protectedRoots = null;
function setProtectedRoots(roots) {
  const path = require('node:path');
  protectedRoots = roots && roots.root ? { root: path.resolve(roots.root), runtime: path.resolve(roots.runtime || path.join(roots.root, 'runs', 'station-runtime')) } : null;
}
function kernelResolve(p) {
  const path = require('node:path'), fs = require('node:fs');
  const raw = String(p);
  const abs = path.isAbsolute(raw) ? raw : process.cwd() + path.sep + raw;
  let cur = path.parse(abs).root || path.sep, missing = false;
  for (const seg of abs.split(path.sep).filter(Boolean)) {
    if (seg === '.') continue;
    if (seg === '..') { cur = path.dirname(cur); continue; }
    const next = path.join(cur, seg);
    if (!missing) { try { cur = fs.realpathSync(next); continue; } catch (_) { missing = true; } }
    cur = next;
  }
  return cur;
}
function inside(child, parent) {
  const path = require('node:path');
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}
function protectedPathReason(p) {
  if (!protectedRoots || !p) return null;
  const path = require('node:path');
  const runtimeReal = kernelResolve(protectedRoots.runtime), rootReal = kernelResolve(protectedRoots.root);
  for (const candidate of [path.resolve(String(p)), kernelResolve(p)]) {
    if (inside(candidate, protectedRoots.runtime) || inside(candidate, runtimeReal)) continue;
    if (inside(candidate, protectedRoots.root) || inside(candidate, rootReal)) return '1Ultra project files are off-limits to agents: ' + candidate;
  }
  return null;
}
function blessRefusal(dir) {
  if (!protectedRoots || !dir) return null;
  const d = kernelResolve(dir), root = kernelResolve(protectedRoots.root);
  if (inside(d, root) || inside(root, d)) return 'A project folder may not be, contain or sit inside the 1Ultra project (' + root + ').';
  return null;
}
function makeGate(limit = () => 2) { const desks = new Set(); return {
  enter(desk) { if (desks.has(desk)) throw new Error('This desk already has an active job.'); const max = limit(); if (desks.size >= max) throw new Error('Only ' + max + ' preparation workers may run.'); desks.add(desk); },
  leave(desk) { desks.delete(desk); }, active() { return [...desks]; }
}; }
// The owner's runtime (runs/station-runtime) is used only by a deliberate 1Ultra launch (ULTRA_ROOT set by scripts/station.py
// and the fixture checks). An explicit workspace (ULTRA_RUNTIME, or Starnet's own STARNET_/SKYNET_WORKSPACES used by its tests)
// wins; any other start gets a scratch runtime, so a stray `node sidecar/index.js` can never write the owner's station files.
function resolveRuntime(env, root, makeScratch) {
  const path = require('node:path');
  const explicit = env.ULTRA_RUNTIME || env.STARNET_WORKSPACES || env.SKYNET_WORKSPACES;
  if (explicit) return path.resolve(explicit);
  return env.ULTRA_ROOT ? path.join(root, 'runs', 'station-runtime') : makeScratch();
}
function resolvePort(env) { return String(env.ULTRA_PORT || env.STARNET_PORT || env.SKYNET_PORT || '8541'); }
function runtimeAllowed(root, runtime) {
  const path = require('node:path');
  if (runtime === path.join(root, 'runs', 'station-runtime')) return true;
  return runtime.startsWith('/tmp/') && (runtime === path.join(root, 'runtime') && root.startsWith('/tmp/') || !runtime.startsWith(root + path.sep));
}
function urlTarget(input) {
  const raw = typeof input === 'string' || input instanceof URL ? String(input) : (input && input.url) || '';
  try { const u = new URL(raw); return { host: u.hostname, port: u.port, protocol: u.protocol }; } catch (_) { return { host: '', port: 0, protocol: '' }; }
}
function requestTarget(args, protocol) {
  const a = args[0];
  if (typeof a === 'string' || a instanceof URL) {
    const target = urlTarget(a);
    const o = args[1] && typeof args[1] === 'object' ? args[1] : {};
    if (o.socketPath) return null;
    target.host = o.hostname || o.host || target.host;
    if (Object.hasOwn(o, 'port')) target.port = o.port;
    if (Object.hasOwn(o, 'protocol')) target.protocol = o.protocol;
    return target;
  }
  const o = a && typeof a === 'object' ? a : {};
  if (o.socketPath) return null;
  return { host: o.hostname || o.host || 'localhost', port: o.port, protocol: o.protocol || protocol };
}
function connectTarget(args) {
  const a = args[0];
  if (Array.isArray(a)) return connectTarget(a);
  if (a && typeof a === 'object') return a.path ? null : { host: a.host || 'localhost', port: a.port };
  if (typeof a === 'number' || /^\d+$/.test(String(a))) return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: Number(a) };
  return null; // a string path is a local IPC socket
}
function install(runtime, switches, opts = {}) {
  const port = resolvePort(process.env);
  for (const key of Object.keys(process.env)) if (/^(STARNET|SKYNET)_/.test(key)) delete process.env[key];
  Object.assign(process.env, { STARNET_WORKSPACES: runtime, STARNET_PORT: port,
    STARNET_LIVE_PRICES: '0', STARNET_QUEST_REFRESH: '0', STARNET_CRON_ENABLED: '0', STARNET_NIGHTSHIFT_ENABLED: '0',
    STARNET_SKILL_REVIEW: '0', STARNET_APP_VERSION: '1Ultra-local', STARNET_BUILD_DESCRIBE: '54899e5+1ultra' });
  const isOn = id => { try { return !!(switches && switches.isOn(id)); } catch (_) { return false; } };
  const check = target => {
    if (target && !allowedTarget(target, isOn, opts))
      throw Object.assign(new Error('1Ultra blocked an outbound connection to ' + (target.host || 'an unknown host') + '. Turn on the matching switch.'), { code: 'ULTRA_OUTBOUND_BLOCKED' });
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => { check(urlTarget(input)); return realFetch(input, init); };
  for (const [mod, protocol] of [['node:http', 'http:'], ['node:https', 'https:']]) {
    const m = require(mod);
    for (const fn of ['request', 'get']) { const real = m[fn]; m[fn] = function (...args) { check(requestTarget(args, protocol)); return real.apply(this, args); }; }
  }
  const net = require('node:net'); const realConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const target = connectTarget(args); check(target);
    if (target && net.isIP(target.host) === 0) {
      const callArgs = Array.isArray(args[0]) ? args[0] : args;
      const hasOptions = callArgs[0] && typeof callArgs[0] === 'object';
      const options = hasOptions ? callArgs[0] : { host: target.host, port: target.port };
      const rest = callArgs.slice(hasOptions || typeof callArgs[1] !== 'string' ? 1 : 2);
      args = [{ ...options, lookup: makeGuardedLookup(options.lookup || require('node:dns').lookup, isOn, { ...opts, port: target.port, protocol: target.protocol }) }, ...rest];
    }
    return realConnect.apply(this, args);
  };
  const cp = require('node:child_process');
  for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[method] = deny;
}
module.exports = { ROUTE_CLASSES, classifyPath, routeKey, gate, routeGate, preGate, makeGate, resolveRuntime, resolvePort, runtimeAllowed, install, assertModelAllowed: deny, providerSwitch, providerAllowed, admitRun, allowedTarget, canonicalHost, isPrivateHost, makeGuardedLookup, setProtectedRoots, protectedPathReason, blessRefusal };
