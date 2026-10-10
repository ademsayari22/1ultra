# Campaign crew Stage 1a: ULTRA on Codex, with the safety rails

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adem can turn on `lead.codex`, sign in with ChatGPT inside 1Ultra, and talk to ULTRA on `gpt-6.1-sol` at `xhigh`. One emergency stop halts everything, outbound connections follow the switches, and agents cannot read the 1Ultra project folder.

**Architecture:** Pure rules live in `station/ultra-policy.js`:
- provider → switch mapping
- run admission
- outbound target allow-list
- protected paths

`station/ultra-host.js` binds them to the live switches and the 1Ultra stop. Exact-match patches in `station/ultra-patches.json` connect them to Starnet's run host, halt handlers, provider factory, path trust and project blessing. Codex itself is Starnet's existing `codex` provider; this plan only unlocks it.

**Tech Stack:** Node.js 26 (`node:test`), Python 3.10 (`unittest`), Starnet `54899e5` vendored in `station/`.

**Spec:** `docs/superpowers/specs/2026-10-10-campaign-crew-design.md` (Stage 1, first half). Stage 1b (FreeLLMAPI, crew provider, crew failover) gets its own plan after this one.

## Global Constraints

- **Who works where.**
  - Implementers are Codex agents (`codex exec -m gpt-6.1-sol -c model_reasoning_effort="xhigh" -s workspace-write`). Each runs in its own worktree `/home/adem/1ultra/.worktrees/s1a-t<N>`, created from branch `campaign-crew`, with `station/node_modules` symlinked from the main checkout.
  - Implementers do **not** commit; the reviewer commits after review.
  - The Codex sandbox forbids all sockets (even localhost). Implementers run only the socket-free tests a task names. The reviewer runs `scripts/station_smoke.py` and the browser checks.
- **Never hand-edit upstream files.** All changes to upstream Starnet files go through `station/ultra-patches.json` and `python3 scripts/update_starnet.py --repo runs/upstream/starnet --revision 54899e5ff3f2b002b457757916b3977818db6fc1`.
  - Each patch `find` must match exactly once in the **rebranded** upstream text, or in that text after the patches listed before it.
  - `tests/test_ultra_patches.py` (Task 2) enforces this.
- **Records.** Business records stay read-only: `sha256sum -c runs/phase1-business-baseline.sha256` must print `OK` for every line after every task.
- **No live model calls in tests.** A live sign-in or ULTRA message happens only in Task 6, after Adem says go for that exact check.
- **No upstream regressions.** Upstream fast tests must not regress beyond `docs/ops/STATION_UPSTREAM_TESTS.md` (146 recorded failures → the same or fewer, with the same reasons).
- **Switch readiness.** After this plan, `ready` switches are `lead.codex`, `tools.web`, `concurrency` and `spend_cap_usd`. `crew.freellmapi` and `crew.escalate_to_lead` become ready in Stage 1b.

## Review Focus

1. **Restart with lead.codex on.** Adem signed in earlier and the station restarts with `lead.codex` on: the Codex tokens load and ULTRA answers without signing in again. *Pinned by Task 5, Step 1 (token-load gate test).*
2. **Restart with lead.codex off.** `lead.codex` was turned off after signing in: no Codex call can happen, even though the tokens are still on disk. *Pinned by Task 1, Step 1 (`providerAllowed` refuses `codex` while `lead.codex` is off) and Task 5, Step 6.*
3. **Starnet's own E-STOP during a run.** Pressing Starnet's E-STOP while ULTRA is mid-run stops the run, and no new run, crew dispatch or line job starts until RESUME. *Pinned by Task 2, Step 6 (smoke: Starnet halt sets the 1Ultra stop, and a run is refused).*
4. **Symlinked project files.** A symlink inside an agent workspace pointing at `/home/adem/1ultra/data` is refused like the real path. *Pinned by Task 4, Step 1 (symlink case).*
5. **Private network addresses.** A web tool asked to fetch a private address such as `http://192.168.1.10/` is refused even with `tools.web` on. *Pinned by Task 3, Step 1.*

---

### Task 1: Pure policy rules

**Files:**
- Modify: `station/ultra-policy.js`
- Test: `tests/station-policy.test.cjs` (append)

**Interfaces:**
- Produces (exported from `ultra-policy.js`):
  - `providerSwitch(providerId) -> string|null`
  - `providerAllowed(providerId, switches) -> {ok, switch?, error?}`
  - `admitRun({halted}) -> {ok, error?}`
  - `allowedTarget({host, port, protocol}, isOn, {freellmapiPort}) -> boolean`
  - `setProtectedRoots({root, runtime}|null)`
  - `protectedPathReason(path) -> string|null`
  - `blessRefusal(dir) -> string|null`
  - `gate(cls, switches)` now also opens the `providers` class while `lead.codex` or `crew.freellmapi` is on.

