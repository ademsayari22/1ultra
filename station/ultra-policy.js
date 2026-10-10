'use strict';
const deny = () => { throw new Error('Live models and external connections are disabled in this campaign.'); };
// Every Starnet API family by path prefix. 'local' = station state on this machine only. A switch id = answers only
// while the owner has that switch on ('channels'/'providers' = any switch of that family). 'blocked' = not part of
// 1Ultra. No match = 'unclassified' and refused. policy.install() still blocks all outbound calls underneath.
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
  '/workshop-run':'lead.codex','/app-ui':'lead.codex','/api/agent':'lead.codex','/api/apps':'lead.codex','/api/fallback':'lead.codex','/api/growth':'lead.codex','/api/insights':'lead.codex',
  '/api/line-jobs':'lead.codex','/api/model-tiers':'lead.codex','/api/models':'lead.codex','/api/overseer':'lead.codex',
  '/api/realtime':'lead.codex','/api/routing':'lead.codex','/api/run':'lead.codex','/api/scout':'lead.codex','/api/slash':'lead.codex',
  '/api/study':'lead.codex','/api/subagents':'lead.codex','/api/summon':'lead.codex','/api/workshop':'lead.codex','/api/auth/codex':'lead.codex',
  '/api/auth':'providers','/api/key':'providers','/api/providers':'providers',
  '/api/skill-exchange':'skills.market','/api/skill-market':'skills.market',
  '/api/channels':'channels',
  '/api/cron':'cron','/api/hooks':'cron','/api/loops':'cron',
  '/api/autonomy':'nightshift','/api/away':'nightshift','/api/discovery':'nightshift','/api/nightshift':'nightshift','/api/workflow-takeovers':'nightshift',
  '/api/connectors':'tools.mcp','/api/plugins':'tools.mcp','/api/servicekeys':'tools.mcp','/plugin-ui':'tools.mcp','/plugin-draft':'tools.mcp',
  '/api/local-voice':'voice','/api/stt':'voice','/api/tts':'voice',
  '/api/execution':'tools.shell','/api/execution-profiles':'tools.shell','/api/file':'tools.shell','/api/fs':'tools.shell','/api/pickpath':'tools.shell',
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
  if (switches.isOn(cls)) return { ok: true, cls };
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
function makeGate(limit = () => 2) { const desks = new Set(); return {
  enter(desk) { if (desks.has(desk)) throw new Error('This desk already has an active job.'); const max = limit(); if (desks.size >= max) throw new Error('Only ' + max + ' preparation workers may run.'); desks.add(desk); },
  leave(desk) { desks.delete(desk); }, active() { return [...desks]; }
}; }
function runtimeAllowed(root, runtime) {
  const path = require('node:path');
  if (runtime === path.join(root, 'runs', 'station-runtime')) return true;
  return runtime.startsWith('/tmp/') && (runtime === path.join(root, 'runtime') && root.startsWith('/tmp/') || !runtime.startsWith(root + path.sep));
}
function install(runtime) {
  for (const key of Object.keys(process.env)) if (/^(STARNET|SKYNET)_/.test(key)) delete process.env[key];
  Object.assign(process.env, { STARNET_WORKSPACES: runtime, STARNET_PORT: process.env.ULTRA_PORT || '8541',
    STARNET_LIVE_PRICES: '0', STARNET_QUEST_REFRESH: '0', STARNET_CRON_ENABLED: '0', STARNET_NIGHTSHIFT_ENABLED: '0',
    STARNET_SKILL_REVIEW: '0', STARNET_APP_VERSION: '1Ultra-local', STARNET_BUILD_DESCRIBE: '54899e5+1ultra' });
  // Phase 1: no outbound connection of any kind. Later phases allow specific hosts per switch.
  globalThis.fetch = async () => deny();
  for (const mod of ['node:http', 'node:https']) { const m = require(mod); m.request = deny; m.get = deny; }
  require('node:net').Socket.prototype.connect = deny;
  const cp = require('node:child_process');
  for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[method] = deny;
}
module.exports = { ROUTE_CLASSES, classifyPath, routeKey, gate, routeGate, preGate, makeGate, runtimeAllowed, install, assertModelAllowed: deny };