- [ ] **Step 1: Write the failing tests**

Append to `tests/station-policy.test.cjs`:

```js
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test tests/station-policy.test.cjs`
Expected: FAIL with `Policy.providerSwitch is not a function`.

- [ ] **Step 3: Implement the rules**

In `station/ultra-policy.js`:

Replace the `gate` function with:

```js
function gate(cls, switches) {
  if (cls === 'local') return { ok: true, cls };
  if (cls === 'blocked' || cls === 'unclassified') return { ok: false, cls, error: 'This Starnet feature is not part of 1Ultra.' };
  const isOn = id => { try { return switches.isOn(id) === true; } catch (_) { return false; } };
  const open = cls === 'providers' ? (isOn('providers') || isOn('lead.codex') || isOn('crew.freellmapi')) : isOn(cls);
  if (open) return { ok: true, cls };
  return { ok: false, cls, switch: cls, error: 'Turn on "' + cls + '" in 1Ultra switches first.' };
}
```

Add before `function makeGate`:

```js
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
function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.') && !h.includes(':')) return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) { const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224; }
  if (h.includes(':')) return h === '::' || h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  return false;
}
// May this process open a connection to target? FreeLLMAPI is the one local service agents may reach.
function allowedTarget(target, isOn, opts = {}) {
  const host = String((target && target.host) || '').toLowerCase().replace(/^\[|\]$/g, '');
  const port = Number(target && target.port) || ((target && target.protocol) === 'http:' ? 80 : 443);
  const on = id => { try { return isOn(id) === true; } catch (_) { return false; } };
  if ((host === '127.0.0.1' || host === 'localhost' || host === '::1') && port === Number(opts.freellmapiPort || 3001)) return on('crew.freellmapi');
  if (isPrivateHost(host)) return false;
  if (CODEX_HOSTS.some(h => host === h || host.endsWith('.' + h))) return on('lead.codex') || on('tools.web');
  return on('tools.web');
}
// The 1Ultra project folder is never an agent's to read or write; only the station runtime inside it is.
let protectedRoots = null;
function setProtectedRoots(roots) {
  const path = require('node:path');
  protectedRoots = roots && roots.root ? { root: path.resolve(roots.root), runtime: path.resolve(roots.runtime || path.join(roots.root, 'runs', 'station-runtime')) } : null;
}
function realOrSelf(p) {
  const path = require('node:path'), fs = require('node:fs');
  let cur = path.resolve(String(p)); const rest = [];
  for (let i = 0; i < 128; i++) {
    try { return path.join(fs.realpathSync(cur), ...rest.slice().reverse()); }
    catch (_) { const parent = path.dirname(cur); if (parent === cur) break; rest.push(path.basename(cur)); cur = parent; }
  }
  return path.resolve(String(p));
}
function inside(child, parent) {
  const path = require('node:path'); const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
function protectedPathReason(p) {
  if (!protectedRoots || !p) return null;
  const path = require('node:path');
  const runtimeReal = realOrSelf(protectedRoots.runtime), rootReal = realOrSelf(protectedRoots.root);
  for (const candidate of [path.resolve(String(p)), realOrSelf(p)]) {
    if (inside(candidate, protectedRoots.runtime) || inside(candidate, runtimeReal)) continue;
    if (inside(candidate, protectedRoots.root) || inside(candidate, rootReal)) return '1Ultra project files are off-limits to agents: ' + candidate;
  }
  return null;
}
function blessRefusal(dir) {
  if (!protectedRoots || !dir) return null;
  const d = realOrSelf(dir), root = realOrSelf(protectedRoots.root);
  if (inside(d, root) || inside(root, d)) return 'A project folder may not be, contain or sit inside the 1Ultra project (' + root + ').';
  return null;
}
```

Extend `module.exports` with `providerSwitch, providerAllowed, admitRun, allowedTarget, isPrivateHost, setProtectedRoots, protectedPathReason, blessRefusal`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test tests/station-policy.test.cjs tests/station-switches.test.cjs tests/station-seed.test.cjs`
Expected: PASS, all cases.

---

### Task 2: One emergency stop, run admission and the provider gate

**Files:**
- Modify: `station/ultra-host.js` (lines 184 and 239–240), `station/ultra-patches.json` (`model-gate`, `route-registry`, plus 3 new entries)
- Create: `tests/test_ultra_patches.py`
- Modify: `scripts/station_smoke.py` (reviewer runs it)

**Interfaces:**
- Consumes: `policy.admitRun`, `policy.providerAllowed` (Task 1).
- Produces (exported from `ultra-host.js`):
  - `beforeRun(o)`: throws `ULTRA_EMERGENCY_STOP`
  - `assertProviderAllowed(opts)`: throws `ULTRA_PROVIDER_OFF`
  - `onStationHalt()`, `onStationResume()`, `registerStationHalt(fn)`

- [ ] **Step 1: Write the failing patch test**

Create `tests/test_ultra_patches.py`:

```python
"""Every 1Ultra patch must match exactly once in rebranded upstream, in order, and be used (offline: reads the local clone)."""
import json, subprocess, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import update_starnet as U

CLONE = Path('/home/adem/1ultra/runs/upstream/starnet')
REVISION = json.loads((ROOT / 'station/UPSTREAM.json').read_text())['revision']


@unittest.skipUnless((CLONE / '.git').exists(), 'upstream clone not present')
class PatchAnchorsTest(unittest.TestCase):
    def test_every_patch_applies_once_in_order(self):
        patches = json.loads((ROOT / 'station/ultra-patches.json').read_text())
        texts = {}
        for p in patches:
            if p['file'] not in texts:
                raw = subprocess.check_output(['git', '-C', str(CLONE), 'show', f"{REVISION}:{p['file']}"], text=True)
                texts[p['file']] = U.rebrand(raw) if U.brandable(p['file']) else raw
            count = texts[p['file']].count(p['find'])
            self.assertEqual(count, 1, f"{p['id']} matches {count} times in {p['file']}")
            texts[p['file']] = texts[p['file']].replace(p['find'], p['replace'])

    def test_ids_are_unique(self):
        ids = [p['id'] for p in json.loads((ROOT / 'station/ultra-patches.json').read_text())]
        self.assertEqual(len(ids), len(set(ids)))

    def test_station_copy_matches_patched_upstream(self):
        for rel in ['sidecar/index.js']:
            row = next(a for a in json.loads((ROOT / 'station/UPSTREAM.json').read_text())['adaptations'] if a['path'] == rel)
            import hashlib
            self.assertEqual(hashlib.sha256((ROOT / 'station' / rel).read_bytes()).hexdigest(), row['current_sha256'], 'rerun update_starnet.py')


if __name__ == '__main__':
    unittest.main()
```

Add the three new patches to `station/ultra-patches.json` **now**, before changing the host. Each JSON entry is shown pretty-printed; keep the file a JSON array.

Insert after the `ultra-host-require` entry:

```json
{"id": "run-admission", "file": "sidecar/index.js",
 "find": "async function runOnceCore(o) {\n  if (updatePreparation.isFrozen()) {\n    throw Object.assign(new Error('1Ultra is frozen at a verified pre-update recovery point.'), { code: 'UPDATE_MUTATIONS_FROZEN' });\n  }\n",
 "replace": "async function runOnceCore(o) {\n  if (updatePreparation.isFrozen()) {\n    throw Object.assign(new Error('1Ultra is frozen at a verified pre-update recovery point.'), { code: 'UPDATE_MUTATIONS_FROZEN' });\n  }\n  ultraHost.beforeRun(o);\n"},
{"id": "station-halt-hook", "file": "sidecar/index.js",
 "find": "function handleHalt(req, res) {\n",
 "replace": "function handleHalt(req, res) {\n  ultraHost.onStationHalt();\n"},
{"id": "station-resume-hook", "file": "sidecar/index.js",
 "find": "  if (!body || body.confirm !== true) return haltJson(res, 400, { error: 'explicit confirm:true is required to resume' });\n",
 "replace": "  if (!body || body.confirm !== true) return haltJson(res, 400, { error: 'explicit confirm:true is required to resume' });\n  ultraHost.onStationResume();\n"}
```

Change the `replace` of `model-gate` to:

```
"function selectProvider(opts) {\n  ultraHost.assertProviderAllowed(opts);\n"
```

Change the `replace` of `route-registry` to:

```
"ultraHost.registerRoutes(ROUTES);\nultraHost.registerStationHalt(() => { handleHalt(null, { writeHead() {}, end() {} }); try { killAll(runStopHandles); } catch (_) {} });\nfunction dispatchRoute(req, res) {\n"
```

- [ ] **Step 2: Run the patch test and confirm it fails**

Run: `python3 -m unittest tests.test_ultra_patches -v`
Expected: `test_every_patch_applies_once_in_order` passes (anchors are valid), and `test_station_copy_matches_patched_upstream` FAILS because the station copy is not yet regenerated.

- [ ] **Step 3: Bind the stop and the gates in the host**

In `station/ultra-host.js`, replace line 184:

```js
      if(body.action==='stop'){halted=true;for(const job of jobs.values())if(job.child){job.status='cancelled';terminateJob(job);}saveJobs();}
```

with:

```js
      if(body.action==='stop'){onStationHalt();try{stationHalt();}catch(e){console.warn('[1ultra] station halt failed:',(e&&e.message)||e);}}
```

Before the line `let routeTable=[];`, add:

```js
// One emergency stop: the 1Ultra stop also halts Starnet (runs, lines, cron, dispatch), Starnet's E-STOP also sets the
// 1Ultra stop, and Starnet's RESUME clears both. While stopped, every agent run is refused before it reaches a model.
let stationHalt=()=>{};
function registerStationHalt(fn){if(typeof fn==='function')stationHalt=fn;}
function onStationHalt(){halted=true;for(const job of jobs.values())if(job.child){job.status='cancelled';terminateJob(job);}saveJobs();durable(controlFile,{halted});}
function onStationResume(){halted=false;durable(controlFile,{halted});}
function beforeRun(o){const r=policy.admitRun({halted});if(!r.ok)throw Object.assign(new Error(r.error),{code:'ULTRA_EMERGENCY_STOP'});}
function assertProviderAllowed(opts){const r=policy.providerAllowed(opts&&opts.provider,switches);if(!r.ok)throw Object.assign(new Error(r.error),{code:'ULTRA_PROVIDER_OFF'});}
```

Change the export line to:

```js
module.exports={root,runtime,policy,handle,classic,campaign,switches,preGate,routeGate,registerRoutes,beforeRun,assertProviderAllowed,onStationHalt,onStationResume,registerStationHalt};
```

Regenerate the station copy:

```bash
python3 scripts/update_starnet.py --repo /home/adem/1ultra/runs/upstream/starnet --revision 54899e5ff3f2b002b457757916b3977818db6fc1
```

- [ ] **Step 4: Run the socket-free tests**

Run: `python3 -m unittest tests.test_ultra_patches tests.test_update_starnet -v && node --check station/ultra-host.js && node --test tests/station-policy.test.cjs`
Expected: all PASS.

- [ ] **Step 5: Add the smoke checks (the reviewer runs them)**

In `scripts/station_smoke.py`, after the line `checks.append('route classes: none unclassified; model route refused with its switch; local routes answer')`, add:

```python
            request('/api/ultra/control', {'action': 'stop'})
            assert request('/api/halt')['halted'] is True, '1Ultra stop must halt Starnet too'
            request('/api/halt/resume', {'confirm': True})
            assert request('/api/ultra/runtime')['halted'] is False, "Starnet RESUME clears the 1Ultra stop"
            request('/api/halt', {})
            assert request('/api/ultra/runtime')['halted'] is True, "Starnet E-STOP sets the 1Ultra stop"
            request('/api/halt/resume', {'confirm': True})
            assert request('/api/ultra/runtime')['halted'] is False
            checks.append('one emergency stop: 1Ultra stop halts Starnet; Starnet E-STOP and RESUME drive the 1Ultra stop')
```

- [ ] **Step 6: Reviewer runs the integration checks**

Run: `python3 scripts/check_station.py >/dev/null && python3 scripts/station_smoke.py | grep -E '"passed"|one emergency stop'`
Expected: exit 0 and the new check listed.

---

### Task 3: Outbound connections follow the switches

**Files:**
- Modify: `station/ultra-policy.js` (`install`), `station/ultra-host.js` (last line)
- Create: `tests/station-outbound.test.cjs`

**Interfaces:**
- Consumes: `allowedTarget` (Task 1).
- Produces: `install(runtime, switches, opts)`. Here `switches` is `{isOn(id)}` and `opts.freellmapiPort` defaults to 3001. It guards `fetch`, `http(s).request/get` and `net.Socket.prototype.connect`. A refused connection throws code `ULTRA_OUTBOUND_BLOCKED`. Child processes stay denied.

- [ ] **Step 1: Write the failing test**

Create `tests/station-outbound.test.cjs`:

```js
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test tests/station-outbound.test.cjs`
Expected: FAIL. The current `install` ignores switches, so `lead.codex opens only the Codex hosts` gets a refusal message instead of `REAL`.

- [ ] **Step 3: Replace `install` with the switch-aware guard**

In `station/ultra-policy.js`, replace the whole `install` function with:

```js
function urlTarget(input) {
  const raw = typeof input === 'string' || input instanceof URL ? String(input) : (input && input.url) || '';
  try { const u = new URL(raw); return { host: u.hostname, port: u.port, protocol: u.protocol }; } catch (_) { return { host: '', port: 0, protocol: '' }; }
}
function requestTarget(args, protocol) {
  const a = args[0];
  if (typeof a === 'string' || a instanceof URL) return urlTarget(a);
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
  net.Socket.prototype.connect = function (...args) { check(connectTarget(args)); return realConnect.apply(this, args); };
  const cp = require('node:child_process');
  for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[method] = deny;
}
```

In `station/ultra-host.js`, replace the last line `policy.install(runtime);` with:

```js
policy.setProtectedRoots({root,runtime});
policy.install(runtime,switches,{freellmapiPort:3001});
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test tests/station-outbound.test.cjs tests/station-policy.test.cjs && node --check station/ultra-host.js`
Expected: PASS (4 outbound cases plus the policy cases).

- [ ] **Step 5: Reviewer runs the integration checks**

Run: `python3 scripts/station_smoke.py | grep '"passed"'`
Expected: exit 0. The startup log may still show the one fail-open `browser-install.startup` refusal, which is expected.

---

### Task 4: Agents stay out of the project; third parties never see "StarNet"

**Files:**
- Modify: `station/ultra-patches.json` (8 new entries)
- Create: `tests/station-protected.test.cjs`, `tests/test_station_names.py`
- Modify: `scripts/station_smoke.py` (reviewer runs it)

**Interfaces:**
- Consumes: `protectedPathReason`, `blessRefusal`, `setProtectedRoots` (Task 1). Task 3 calls `setProtectedRoots` in the host; these tests call it directly.

- [ ] **Step 1: Write the failing tests**

Create `tests/station-protected.test.cjs`:

```js
const assert = require('node:assert/strict'), test = require('node:test');
const fs = require('node:fs'), fsp = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const Policy = require('../station/ultra-policy.js');
const { makePathTrust } = require('../station/sidecar/pathtrust.js');
test('path trust refuses 1Ultra project files even in Full Power, symlinks included', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-pt-')));
  const runtime = path.join(root, 'runs', 'station-runtime');
  fs.mkdirSync(path.join(runtime, 'agent'), { recursive: true }); fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data', 'leads.json'), '[]');
  fs.symlinkSync(path.join(root, 'data'), path.join(runtime, 'agent', 'link'));
  Policy.setProtectedRoots({ root, runtime });
  try {
    const pt = makePathTrust({ fsp, pathMod: path, workspaceRoot: runtime });
    for (const target of [path.join(root, 'data', 'leads.json'), path.join(runtime, 'agent', 'link', 'leads.json')])
      await assert.rejects(pt.guard(target, { scope: 'read', unrestrictedHost: true }), /off-limits/, target);
    const own = await pt.guard(path.join(runtime, 'agent', 'note.md'), { scope: 'read', unrestrictedHost: true });
    assert.equal(own.unrestrictedHost, true);
  } finally { Policy.setProtectedRoots(null); }
});
```

Create `tests/test_station_names.py`:

```python
"""Strings third parties see must not present 1Ultra as StarNet."""
import unittest
from pathlib import Path

STATION = Path(__file__).resolve().parents[1] / 'station'
FORBIDDEN = {
    'sidecar/tools/builtin/image.js': ["codex_cli_rs/0.0.0 (StarNet)", "'X-Title': 'STARNET'", "https://starnet.local"],
    'sidecar/providers/openrouter.js': ["'X-Title': 'STARNET'"],
    'sidecar/media-service.js': ["'X-Title': 'STARNET'"],
    'sidecar/mcp/oauth.js': ["client_name: opts.clientName || 'StarNet'"],
    'sidecar/mcp/client.js': ["name: 'starnet-harness'"],
}


class ThirdPartyNamesTest(unittest.TestCase):
    def test_no_starnet_identity_in_outbound_requests(self):
        for rel, needles in FORBIDDEN.items():
            text = (STATION / rel).read_text()
            for needle in needles:
                self.assertNotIn(needle, text, f'{rel} still sends {needle!r}')


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test tests/station-protected.test.cjs; python3 -m unittest tests.test_station_names -v`
Expected: both FAIL. Path trust does not refuse yet, and the StarNet strings are still present.

- [ ] **Step 3: Add the patches**

Append to `station/ultra-patches.json`:

```json
{"id": "protected-paths", "file": "sidecar/pathtrust.js",
 "find": "      if (unrestrictedHost) {\n        return { base: (P.parse(norm).root || P.dirname(norm)), abs: norm, unrestrictedHost: true };\n",
 "replace": "      const ultraProtected = typeof require === 'function' ? require('../ultra-policy.js').protectedPathReason(norm) : null;\n      if (ultraProtected) throw new Error(ultraProtected);\n      if (unrestrictedHost) {\n        return { base: (P.parse(norm).root || P.dirname(norm)), abs: norm, unrestrictedHost: true };\n"},
{"id": "bless-refusal", "file": "sidecar/index.js",
 "find": "  const key = 'path:' + rootReal;\n  const at = (typeof meta.now === 'number' && isFinite(meta.now)) ? meta.now : Date.now();\n",
 "replace": "  const key = 'path:' + rootReal;\n  if (ultraHost.policy.blessRefusal(rootReal)) return false;\n  const at = (typeof meta.now === 'number' && isFinite(meta.now)) ? meta.now : Date.now();\n"},
{"id": "name-image-ua", "file": "sidecar/tools/builtin/image.js",
 "find": "'User-Agent': 'codex_cli_rs/0.0.0 (StarNet)'",
 "replace": "'User-Agent': 'codex_cli_rs/0.0.0 (1Ultra)'"},
{"id": "name-image-openrouter", "file": "sidecar/tools/builtin/image.js",
 "find": "'HTTP-Referer': 'https://starnet.local', 'X-Title': 'STARNET'",
 "replace": "'HTTP-Referer': 'https://1ultra.local', 'X-Title': '1Ultra'"},
{"id": "name-openrouter", "file": "sidecar/providers/openrouter.js",
 "find": "'X-Title': 'STARNET'",
 "replace": "'X-Title': '1Ultra'"},
{"id": "name-media-speech", "file": "sidecar/media-service.js",
 "find": "      response = await fetchFn('https://openrouter.ai/api/v1/audio/speech', voiceFetchOpts({\n        method: 'POST',\n        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://localhost', 'X-Title': 'STARNET' },\n",
 "replace": "      response = await fetchFn('https://openrouter.ai/api/v1/audio/speech', voiceFetchOpts({\n        method: 'POST',\n        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://localhost', 'X-Title': '1Ultra' },\n"},
{"id": "name-media-stt", "file": "sidecar/media-service.js",
 "find": "          response = await fetchFn('https://openrouter.ai/api/v1/chat/completions', voiceFetchOpts({\n            method: 'POST',\n            headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://localhost', 'X-Title': 'STARNET' },\n",
 "replace": "          response = await fetchFn('https://openrouter.ai/api/v1/chat/completions', voiceFetchOpts({\n            method: 'POST',\n            headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://localhost', 'X-Title': '1Ultra' },\n"},
{"id": "name-mcp-oauth", "file": "sidecar/mcp/oauth.js",
 "find": "client_name: opts.clientName || 'StarNet',",
 "replace": "client_name: opts.clientName || '1Ultra',"},
{"id": "name-mcp-client", "file": "sidecar/mcp/client.js",
 "find": "const clientInfo = deps.clientInfo || { name: 'starnet-harness', version: '0' };",
 "replace": "const clientInfo = deps.clientInfo || { name: '1ultra-station', version: '0' };"}
```

Regenerate: `python3 scripts/update_starnet.py --repo /home/adem/1ultra/runs/upstream/starnet --revision 54899e5ff3f2b002b457757916b3977818db6fc1`

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test tests/station-protected.test.cjs tests/station-policy.test.cjs && python3 -m unittest tests.test_station_names tests.test_ultra_patches -v`
Expected: all PASS.

- [ ] **Step 5: Add the blessing smoke check (the reviewer runs it)**

In `scripts/station_smoke.py`, after the emergency-stop block from Task 2, add:

```python
            blessed = request('/api/projects/bless', {'path': str(root)})
            assert blessed.get('ok') is not True, blessed
            assert str(root) not in json.dumps(request('/api/projects')), 'the 1Ultra root must never become a project'
            checks.append('the 1Ultra project folder cannot be blessed as an agent project')
```

Run (reviewer): `python3 scripts/station_smoke.py | grep -E '"passed"|cannot be blessed'`
Expected: exit 0 and the new check listed.

---

### Task 5: ULTRA on Codex

**Files:**
- Modify:
  - `station/ultra-switches.js`: `lead.codex` and `tools.web` become ready
  - `station/ultra-seed.js`: `reasoningEffort`
  - `station/ultra-host.js`: one-time effort default
  - `station/ultra-patches.json`: `no-codex-token-load` plus 2 new entries
  - `station/frontend/ultra-window.js`: sign-in hint
- Test: `tests/station-switches.test.cjs`, `tests/station-seed.test.cjs`, `tests/test_ultra_patches.py` (already generic)
- Modify: `scripts/station_smoke.py` (reviewer runs it)

**Interfaces:**
- Consumes: `ultraHost.switches.isOn` in a patch; `assertProviderAllowed` (Task 2).
- Produces:
  - the Codex adapter and model dock list `gpt-6.1-sol`
  - the seeded lead uses `reasoningEffort: 'xhigh'`
  - `GET /api/ultra/switches` shows `lead.codex` and `tools.web` as ready

- [ ] **Step 1: Write the failing tests**

In `tests/station-switches.test.cjs`, change the readiness assertion in the first test to:

```js
  assert.deepEqual(s.list().filter(r=>r.ready).map(r=>r.id).sort(),['concurrency','lead.codex','spend_cap_usd','tools.web']);
```

In the second test, replace `assert.throws(()=>s.set('tools.web',true),e=>e.code==='not_ready');` with:

```js
  assert.throws(()=>s.set('crew.freellmapi',true),e=>e.code==='not_ready');
  s.set('lead.codex',true);assert.equal(s.isOn('lead.codex'),true);s.set('lead.codex',false);
```

In `tests/station-seed.test.cjs`, after `assert.equal(save.doc.agent.model,'gpt-6.1-sol');` add:

```js
  assert.equal(save.doc.reasoningEffort,'xhigh');assert.equal(files['agent.roster.json'].agents[0].reasoningEffort,'xhigh');
```

Append to `tests/test_ultra_patches.py`, inside `PatchAnchorsTest`:

```python
    def test_codex_tokens_load_only_while_lead_switch_is_on(self):
        text = (ROOT / 'station/sidecar/index.js').read_text()
        self.assertIn("function loadCodexTokens() {\n  if (!ultraHost.switches.isOn('lead.codex')) return null;", text)
        self.assertIn("{ id: 'gpt-6.1-sol'", (ROOT / 'station/sidecar/providers/codex.js').read_text())
        self.assertIn("'gpt-6.1-sol'", (ROOT / 'station/frontend/app/modeldock.js').read_text())
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test tests/station-switches.test.cjs tests/station-seed.test.cjs; python3 -m unittest tests.test_ultra_patches -v`
Expected: FAIL on readiness, `reasoningEffort` and the token-load assertion.

- [ ] **Step 3: Implement**

**Switches.** In `station/ultra-switches.js`, set `ready:true` on the `lead.codex` and `tools.web` catalog rows. Change the `lead.codex` `needs` text to `'Turn on, then sign in: model dock → GPT / CODEX → Sign in with ChatGPT; pick GPT 6.1 SOL · XHIGH'`.

**Seed.** In `station/ultra-seed.js`:
- In the save doc, add `reasoningEffort:'xhigh',` right after `prov:'codex',`.
- In the roster agent, add `reasoningEffort:'xhigh'` after `provider:'codex',`.

**One-time effort default.** In `station/ultra-host.js`, directly after the seeding block (the two lines starting `if(!fs.existsSync(path.join(runtime,'agent.save.json')))`), add:

```js
// One-time default for a seeded lead the interface has never saved: ULTRA thinks at xhigh. Never overrides a choice Adem made.
try{const saveFile=path.join(runtime,'agent.save.json'),env=JSON.parse(fs.readFileSync(saveFile,'utf8')),doc=env&&env.doc;
  if(doc&&doc.prov==='codex'&&doc.agent&&doc.agent.model==='gpt-6.1-sol'&&!doc.reasoningEffort&&doc.updatedAt===doc.agent.createdAt){doc.reasoningEffort='xhigh';durable(saveFile,env);}}catch(_){}
```

**Patches.** In `station/ultra-patches.json`, change the `replace` of `no-codex-token-load` to:

```
"function loadCodexTokens() {\n  if (!ultraHost.switches.isOn('lead.codex')) return null; // 1Ultra: Codex tokens load only while the lead.codex switch is on.\n"
```

Append:

```json
{"id": "codex-model-sol", "file": "sidecar/providers/codex.js",
 "find": "  const STATIC_MODELS = [\n",
 "replace": "  const STATIC_MODELS = [\n    { id: 'gpt-6.1-sol',         displayName: 'GPT-6.1 Sol',         context_length: 272000, max_completion_tokens: 128000, supportsTools: true, reasoningEfforts: CODEX_EFFORT_LIST.slice(), defaultReasoningLevel: 'xhigh' },\n"},
{"id": "modeldock-codex-sol", "file": "frontend/app/modeldock.js",
 "find": "const CODEX_MODELS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark'];",
 "replace": "const CODEX_MODELS = ['gpt-6.1-sol', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark'];"}
```

Regenerate: `python3 scripts/update_starnet.py --repo /home/adem/1ultra/runs/upstream/starnet --revision 54899e5ff3f2b002b457757916b3977818db6fc1`

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test tests/station-switches.test.cjs tests/station-seed.test.cjs tests/station-policy.test.cjs tests/station-outbound.test.cjs tests/station-protected.test.cjs && python3 -m unittest tests.test_ultra_patches tests.test_update_starnet tests.test_station_names -v && node --check station/ultra-host.js`
Expected: all PASS.

- [ ] **Step 5: Add the Codex smoke checks (the reviewer runs them)**

In `scripts/station_smoke.py`, right after `runtime = root / 'runtime'; runtime.mkdir()`, add a fake Codex token. It is inert while `lead.codex` is off, because tokens load only at startup and only while the switch is on:

```python
        import base64
        b64 = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip('=')
        (runtime / 'codex').mkdir()
        (runtime / 'codex' / 'tokens.json').write_text(json.dumps({'access_token': b64({'alg': 'none'}) + '.' + b64({'exp': 4102444800}) + '.fixture', 'refresh_token': 'fixture-refresh', 'last_refresh': '2026-10-10T00:00:00Z', 'auth_mode': 'chatgpt'}))
```

`tools.web` is now ready, so in the owner-switch block change `request('/api/ultra/switches', {'id': 'tools.web', 'value': True}, sw['version'], expected=409)` to `request('/api/ultra/switches', {'id': 'crew.freellmapi', 'value': True}, sw['version'], expected=409)`.

In `tests/station-starnet-browser.cjs`, replace `assert.equal(await page.locator('[data-switch="lead.codex"]').isDisabled(),true);` with:

```js
      assert.equal(await page.locator('[data-switch="crew.freellmapi"]').isDisabled(),true);
      assert.equal(await page.locator('[data-switch="lead.codex"]').isDisabled(),false);
```

After the blessing block from Task 4, add the following. It turns on `lead.codex`, restarts so the tokens load, proves the stop refuses a run, then turns the switch off again:

```python
            sw = request('/api/ultra/switches'); request('/api/ultra/switches', {'id': 'lead.codex', 'value': True}, sw['version'])
            proc.terminate(); proc.wait(timeout=10); boot()
            status = request('/api/auth/codex/status')
            assert status.get('connected') is True, status
            request('/api/ultra/control', {'action': 'stop'})
            req = urllib.request.Request(base + '/api/run', data=json.dumps({'provider': 'codex', 'model': 'gpt-6.1-sol', 'reasoningEffort': 'xhigh', 'messages': [{'role': 'user', 'content': 'fixture'}], 'agentId': 'agent'}).encode(),
                                         headers={'X-Starnet-Token': token, 'Origin': base, 'Content-Type': 'application/json'})
            try:
                with urllib.request.urlopen(req, timeout=20) as response: body = response.read().decode()
            except urllib.error.HTTPError as error: body = error.read().decode()
            assert 'Emergency stop' in body, body[:300]
            request('/api/halt/resume', {'confirm': True})
            sw = request('/api/ultra/switches'); request('/api/ultra/switches', {'id': 'lead.codex', 'value': False}, sw['version'])
            checks.append('Codex lead: tokens load while lead.codex is on; the emergency stop refuses the run before any model call')
```

- [ ] **Step 6: Reviewer runs the integration checks**

Run: `python3 scripts/station_smoke.py | grep -E '"passed"|Codex lead'`
Expected: exit 0 and the Codex check listed.

The station log must show no outbound attempt to `chatgpt.com` during the smoke test. The run is refused before the provider is built.

---

### Task 6: Integration verification, docs and the first live check (reviewer and owner)

**Files:**
- Modify: `docs/ops/STATION.md`, `docs/ops/STATION_UPSTREAM_TESTS.md`

- [ ] **Step 1: Full local verification**

```bash
cd /home/adem/1ultra
python3 -m unittest discover -s tests 2>&1 | tail -1
node --test tests/station-*.test.cjs tests/station-ui-smoke.cjs
python3 scripts/check_station.py >/dev/null && python3 scripts/station_smoke.py | grep '"passed"'
PW=/home/adem/.npm/_npx/86170c4cd1c5da32/node_modules/playwright; BR=/home/adem/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome
for m in --starnet "" --agents; do python3 scripts/station_browser_smoke.py $m --playwright-module $PW --browser $BR --output runs/station-qa-stage1a; done
sha256sum -c --quiet runs/phase1-business-baseline.sha256 && echo records-unchanged
```

Expected: everything passes and the records are unchanged.

Rerun the upstream fast suite with the runner described in `docs/ops/STATION_UPSTREAM_TESTS.md` and compare. Every new failure must be explained in that document or fixed.

- [ ] **Step 2: Docs**

In `docs/ops/STATION.md` "Start", replace the Phase 1 bullet with these three:

```markdown
- Switches you can turn on now: **lead.codex** (then sign in: model dock → GPT / CODEX → Sign in with ChatGPT, and pick GPT 6.1 SOL · XHIGH) and **tools.web** (public web search and reading for agents; private network addresses stay blocked). Crew switches arrive with FreeLLMAPI.
- One emergency stop: the 1Ultra stop halts Starnet too, Starnet's E-STOP sets the 1Ultra stop, and Starnet's RESUME clears both.
- Agents can never read or write the 1Ultra project folder (only their own station runtime), and it cannot be added as a project.
```

- [ ] **Step 3: Live check with Adem's approval**

Ask Adem: "Ready for the first live check? You turn on lead.codex, sign in with ChatGPT, and send ULTRA one short message." Only after he says go:
1. Start the station with `python3 scripts/station.py`.
2. Adem turns on `lead.codex` in SWITCHES, signs in, selects GPT 6.1 SOL · XHIGH, and asks ULTRA one question in COMMS.
3. Record the outcome in `docs/ops/STATION.md` under a "Verification history" entry dated that day: whether the model answered, which model the run record names, and that no business record changed. Do not include any token.
