# 1Ultra × Starnet Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `station/` to the latest Starnet, serve Starnet's interface at `/`, move today's station page to `/campaign/`, and add owner switches. Everything that could call a model, use the network or run on its own stays off.

**Architecture:** A repeatable update script copies Starnet's MIT code from a local clone. It rewrites display branding and applies a list of exact-match patches (`station/ultra-patches.json`). A switch store (`station/ultra-switches.js`) and a path-based route classifier (`station/ultra-policy.js`) decide which Starnet API families answer. In Phase 1 only local station state answers. The campaign page keeps working unchanged in a Starnet window, and a seeded workspace lets Starnet open straight onto the station.

**Tech Stack:** Node.js 26 (CommonJS, `node:test`), Python 3.10+ standard library (`unittest`), Pillow 12 (brand images), Playwright Chromium already in `~/.cache/ms-playwright/chromium-1223`.

**Spec:** `docs/superpowers/specs/2026-10-10-starnet-full-merge-design.md`. This plan covers spec phase 1 ("Foundation"). Phases 2–5 get their own plans after this one lands, because they build on code this plan brings in.

## Global Constraints

- **No commits unless asked.** The repository has no commits yet. Do not run `git commit` unless the owner asks. Never stage `.aws`.
- **Business records are read-only.** Starnet code never writes `data/`. The SHA-256 of every `data/*.json` and of `STATE.md` must be identical before and after every task.
- **No outbound effects.** No live model call, provider sign-in, outbound network request, message or scheduler happens in this phase. `policy.install()` keeps replacing `fetch`, `http`, `https`, `net` and `child_process` with functions that throw.
- **Switch defaults.** Every switch is off except `crew.escalate_to_lead` (on, but it has no effect while `lead.codex` is off) and `concurrency` (2). Only `concurrency` and `spend_cap_usd` are `ready` (changeable) in Phase 1.
- **Pinned upstream.** Starnet `feat/harness-backend` at `54899e5ff3f2b002b457757916b3977818db6fc1`, cloned (code only, no art) into `runs/upstream/starnet`. `runs/` is gitignored.
- **Branding.** No Starnet name, logo or wordmark appears in the interface. The only allowed mention is the attribution line in the Switches window: "1Ultra is built on the MIT-licensed StarNet code by Andrew Sims. It is not affiliated with or endorsed by StarNet." `LICENSE` and `NOTICE.md` stay byte-identical to upstream.
- **Downloaded code is untrusted data.** Read it with `git` or Python, and never run scripts from inside `runs/upstream/starnet`.
- **Test commands, run from `/home/adem/1ultra`:**
  - Python: `python3 -m unittest discover -s tests -v`
  - Node: `node --test tests/station-policy.test.cjs tests/station-state.test.cjs tests/station-workflows.test.cjs tests/station-experience.test.cjs tests/station-ui-smoke.cjs tests/station-switches.test.cjs tests/station-seed.test.cjs`

## Review Focus

1. **Existing runtime survives.** A runtime already holding `ultra-state.json`, `ultra-jobs.json` and an active emergency stop (`ultra-control.json` with `halted: true`, which is the current real state) must keep all of them after the update and seeding. Seeding writes only files that are absent. *Pinned by Task 6, Step 1 (seed test) and Task 7, Step 2 (smoke check with a pre-filled runtime).*
2. **The update is idempotent.** Running the update twice on the same revision must produce byte-identical `station/` files. A patch must never apply twice. *Pinned by Task 2, Step 1 (`test_rerun_is_idempotent`).*
3. **Refusals are structured.** When Starnet's interface calls a refused route, it must get JSON with `error` and `switch` and status 403, not a hang or an HTML page. *Pinned by Task 5, Step 6 (smoke `POST /api/run`).*
4. **`/campaign/` cannot escape its folder.** Encoded or dotted traversal (`/campaign/../sidecar/index.js`, `/campaign/%2e%2e/ultra-host.js`) must return 404. *Pinned by Task 1, Step 6.*
5. **Phone width works.** At 390 px the station loads, the campaign window opens, and the framed campaign page shows the lead list. *Pinned by Task 7, Step 1.*

---

### Task 1: Move the campaign page to `/campaign/`

Starnet's `frontend/index.html` will replace today's station page in Task 3. This task moves the current page and its scripts into `station/frontend/campaign/`, which is 1Ultra-owned. It also gives the page frozen copies of the five upstream modules it uses, two of which changed upstream.

**Files:**
- Create: `station/frontend/campaign/index.html`, `station/frontend/campaign/lib/{util,pipeline,worldmodel,workstreams,recipes}.js`, `station/frontend/campaign/lib/SOURCE.md`
- Move: `station/frontend/{ultra-app.js,ultra-experience.js,ultra-workflows.js,ultra.css,icon.svg}` → `station/frontend/campaign/`
- Modify: `station/ultra-host.js` (lines 6 and 194–205), `station/ultra-state.js:2`, `station/sidecar/index.js:10086`, `station/frontend/index.html`, `station/UPSTREAM.json` (adaptation hash), `scripts/check_station.py`, `scripts/station_smoke.py`
- Test: `tests/station-ui-smoke.cjs`, `tests/station-workflows.test.cjs`, `tests/station-experience.test.cjs`, `tests/station-experience-browser.cjs`, `tests/station-agents-browser.cjs`

**Interfaces:**
- Produces: `ultraHost.campaign(req, res, token)` serves `/campaign`, `/campaign/` and files under `station/frontend/campaign/`, injecting `window.__STARNET_API_TOKEN__` into `index.html`. The campaign page calls only `/api/ultra/*`, `/classic/*` and `/campaign/*`.

- [ ] **Step 1: Record the business-record baseline**

```bash
cd /home/adem/1ultra && sha256sum data/*.json STATE.md > runs/phase1-business-baseline.sha256 && cat runs/phase1-business-baseline.sha256
```

Expected: one line per file. Every later task ends by running `sha256sum -c runs/phase1-business-baseline.sha256`, and every line must print `OK`.

- [ ] **Step 2: Point the tests at the new paths (failing first)**

In `tests/station-ui-smoke.cjs`, replace the file loop (line 14):

```js
  for(const file of ['lib/util.js','lib/pipeline.js','lib/worldmodel.js','lib/workstreams.js','lib/recipes.js','ultra-workflows.js','ultra-experience.js','ultra-app.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../station/frontend/campaign',file),'utf8'),context,{filename:file});
```

In `tests/station-workflows.test.cjs` line 2: `const F=require('../station/frontend/campaign/ultra-workflows.js');`
In `tests/station-experience.test.cjs` line 3: `const Experience=require('../station/frontend/campaign/ultra-experience.js');`

In `tests/station-experience-browser.cjs` line 17, replace `await page.goto(base);` with `await page.goto(base+'/campaign/');`.
In `tests/station-agents-browser.cjs`, replace each `base+'/#` with `base+'/campaign/#` (lines 16, 69 and 107; leave the `/classic/` line unchanged).

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `node --test tests/station-ui-smoke.cjs tests/station-workflows.test.cjs tests/station-experience.test.cjs`
Expected: FAIL with `ENOENT` / `Cannot find module '../station/frontend/campaign/...'`.

- [ ] **Step 4: Move the files and create the campaign page**

```bash
cd /home/adem/1ultra/station/frontend
mkdir -p campaign/lib
mv ultra-app.js ultra-experience.js ultra-workflows.js ultra.css icon.svg campaign/
cp js/util.js campaign/lib/util.js
cp app/pipeline.js campaign/lib/pipeline.js
cp app/worldmodel.js campaign/lib/worldmodel.js
cp app/workstreams.js campaign/lib/workstreams.js
cp app/recipes.js campaign/lib/recipes.js
cd /home/adem/1ultra && python3 - <<'EOF'
from pathlib import Path
src = Path('station/frontend/index.html').read_text()
repl = {
    '<link rel="icon" href="icon.svg"': '<link rel="icon" href="/campaign/icon.svg"',
    '<link rel="stylesheet" href="ultra.css">': '<link rel="stylesheet" href="/campaign/ultra.css">',
    '<script src="js/util.js"></script><script src="app/pipeline.js"></script><script src="app/worldmodel.js"></script><script src="app/workstreams.js"></script><script src="app/recipes.js"></script><script src="ultra-workflows.js"></script><script src="ultra-experience.js"></script><script src="ultra-app.js"></script>':
    '<script src="/campaign/lib/util.js"></script><script src="/campaign/lib/pipeline.js"></script><script src="/campaign/lib/worldmodel.js"></script><script src="/campaign/lib/workstreams.js"></script><script src="/campaign/lib/recipes.js"></script><script src="/campaign/ultra-workflows.js"></script><script src="/campaign/ultra-experience.js"></script><script src="/campaign/ultra-app.js"></script>',
}
for old, new in repl.items():
    assert src.count(old) == 1, old
    src = src.replace(old, new)
Path('station/frontend/campaign/index.html').write_text(src)
EOF
```

Write `station/frontend/campaign/lib/SOURCE.md`:

```markdown
# Frozen upstream modules for the campaign page

These five files are unmodified MIT-licensed StarNet source (Copyright (c) 2026 Andrew Sims; license in `station/LICENSE`)
from commit `e0a36dcd31787248b877aea01a6e53741012bc46`. The campaign page was built against these exact versions, so
they are kept here and are not replaced by Starnet updates.

| File | Upstream path |
|---|---|
| util.js | frontend/js/util.js |
| pipeline.js | frontend/app/pipeline.js |
| worldmodel.js | frontend/app/worldmodel.js |
| workstreams.js | frontend/app/workstreams.js |
| recipes.js | frontend/app/recipes.js |
```

Replace `station/frontend/index.html` with a temporary pointer. Task 3 overwrites it with Starnet's page.

```html
<!doctype html><html lang="en"><head><meta charset="utf-8"><title>1Ultra</title><meta http-equiv="refresh" content="0;url=/campaign/"></head>
<body><a href="/campaign/">Open the 1Ultra campaign station</a></body></html>
```

- [ ] **Step 5: Serve `/campaign/` from the host**

In `station/ultra-host.js` line 6, change the require to `require('./frontend/campaign/ultra-workflows.js')`. Make the same change in `station/ultra-state.js` line 2.

Add this function after `classic()`, which ends at line 203:

```js
// The campaign page is 1Ultra's own station page, framed inside Starnet. Path-jailed to frontend/campaign/.
const CAMPAIGN_BASE=fs.realpathSync(path.join(__dirname,'frontend','campaign'));
function campaign(req,res,token){
  let name;try{name=decodeURIComponent(String(req.url).split('?')[0].slice('/campaign'.length));}catch{res.writeHead(400);return res.end();}
  if(!name){res.writeHead(302,{Location:'/campaign/'});return res.end();}
  if(name==='/')name='/index.html';
  const file=path.resolve(CAMPAIGN_BASE,'.'+name);
  if(!file.startsWith(CAMPAIGN_BASE+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()||fs.realpathSync(file)!==file){res.writeHead(404);return res.end();}
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8'};
  let data=fs.readFileSync(file);
  if(path.basename(file)==='index.html')data=Buffer.from(data.toString().replace('<head>','<head><script>window.__STARNET_API_TOKEN__='+JSON.stringify(token)+';</script>'));
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Frame-Options':'SAMEORIGIN','Content-Security-Policy':"frame-ancestors 'self'",'X-Content-Type-Options':'nosniff'});
  res.end(data);
}
```

Change the export line to `module.exports={root,runtime,policy,handle,classic,campaign};`.

In `station/sidecar/index.js`, after line 10086 (`if (String(req.url).startsWith('/classic')) ...`), add:

```js
  if (/^\/campaign(\/|\?|$)/.test(String(req.url))) return ultraHost.campaign(req, res, API_TOKEN);
```

Refresh the adaptation hash so `check_station.py` accepts the edit:

```bash
cd /home/adem/1ultra && python3 - <<'EOF'
import hashlib, json
from pathlib import Path
m = Path('station/UPSTREAM.json'); d = json.loads(m.read_text())
for row in d['adaptations']:
    if row['path'] == 'sidecar/index.js':
        row['current_sha256'] = hashlib.sha256(Path('station/sidecar/index.js').read_bytes()).hexdigest()
m.write_text(json.dumps(d, indent=2) + '\n')
EOF
```

In `scripts/check_station.py`, replace lines 25–33 (from `html=` through the `node --check` loop) with:

```python
    html=(station/'frontend/campaign/index.html').read_text()
    assert '1Ultra' in html and 'frontend/assets' not in html
    for asset in re.findall(r'(?:src|href)="([^"#]+)"',html):
        assert not asset.startswith(('https:','http:')), 'Active external asset: '+asset
        if asset.startswith('/classic'): continue
        assert (station/'frontend'/asset.lstrip('/')).is_file(),asset
    for file in sorted({*station.glob('ultra-*.js'),*station.glob('frontend/ultra-*.js'),*station.glob('frontend/campaign/*.js'),station/'sidecar/index.js'}):
        subprocess.run(['node','--check',str(file)],check=True,capture_output=True)
```

- [ ] **Step 6: Add campaign-route checks to the HTTP smoke test**

In `scripts/station_smoke.py`, directly after the line `workspace = request('/api/ultra/workspace'); campaign = request('/api/ultra/campaign')`, add:

```python
            page = request('/campaign/', authenticated=False)
            assert '1Ultra' in page and 'window.__STARNET_API_TOKEN__=' in page and '/campaign/ultra-app.js' in page
            assert 'function go(' in request('/campaign/ultra-app.js', authenticated=False)
            for escape in ['/campaign/../sidecar/index.js', '/campaign/%2e%2e/ultra-host.js', '/campaign/..%2fultra-host.js']:
                request(escape, authenticated=False, expected=404)
            checks.append('campaign page served at /campaign/ and path-jailed')
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `node --test tests/station-policy.test.cjs tests/station-state.test.cjs tests/station-workflows.test.cjs tests/station-experience.test.cjs tests/station-ui-smoke.cjs`
Expected: PASS, all cases.

Run: `python3 scripts/check_station.py && python3 scripts/station_smoke.py`
Expected: JSON summaries printed. Exit code 0. The smoke output includes `campaign page served at /campaign/ and path-jailed`.

Run: `python3 -m unittest discover -s tests -v 2>&1 | tail -3 && sha256sum -c runs/phase1-business-baseline.sha256`
Expected: `OK`, and every line printed by `sha256sum -c` ends in `OK`.

---

### Task 2: Repeatable update script and the patch list

`scripts/update_starnet.py` replaces `scripts/import_starnet.py`. It copies eligible upstream files from a local clone, rewrites display branding, applies `station/ultra-patches.json`, removes upstream files that no longer exist, protects 1Ultra-owned files, and writes `station/UPSTREAM.json`. It makes no network calls.

**Files:**
- Create: `scripts/update_starnet.py`, `station/ultra-patches.json`, `tests/test_update_starnet.py`
- Delete: `scripts/import_starnet.py`
- Modify: `scripts/check_station.py` (LICENSE/NOTICE adaptation guard)

**Interfaces:**
- Produces:
  - `update_starnet.eligible(name: str) -> bool`
  - `rebrand(text: str) -> str`
  - `apply_patches(name: str, text: str, patches: list[dict]) -> tuple[str, list[str]]`
  - `export(repo: Path, revision: str, destination: Path, patches: list[dict]) -> dict` (returns the manifest dict)
- Patch entries look like `{"id": str, "file": <upstream path>, "find": str, "replace": str}`. Every patch must match exactly once and must be used.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_update_starnet.py`:

```python
import hashlib, json, subprocess, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import update_starnet as U


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], text=True).strip()


class UpdateStarnetTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); base = Path(self.tmp.name)
        self.repo = base / 'upstream'; self.dest = base / 'station'
        files = {
            'sidecar/index.js': "'use strict';\nconst label = 'StarNet ready';\n",
            'frontend/index.html': '<title>STARNET</title><p>Starnet station</p>',
            'frontend/app/a.js': "show('StarNet'); key('starnet.save'); env('STARNET_PORT');\n",
            'frontend/prop-atlas.html': '<p>review page</p>',
            'frontend/dev/review.html': '<p>dev</p>',
            'frontend/assets/brand/logo.svg': '<svg/>',
            'test/a.test.js': "assert('StarNet');\n",
            'LICENSE': 'MIT StarNet\n', 'NOTICE.md': 'StarNet credits\n',
            'package.json': '{"name":"starnet-harness"}\n', 'website/index.html': 'site',
        }
        self.repo.mkdir()
        git(self.repo, 'init', '-q'); git(self.repo, 'config', 'user.email', 't@t'); git(self.repo, 'config', 'user.name', 't')
        for name, text in files.items():
            p = self.repo / name; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(text)
        git(self.repo, 'add', '-A'); git(self.repo, 'commit', '-qm', 'fixture')
        self.rev = git(self.repo, 'rev-parse', 'HEAD')
        self.patches = [{'id': 'host', 'file': 'sidecar/index.js', 'find': "'use strict';\n",
                         'replace': "'use strict';\nconst ultraHost = require('../ultra-host.js');\n"}]

    def tearDown(self): self.tmp.cleanup()

    def run_export(self, patches=None):
        return U.export(self.repo, self.rev, self.dest, self.patches if patches is None else patches)

    def test_copies_code_but_not_art_review_pages_dev_or_website(self):
        self.run_export()
        for rel in ['sidecar/index.js', 'frontend/index.html', 'frontend/app/a.js', 'test/a.test.js', 'LICENSE', 'NOTICE.md', 'package.upstream.json']:
            self.assertTrue((self.dest / rel).is_file(), rel)
        for rel in ['frontend/prop-atlas.html', 'frontend/dev/review.html', 'frontend/assets/brand/logo.svg', 'website/index.html', 'package.json']:
            self.assertFalse((self.dest / rel).exists(), rel)

    def test_rebrands_display_words_only(self):
        self.run_export()
        self.assertEqual((self.dest / 'frontend/app/a.js').read_text(), "show('1Ultra'); key('starnet.save'); env('STARNET_PORT');\n")
        self.assertEqual((self.dest / 'frontend/index.html').read_text(), '<title>1ULTRA</title><p>1Ultra station</p>')
        self.assertEqual((self.dest / 'LICENSE').read_text(), 'MIT StarNet\n')
        self.assertEqual((self.dest / 'NOTICE.md').read_text(), 'StarNet credits\n')

    def test_applies_patch_and_records_adaptations(self):
        manifest = self.run_export()
        self.assertIn("const ultraHost = require('../ultra-host.js');", (self.dest / 'sidecar/index.js').read_text())
        adapted = {a['path']: a for a in manifest['adaptations']}
        self.assertEqual(adapted['sidecar/index.js']['reasons'], ['brand', 'patch:host'])
        self.assertEqual(adapted['sidecar/index.js']['current_sha256'], hashlib.sha256((self.dest / 'sidecar/index.js').read_bytes()).hexdigest())
        self.assertNotIn('LICENSE', adapted)
        self.assertEqual(json.loads((self.dest / 'UPSTREAM.json').read_text())['revision'], self.rev)
        row = next(r for r in manifest['files'] if r['path'] == 'package.json')
        self.assertEqual(row['source_copy_path'], 'package.upstream.json')

    def test_patch_must_match_exactly_once(self):
        with self.assertRaisesRegex(RuntimeError, 'expects one match'):
            self.run_export([{'id': 'missing', 'file': 'sidecar/index.js', 'find': 'nope', 'replace': 'x'}])

    def test_unused_patch_is_an_error(self):
        with self.assertRaisesRegex(RuntimeError, 'never applied'):
            self.run_export(self.patches + [{'id': 'ghost', 'file': 'sidecar/gone.js', 'find': 'a', 'replace': 'b'}])

    def test_owned_files_are_preserved_and_stale_upstream_files_removed(self):
        (self.dest / 'frontend/campaign').mkdir(parents=True)
        (self.dest / 'ultra-host.js').write_text('owned')
        (self.dest / 'frontend/campaign/index.html').write_text('campaign')
        (self.dest / 'sidecar').mkdir()
        (self.dest / 'sidecar/removed-upstream.js').write_text('old')
        (self.dest / 'UPSTREAM.json').write_text(json.dumps({'files': [{'path': 'sidecar/removed-upstream.js'}]}))
        self.run_export()
        self.assertEqual((self.dest / 'ultra-host.js').read_text(), 'owned')
        self.assertEqual((self.dest / 'frontend/campaign/index.html').read_text(), 'campaign')
        self.assertFalse((self.dest / 'sidecar/removed-upstream.js').exists())

    def test_rerun_is_idempotent(self):
        self.run_export(); first = {p: p.read_bytes() for p in self.dest.rglob('*') if p.is_file()}
        self.run_export(); second = {p: p.read_bytes() for p in self.dest.rglob('*') if p.is_file()}
        self.assertEqual(first, second)


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `python3 -m unittest tests.test_update_starnet -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'update_starnet'`.

- [ ] **Step 3: Write the update script**

Create `scripts/update_starnet.py`:

```python
"""Update station/ from a local Starnet clone: copy eligible MIT source, rebrand display text, apply 1Ultra patches.

Usage: python3 scripts/update_starnet.py --repo runs/upstream/starnet --revision <commit>
Fetch the clone separately (docs/ops/STATION.md). This script makes no network calls and runs nothing from the clone.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TEXT = {'.js', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.txt', '.yml', '.yaml', '.tpl', '.list'}
FRONTEND_DIRS = {'app', 'css', 'js', 'lib', 'plugin-kit'}
SKIP_PARTS = {'workspaces', 'output', 'credentials', 'fixtures-private'}
# 1Ultra-owned paths inside station/: never written, replaced or deleted by an update.
OWNED = ('ultra-host.js', 'ultra-policy.js', 'ultra-state.js', 'ultra-switches.js', 'ultra-seed.js', 'ultra-patches.json',
         'UPSTREAM.json', 'package.json', 'package-lock.json', 'node_modules/', 'frontend/campaign/', 'frontend/assets/',
         'frontend/ultra-window.js', 'frontend/ultra-brand.css')
RENAMES = {'package.json': 'package.upstream.json', 'package-lock.json': 'package-lock.upstream.json'}
BRAND = [(re.compile(r'\bStarNet\b'), '1Ultra'), (re.compile(r'\bSTARNET\b'), '1ULTRA'), (re.compile(r'\bStarnet\b'), '1Ultra')]
BRAND_ROOTS = {'frontend', 'sidecar', 'shared', 'test', 'skills-catalog'}


def eligible(name):
    p = Path(name)
    if name in {'LICENSE', 'NOTICE.md', 'package.json', 'package-lock.json'}:
        return True
    if p.suffix not in TEXT or '..' in p.parts or len(p.parts) < 2:
        return False
    top = p.parts[0]
    if top in {'sidecar', 'shared', 'test'}:
        return not SKIP_PARTS.intersection(p.parts)
    if top == 'frontend':
        return p.parts[1:] == ('index.html',) or (len(p.parts) > 2 and p.parts[1] in FRONTEND_DIRS)
    return top in {'skills-catalog', 'scripts'}


def brandable(name):
    p = Path(name)
    return len(p.parts) > 1 and p.parts[0] in BRAND_ROOTS and not p.name.upper().startswith(('LICENSE', 'NOTICE', 'COPYING'))


def rebrand(text):
    for rx, new in BRAND:
        text = rx.sub(new, text)
    return text


def apply_patches(name, text, patches):
    applied = []
    for patch in patches:
        if patch['file'] != name:
            continue
        count = text.count(patch['find'])
        if count != 1:
            raise RuntimeError(f"Patch {patch['id']} expects one match in {name}, found {count}")
        text = text.replace(patch['find'], patch['replace'])
        applied.append(patch['id'])
    return text, applied


def owned(rel):
    return any(rel == o or (o.endswith('/') and rel.startswith(o)) for o in OWNED)


def inventory(repo, revision):
    tree = subprocess.check_output(['git', '-C', str(repo), 'ls-tree', '-r', revision], text=True)
    rows = []
    for line in tree.splitlines():
        meta, name = line.split('\t', 1)
        mode, kind, oid = meta.split()
        if mode == '100644' and kind == 'blob' and eligible(name):
            rows.append({'path': name, 'git_blob': oid})
    return rows


def blobs(repo, rows):
    proc = subprocess.Popen(['git', '-C', str(repo), 'cat-file', '--batch'], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    try:
        for row in rows:
            proc.stdin.write((row['git_blob'] + '\n').encode()); proc.stdin.flush()
            header = proc.stdout.readline().decode().split()
            if len(header) != 3 or header[1] != 'blob':
                raise RuntimeError('Missing source blob (fetch it into the clone first): ' + row['path'])
            data = proc.stdout.read(int(header[2])); proc.stdout.read(1)
            yield row, data
    finally:
        proc.stdin.close(); proc.stdout.close(); proc.wait()


def export(repo, revision, destination, patches):
    destination = Path(destination); destination.mkdir(parents=True, exist_ok=True)
    previous_file = destination / 'UPSTREAM.json'
    previous = json.loads(previous_file.read_text()) if previous_file.exists() else {'files': []}
    rows, adaptations, used, written = inventory(repo, revision), [], set(), set()
    for row, data in blobs(repo, rows):
        rel = RENAMES.get(row['path'], row['path'])
        if owned(rel):
            raise RuntimeError('Upstream path collides with a 1Ultra-owned file: ' + rel)
        row['sha256'] = hashlib.sha256(data).hexdigest(); row['bytes'] = len(data)
        if rel != row['path']:
            row['source_copy_path'] = rel
        reasons, out = [], data
        try:
            text = data.decode('utf-8')
        except UnicodeDecodeError:
            text = None
        if text is not None:
            new = rebrand(text) if brandable(row['path']) else text
            if new != text:
                reasons.append('brand')
            new, applied = apply_patches(row['path'], new, patches)
            if applied:
                reasons.append('patch:' + ','.join(applied)); used.update(applied)
            out = new.encode('utf-8')
        target = destination / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(out); written.add(rel)
        if reasons:
            adaptations.append({'path': row['path'], 'current_sha256': hashlib.sha256(out).hexdigest(), 'reasons': reasons})
    unused = [p['id'] for p in patches if p['id'] not in used]
    if unused:
        raise RuntimeError('Patches never applied: ' + ', '.join(unused))
    for old in previous.get('files', []):
        rel = old.get('source_copy_path', old['path'])
        stale = destination / rel
        if rel not in written and not owned(rel) and stale.is_file():
            stale.unlink()
    manifest = {'repository': 'https://github.com/androoAGI/starnet', 'revision': revision,
                'license': 'MIT code; upstream branding/art excluded and not imported', 'files': rows, 'adaptations': adaptations}
    previous_file.write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--destination', type=Path, default=ROOT / 'station')
    args = parser.parse_args()
    patches = json.loads((ROOT / 'station' / 'ultra-patches.json').read_text())
    manifest = export(args.repo.resolve(), args.revision, args.destination.resolve(), patches)
    print(json.dumps({'revision': manifest['revision'], 'files': len(manifest['files']),
                      'adapted': len(manifest['adaptations']), 'patches': len(patches)}))


if __name__ == '__main__':
    main()
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python3 -m unittest tests.test_update_starnet -v`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the patch list for upstream `54899e5`**

These patches reproduce today's 1Ultra adaptation (everything external stays off) against the new upstream, and add the `/campaign` route. Each `find` string was checked against upstream `sidecar/index.js` at `54899e5` and occurs exactly once.

Create `station/ultra-patches.json`:

```json
[
  {"id": "ultra-host-require", "file": "sidecar/index.js",
   "find": "'use strict';\n\nconst http = require('node:http');",
   "replace": "'use strict';\n\n// 1Ultra composition boundary: owner switches decide models, connections and background work.\nconst ultraHost = require('../ultra-host.js');\n\nconst http = require('node:http');"},
  {"id": "model-gate", "file": "sidecar/index.js",
   "find": "function selectProvider(opts) {\n",
   "replace": "function selectProvider(opts) {\n  ultraHost.policy.assertModelAllowed();\n"},
  {"id": "runtime-workspace", "file": "sidecar/index.js",
   "find": "function defaultWorkspaces() {\n",
   "replace": "function defaultWorkspaces() {\n  return ultraHost.runtime; // Never read a personal canonical workspace.\n"},
  {"id": "no-legacy-recovery-roots", "file": "sidecar/index.js",
   "find": "const RECOVERY_CANDIDATE_ROOTS = workspaceCandidates({\n  path: path, env: process.env, platform: process.platform, homedir: () => os.homedir()\n}).concat([path.resolve(__dirname, 'workspaces'), path.resolve(__dirname, '..', 'workspaces')]);",
   "replace": "const RECOVERY_CANDIDATE_ROOTS = []; // 1Ultra never inspects personal/legacy stations."},
  {"id": "no-startup-recovery", "file": "sidecar/index.js",
   "find": "const startupWorkspaceRecovery = workspaceRecovery.applyPendingRecovery({\n  fs, path, platform: process.platform, home: os.homedir(), workspaceRoot: WORKSPACES,\n  candidateRoots: DEV_MODE ? [] : RECOVERY_CANDIDATE_ROOTS, auto: !DEV_MODE, now: Date.now,\n  lockBootedAt: makeBootedAt(() => Date.now())   // a recovery lock left by a pre-reboot crash must not brick every boot (exit 73)\n});",
   "replace": "const startupWorkspaceRecovery = null; // Explicit local recovery only."},
  {"id": "no-skill-market-pull", "file": "sidecar/index.js",
   "find": "if (SKILL_MARKET_PULL_MS > 0) {",
   "replace": "if (false && SKILL_MARKET_PULL_MS > 0) { // 1Ultra: follows the skills.market switch"},
  {"id": "no-shell-hooks", "file": "sidecar/index.js",
   "find": "async function installShellHooks() {\n",
   "replace": "async function installShellHooks() {\n  return; // 1Ultra: follows the tools.shell switch.\n"},
  {"id": "no-codex-token-load", "file": "sidecar/index.js",
   "find": "function loadCodexTokens() {\n",
   "replace": "function loadCodexTokens() {\n  return null; // 1Ultra: follows the lead.codex switch.\n"},
  {"id": "no-discovery", "file": "sidecar/index.js",
   "find": "function armDiscovery() {\n",
   "replace": "function armDiscovery() {\n  return; // 1Ultra: follows the nightshift switch.\n"},
  {"id": "no-nightshift", "file": "sidecar/index.js",
   "find": "function armNightshift() {\n",
   "replace": "function armNightshift() {\n  return; // 1Ultra: follows the nightshift switch.\n"},
  {"id": "no-cron", "file": "sidecar/index.js",
   "find": "function armCron() {\n",
   "replace": "function armCron() {\n  return; // 1Ultra: follows the cron switch.\n"},
  {"id": "no-loops", "file": "sidecar/index.js",
   "find": "function armLoops(quiet) {\n",
   "replace": "function armLoops(quiet) {\n  return; // 1Ultra: follows the cron switch.\n"},
  {"id": "no-quest-refresh", "file": "sidecar/index.js",
   "find": "function armQuestRefresh() {\n",
   "replace": "function armQuestRefresh() {\n  return; // 1Ultra: follows the nightshift switch.\n"},
  {"id": "no-trigger-poll", "file": "sidecar/index.js",
   "find": "let triggerPollTimer = setInterval(() => { triggerRunner.tickFolders().catch(swallow('triggers.folders')); }, triggerPollMs);\ntriggerPollTimer.unref();",
   "replace": "let triggerPollTimer = null; // 1Ultra: folder triggers follow the cron switch."},
  {"id": "route-pre-gate", "file": "sidecar/index.js",
   "find": "const server = http.createServer((req, res) => {\n",
   "replace": "const server = http.createServer((req, res) => {\n  if (!ultraHost.policy.routeAllowed(req.method, String(req.url || '/'))) {\n    res.writeHead(403, { 'Content-Type': 'application/json' });\n    return res.end(JSON.stringify({error:'Live models, connections and background jobs are disabled. Use campaign preparation tools.'}));\n  }\n"},
  {"id": "ultra-routes", "file": "sidecar/index.js",
   "find": "  if (isApi && rejectBadApiToken(req, res)) return;\n",
   "replace": "  if (isApi && rejectBadApiToken(req, res)) return;\n  if (String(req.url).startsWith('/api/ultra/')) return ultraHost.handle(req, res);\n  if (String(req.url).startsWith('/classic')) return ultraHost.classic(req, res, API_TOKEN);\n  if (/^\\/campaign(\\/|\\?|$)/.test(String(req.url))) return ultraHost.campaign(req, res, API_TOKEN);\n"},
  {"id": "quiet-boot", "file": "sidecar/index.js",
   "find": "server.listen(PORT, '127.0.0.1', () => {\n  const url = 'http://127.0.0.1:' + PORT;\n",
   "replace": "server.listen(PORT, '127.0.0.1', () => {\n  const url = 'http://127.0.0.1:' + PORT;\n  console.log('1Ultra station ready: ' + url + ' · owner switches decide models, connections and background work');\n  return; // Credential, connector, channel, discovery and scheduler restoration follow their switches.\n"},
  {"id": "quiet-pty", "file": "sidecar/index.js",
   "find": "if (terminalPtyLoadError && require.main === module)",
   "replace": "if (false && terminalPtyLoadError && require.main === module)"}
]
```

- [ ] **Step 6: Check the patch list against the clone, then retire the old import script**

```bash
cd /home/adem/1ultra && python3 - <<'EOF'
import json, subprocess, sys
sys.path.insert(0, 'scripts'); import update_starnet as U
text = subprocess.check_output(['git', '-C', 'runs/upstream/starnet', 'show', '54899e5ff3f2b002b457757916b3977818db6fc1:sidecar/index.js'], text=True)
text = U.rebrand(text)
for p in json.load(open('station/ultra-patches.json')):
    print(text.count(p['find']), p['id'])
EOF
rm scripts/import_starnet.py
```

Expected: every line starts with `1`.

In `scripts/check_station.py`, replace the `for file in ('LICENSE','NOTICE.md'):` block with:

```python
    for file in ('LICENSE','NOTICE.md'):
        row=next(r for r in manifest['files'] if r['path']==file)
        assert file not in adapted and hashlib.sha256((station/file).read_bytes()).hexdigest()==row['sha256'],file
```

- [ ] **Step 7: Run the full suites**

Run: `python3 -m unittest discover -s tests -v 2>&1 | tail -3 && python3 scripts/check_station.py >/dev/null && sha256sum -c runs/phase1-business-baseline.sha256`
Expected: `OK`, a clean check run, and every baseline line `OK`.

---

### Task 3: Update `station/` to upstream `54899e5`

**Files:**
- Modify: everything under `station/` that the manifest lists (written by the script)
- Modify: `station/ultra-patches.json` (only if a boot error needs an extra patch; see Step 5)

- [ ] **Step 1: Confirm the clone and take a rollback copy**

```bash
cd /home/adem/1ultra
git -C runs/upstream/starnet rev-parse HEAD
cp -a station runs/upstream/station-before-54899e5
```

Expected: `54899e5ff3f2b002b457757916b3977818db6fc1`. The copy is the rollback point: `rm -rf station && cp -a runs/upstream/station-before-54899e5 station`.

If `runs/upstream/starnet` is missing, recreate it:

```bash
mkdir -p runs/upstream && cd runs/upstream
git clone --filter=blob:none --no-checkout --single-branch --branch feat/harness-backend https://github.com/androoAGI/starnet starnet
cd starnet && git sparse-checkout init --no-cone
printf '%s\n' '/sidecar/' '/shared/' '/scripts/' '/skills-catalog/' '/test/' '/frontend/' '!/frontend/assets/' '!/frontend/agent-demo/' '/package.json' '/package-lock.json' '/LICENSE' '/NOTICE.md' > .git/info/sparse-checkout
git checkout 54899e5ff3f2b002b457757916b3977818db6fc1
```

- [ ] **Step 2: Run the update**

Run: `python3 scripts/update_starnet.py --repo runs/upstream/starnet --revision 54899e5ff3f2b002b457757916b3977818db6fc1`
Expected: one JSON line with `"revision": "54899e5…"`, `"patches": 18` and `adapted` greater than 200. Brand rewrites touch many files.

- [ ] **Step 3: Confirm the 1Ultra files survived and the old archive is gone**

```bash
cd /home/adem/1ultra/station && ls ultra-host.js ultra-policy.js ultra-state.js ultra-patches.json frontend/campaign/index.html frontend/campaign/ultra-app.js && test ! -e source-archive/frontend-index.html && grep -c "1ULTRA\|1Ultra" frontend/index.html && ! grep -n "\bStarNet\b\|\bSTARNET\b" frontend/index.html
```

Expected: the files are listed, the count is positive, and the final `grep` prints nothing.

- [ ] **Step 4: Install pinned dependencies and run the source check**

```bash
cd /home/adem/1ultra/station && npm ci --ignore-scripts --no-audit --no-fund && cd .. && python3 scripts/check_station.py
```

Expected: `npm ci` succeeds (`ajv`, `undici` only), and `check_station.py` prints `"pinned_revision": "54899e5…"`.

- [ ] **Step 5: Boot the station on copied records**

Run: `python3 scripts/station_smoke.py`
Expected: exit 0 with all checks listed.

If it fails with "Station stopped:", the log tail names the boot-time error. For each error raised from a call that `policy.install()` blocks (for example `Live models and external connections are disabled` thrown from a top-level `setInterval`/`setImmediate`, or a `child_process` call at boot), add one patch to `station/ultra-patches.json` that turns that call into a no-op for 1Ultra. Use the same shape as `no-cron`: find the function's first line plus `\n`, and replace with that line plus `  return; // 1Ultra: follows the <switch> switch.\n`. Rerun Steps 2, 4 and 5. Record every added patch id and the error it fixed in `docs/ops/STATION.md` (Task 7).

- [ ] **Step 6: Run the unit suites and the baseline check**

Run: `node --test tests/station-policy.test.cjs tests/station-state.test.cjs tests/station-workflows.test.cjs tests/station-experience.test.cjs tests/station-ui-smoke.cjs && python3 -m unittest discover -s tests -v 2>&1 | tail -3 && sha256sum -c runs/phase1-business-baseline.sha256`
Expected: all PASS, `OK`, every baseline line `OK`.

---

### Task 4: Owner switches

**Files:**
- Create: `station/ultra-switches.js`, `tests/station-switches.test.cjs`
- Modify: `station/ultra-host.js` (create the store, add `/api/ultra/switches`, export `switches`)

**Interfaces:**
- Produces: `makeSwitches({ fs, path, file, providerIds = [], now = () => new Date().toISOString() })`, which returns:
  - `list() -> Array<{id,label,type,value,default,ready,needs,min?,max?}>`
  - `value(id) -> boolean|number` (throws `Unknown switch` for an unknown id)
  - `isOn(id) -> boolean`. Meta ids: `'channels'` is true when any `channels.*` switch is on, and `'providers'` when any `providers.*` switch is on.
  - `set(id, value) -> void`. Throws an `Error` with `.code` set to `'unknown' | 'not_ready' | 'invalid'`.
  - `version() -> string` (SHA-256 of the file bytes, or of `''` when the file is absent)
  - `CATALOG` (static entries)
- HTTP:
  - `GET /api/ultra/switches` returns `{switches, version}`.
  - `POST /api/ultra/switches {id, value}` requires header `If-Match: <version>`. It returns 409 on a stale version or when the switch is not ready, and 400 on unknown or invalid input.

- [ ] **Step 1: Write the failing test**

Create `tests/station-switches.test.cjs`:

```js
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const test=require('node:test');
const {makeSwitches}=require('../station/ultra-switches.js');
function store(extra={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ultra-switches-'));return makeSwitches({fs,path,file:path.join(dir,'ultra-switches.json'),now:()=>'2026-10-10T00:00:00.000Z',...extra});}
test('defaults: everything off except escalation (inert) and concurrency 2',()=>{
  const s=store();const byId=Object.fromEntries(s.list().map(r=>[r.id,r]));
  assert.equal(byId['lead.codex'].value,false);assert.equal(byId['crew.freellmapi'].value,false);
  assert.equal(byId['crew.escalate_to_lead'].value,true);assert.equal(byId.concurrency.value,2);assert.equal(byId.spend_cap_usd.value,0);
  for(const id of ['tools.web','tools.browser','tools.shell','tools.computer','tools.mcp','cron','nightshift','voice','skills.market','channels.telegram','channels.discord','channels.slack','channels.signal','channels.matrix'])assert.equal(byId[id].value,false,id);
  assert.deepEqual(s.list().filter(r=>r.ready).map(r=>r.id).sort(),['concurrency','spend_cap_usd']);
  assert.equal(s.isOn('channels'),false);assert.equal(s.isOn('providers'),false);
});
test('only ready switches change, with type and range checks and history',()=>{
  const s=store();
  assert.throws(()=>s.set('tools.web',true),e=>e.code==='not_ready');
  assert.throws(()=>s.set('nope',true),e=>e.code==='unknown');
  assert.throws(()=>s.set('concurrency','3'),e=>e.code==='invalid');
  assert.throws(()=>s.set('concurrency',0),e=>e.code==='invalid');
  assert.throws(()=>s.set('concurrency',9),e=>e.code==='invalid');
  assert.throws(()=>s.set('spend_cap_usd',-1),e=>e.code==='invalid');
  const before=s.version();s.set('concurrency',3);assert.notEqual(s.version(),before);assert.equal(s.value('concurrency'),3);
  const saved=JSON.parse(fs.readFileSync(s.file,'utf8'));
  assert.deepEqual(saved.history.at(-1),{at:'2026-10-10T00:00:00.000Z',id:'concurrency',from:2,to:3});
});
test('values persist across instances and provider switches are generated',()=>{
  const s=store({providerIds:['anthropic','openrouter']});s.set('spend_cap_usd',5);
  const again=makeSwitches({fs,path,file:s.file,providerIds:['anthropic','openrouter']});
  assert.equal(again.value('spend_cap_usd'),5);
  assert.deepEqual(again.list().filter(r=>r.id.startsWith('providers.')).map(r=>[r.id,r.value,r.ready]),[['providers.anthropic',false,false],['providers.openrouter',false,false]]);
  assert.throws(()=>again.value('providers.gemini'),/Unknown switch/);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test tests/station-switches.test.cjs`
Expected: FAIL with `Cannot find module '../station/ultra-switches.js'`.

- [ ] **Step 3: Write the switch store**

Create `station/ultra-switches.js`:

```js
'use strict';
// Owner-controlled feature switches. Agents may read them; only the owner route (same-origin page + token) writes.
// `ready:false` means the feature has not been unlocked and verified yet; later phases flip `ready` per switch.
const crypto=require('node:crypto');
const CATALOG=Object.freeze([
  {id:'lead.codex',label:'Lead agent on Codex (gpt-6.1-sol, xhigh)',type:'bool',default:false,ready:false,needs:'ChatGPT sign-in inside 1Ultra'},
  {id:'crew.freellmapi',label:'Crew agents on FreeLLMAPI',type:'bool',default:false,ready:false,needs:'FreeLLMAPI running with at least one provider key'},
  {id:'crew.escalate_to_lead',label:'Lead takes over crew work that fails on every free option',type:'bool',default:true,ready:false,needs:'lead.codex on'},
  {id:'tools.web',label:'Web search and page reading',type:'bool',default:false,ready:false,needs:''},
  {id:'tools.browser',label:'Agent-driven headless browser',type:'bool',default:false,ready:false,needs:'Playwright Chromium'},
  {id:'tools.shell',label:'Shell, terminal and files outside the agent workspace',type:'bool',default:false,ready:false,needs:''},
  {id:'tools.computer',label:'Desktop control and windows on your screen',type:'bool',default:false,ready:false,needs:''},
  {id:'tools.mcp',label:'MCP connectors and plugins',type:'bool',default:false,ready:false,needs:'A key or sign-in per connector'},
  {id:'channels.telegram',label:'Telegram (your own account)',type:'bool',default:false,ready:false,needs:'A bot token you create, plus owner pairing'},
  {id:'channels.discord',label:'Discord (your own account)',type:'bool',default:false,ready:false,needs:'A bot token you create, plus owner pairing'},
  {id:'channels.slack',label:'Slack (your own account)',type:'bool',default:false,ready:false,needs:'A bot token you create, plus owner pairing'},
  {id:'channels.signal',label:'Signal (your own account)',type:'bool',default:false,ready:false,needs:'A linked device, plus owner pairing'},
  {id:'channels.matrix',label:'Matrix (your own account)',type:'bool',default:false,ready:false,needs:'A bot account, plus owner pairing'},
  {id:'cron',label:'Scheduled routines',type:'bool',default:false,ready:false,needs:''},
  {id:'nightshift',label:'Night Shift: unattended work inside its leash',type:'bool',default:false,ready:false,needs:''},
  {id:'voice',label:'Push-to-talk and spoken replies',type:'bool',default:false,ready:false,needs:'An audio-capable provider'},
  {id:'skills.market',label:'Skill Market browsing and installs',type:'bool',default:false,ready:false,needs:''},
  {id:'concurrency',label:'Maximum simultaneous agent runs',type:'int',default:2,min:1,max:8,ready:true,needs:''},
  {id:'spend_cap_usd',label:'Spend cap for paid providers (USD)',type:'number',default:0,min:0,max:1000,ready:true,needs:''},
]);
function failure(code,message){return Object.assign(new Error(message),{code});}
function makeSwitches({fs,path,file,providerIds=[],now=()=>new Date().toISOString()}){
  const catalog=[...CATALOG,...providerIds.map(id=>({id:'providers.'+id,label:'Provider: '+id,type:'bool',default:false,ready:false,needs:'Your own key; paid use is refused while the spend cap is 0'}))];
  const byId=new Map(catalog.map(row=>[row.id,row]));
  function read(){if(!fs.existsSync(file))return {version:1,values:{},history:[]};const saved=JSON.parse(fs.readFileSync(file,'utf8'));return {version:1,values:saved.values||{},history:saved.history||[]};}
  function write(state){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(state,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,file);}
  function value(id){const row=byId.get(id);if(!row)throw failure('unknown','Unknown switch: '+id);const values=read().values;return Object.hasOwn(values,id)?values[id]:row.default;}
  function isOn(id){if(id==='channels'||id==='providers')return catalog.some(row=>row.id.startsWith(id+'.')&&value(row.id)===true);return value(id)===true;}
  function validate(row,v){
    if(row.type==='bool')return typeof v==='boolean';
    if(typeof v!=='number'||!Number.isFinite(v)||(row.type==='int'&&!Number.isInteger(v)))return false;
    return v>=row.min&&v<=row.max;
  }
  function set(id,v){
    const row=byId.get(id);if(!row)throw failure('unknown','Unknown switch: '+id);
    if(!row.ready)throw failure('not_ready','"'+row.label+'" is not available yet.');
    if(!validate(row,v))throw failure('invalid','Invalid value for "'+row.label+'".');
    const state=read(),from=Object.hasOwn(state.values,id)?state.values[id]:row.default;
    state.values[id]=v;state.history=[...state.history,{at:now(),id,from,to:v}].slice(-500);write(state);
  }
  function list(){return catalog.map(row=>({...row,value:value(row.id)}));}
  function version(){return crypto.createHash('sha256').update(fs.existsSync(file)?fs.readFileSync(file):'').digest('hex');}
  return {list,value,isOn,set,version,file,CATALOG:catalog};
}
module.exports={makeSwitches,CATALOG};
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test tests/station-switches.test.cjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the store into the host**

In `station/ultra-host.js`, after the line that defines `controlFile`, add:

```js
const switches=require('./ultra-switches.js').makeSwitches({fs,path,file:path.join(runtime,'ultra-switches.json'),
  providerIds:registry.listProviderProfiles().map(p=>p.id).filter(id=>!['codex','starnet'].includes(id))});
```

Replace `const gate=policy.makeGate()` with `const gate=policy.makeGate(()=>switches.value('concurrency'))`.

In `handle()`, directly before `if(p==='/api/ultra/readiness'`, add:

```js
    if(p==='/api/ultra/switches'){
      if(req.method==='GET')return json(res,200,{switches:switches.list(),version:switches.version()});
      if(req.method!=='POST')return json(res,405,{error:'Owner action requires POST.'});
      if(String(req.headers['if-match']||'')!==switches.version())return json(res,409,{error:'Switches changed. Reload before saving.'});
      try{switches.set(body.id,body.value);}catch(e){return json(res,e.code==='not_ready'?409:400,{error:e.message});}
      return json(res,200,{switches:switches.list(),version:switches.version()});
    }
```

Change the export line to `module.exports={root,runtime,policy,handle,classic,campaign,switches};`.

In `station/ultra-policy.js`, change `makeGate` to take the limit function. Task 5 rewrites this file; for now replace only this function:

```js
function makeGate(limit=()=>2){const desks=new Set();return {
  enter(desk){if(desks.has(desk))throw new Error('This desk already has an active job.');const max=limit();if(desks.size>=max)throw new Error('Only '+max+' preparation workers may run.');desks.add(desk);},
  leave(desk){desks.delete(desk);}, active(){return [...desks];}
};}
```

In `tests/station-policy.test.cjs`, change the message in the concurrency case from `/two/` to `/Only 2 preparation workers/`.

- [ ] **Step 6: Add switch checks to the HTTP smoke test**

In `scripts/station_smoke.py`, after the campaign-route block from Task 1, add:

```python
            sw = request('/api/ultra/switches')
            values = {row['id']: row['value'] for row in sw['switches']}
            assert values['lead.codex'] is False and values['concurrency'] == 2 and values['crew.escalate_to_lead'] is True
            request('/api/ultra/switches', {'id': 'tools.web', 'value': True}, sw['version'], expected=409)
            request('/api/ultra/switches', {'id': 'concurrency', 'value': 3}, 'stale', expected=409)
            sw = request('/api/ultra/switches', {'id': 'concurrency', 'value': 3}, sw['version'])
            assert {r['id']: r['value'] for r in sw['switches']}['concurrency'] == 3
            request('/api/ultra/switches', {'id': 'concurrency', 'value': 2}, sw['version'])
            checks.append('owner switches: defaults, readiness refusal, stale refusal, change')
```

- [ ] **Step 7: Run everything**

Run: `node --test tests/station-switches.test.cjs tests/station-policy.test.cjs && python3 scripts/station_smoke.py && python3 -m unittest discover -s tests 2>&1 | tail -1 && sha256sum -c runs/phase1-business-baseline.sha256`
Expected: PASS, the smoke exits 0 and lists the switches check, `OK`, every baseline line `OK`.

---

### Task 5: Classify every Starnet route and open the local ones

Today every upstream `/api/*` route is refused, so Starnet's interface cannot even load its save. This task classifies routes by path prefix: `local` routes answer, while each switch-guarded family answers only when its switch is on (none are in Phase 1). `policy.install()` still blocks all outbound network and process calls underneath, so a misclassified route can fail, but it cannot reach out.

**Files:**
- Modify: `station/ultra-policy.js` (rewrite), `station/ultra-host.js` (bound gates, route registry, `/api/ultra/route-classes`), `station/ultra-patches.json` (replace `route-pre-gate`, add `route-registry` and `route-gate`)
- Test: `tests/station-policy.test.cjs` (rewrite), `scripts/station_smoke.py`

**Interfaces:**
- Consumes: `switches.isOn(id)` from Task 4.
- Produces (`ultra-policy.js`):
  - `classifyPath(p) -> 'local'|'blocked'|'unclassified'|<switch id>|'channels'|'providers'`
  - `routeKey(routeEntry) -> string`
  - `gate(cls, switches) -> {ok, cls, error?, switch?}`
  - `routeGate(routeEntry, switches)`
  - `preGate(method, url, switches)`
  - `makeGate(limit)`, `runtimeAllowed(root, runtime)`, `install(runtime)`, `assertModelAllowed()`
- Produces (`ultra-host.js`): `preGate(method, url)`, `routeGate(r)`, `registerRoutes(routes)`, and `GET /api/ultra/route-classes -> {routes:[{key,cls}], unclassified:[key]}`.

- [ ] **Step 1: Write the failing test**

Replace `tests/station-policy.test.cjs` with:

```js
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test tests/station-policy.test.cjs`
Expected: FAIL with `Policy.classifyPath is not a function`.

- [ ] **Step 3: Rewrite the policy**

Replace `station/ultra-policy.js` with:

```js
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
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test tests/station-policy.test.cjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Bind the gates in the host and patch the server**

In `station/ultra-host.js`, before the `module.exports` line, add:

```js
let routeTable=[];
function registerRoutes(routes){routeTable=routes;}
const preGate=(method,url)=>policy.preGate(method,url,switches);
const routeGate=r=>policy.routeGate(r,switches);
```

In `handle()`, directly after the `/api/ultra/switches` block, add:

```js
    if(p==='/api/ultra/route-classes'&&req.method==='GET'){
      const routes=routeTable.map(r=>({key:policy.routeKey(r),cls:policy.classifyPath(policy.routeKey(r))}));
      return json(res,200,{routes,unclassified:routes.filter(r=>r.cls==='unclassified').map(r=>r.key)});
    }
```

Change the export line to `module.exports={root,runtime,policy,handle,classic,campaign,switches,preGate,routeGate,registerRoutes};`.

In `station/ultra-patches.json`, replace the `route-pre-gate` entry with these three entries:

```json
  {"id": "route-pre-gate", "file": "sidecar/index.js",
   "find": "const server = http.createServer((req, res) => {\n",
   "replace": "const server = http.createServer((req, res) => {\n  const ultraPre = ultraHost.preGate(req.method, String(req.url || '/'));\n  if (!ultraPre.ok) {\n    res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });\n    return res.end(JSON.stringify({ ok: false, error: ultraPre.error || 'Refused by 1Ultra policy.', switch: ultraPre.switch || null }));\n  }\n"},
  {"id": "route-registry", "file": "sidecar/index.js",
   "find": "function dispatchRoute(req, res) {\n",
   "replace": "ultraHost.registerRoutes(ROUTES);\nfunction dispatchRoute(req, res) {\n"},
  {"id": "route-gate", "file": "sidecar/index.js",
   "find": "    const out = r.h(req, res, gm);\n",
   "replace": "    const ultraGate = ultraHost.routeGate(r);\n    if (!ultraGate.ok) { res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ ok: false, error: ultraGate.error, switch: ultraGate.switch || null })); }\n    const out = r.h(req, res, gm);\n"}
```

Then rerun the update and the source check:

```bash
cd /home/adem/1ultra && python3 scripts/update_starnet.py --repo runs/upstream/starnet --revision 54899e5ff3f2b002b457757916b3977818db6fc1 && python3 scripts/check_station.py >/dev/null
```

Expected: `"patches": 20` (or more, if Task 3 Step 5 added patches) and a clean check.

- [ ] **Step 6: Add route checks to the HTTP smoke test**

In `scripts/station_smoke.py`, after the switches block, add:

```python
            classes = request('/api/ultra/route-classes')
            assert len(classes['routes']) > 300 and classes['unclassified'] == [], classes['unclassified']
            refused = request('/api/run', {'messages': []}, expected=403)
            assert refused['switch'] == 'lead.codex' and 'lead.codex' in refused['error']
            request('/api/save?agent=agent')  # local family answers 200 (request() raises on any other status)
            request('/v1/chat/completions', {'model': 'x'}, expected=403)
            checks.append('route classes: none unclassified; model route refused with its switch; local routes answer')
```

- [ ] **Step 7: Run everything**

Run: `node --test tests/station-policy.test.cjs tests/station-switches.test.cjs && python3 scripts/station_smoke.py && python3 -m unittest discover -s tests 2>&1 | tail -1 && sha256sum -c runs/phase1-business-baseline.sha256`
Expected: PASS, the smoke exits 0 and lists the route-classes check, `OK`, every baseline line `OK`.

If `unclassified` is not empty, add each listed prefix to `ROUTE_CLASSES`. Classify it as `local` only when its handler in `station/sidecar/index.js` reads or writes station state under `WORKSPACES` and calls no provider, network or child process. Otherwise use the matching switch. Add the path and its expected class to the first test case, then rerun.

---

### Task 6: Starnet windows, seeded lead and 1Ultra brand files

**Files:**
- Create: `station/ultra-seed.js`, `tests/station-seed.test.cjs`, `station/frontend/ultra-window.js`, `station/frontend/ultra-brand.css`, `scripts/build_station_brand.py`, `station/frontend/assets/brand/starnet-wordmark.svg` and `station/frontend/assets/brand/starnet-logo.png` (both written by the script; the file names are the paths upstream code loads, and the content is 1Ultra's)
- Modify: `station/ultra-host.js` (seed on load), `station/ultra-patches.json` (four `frontend/index.html` patches)

**Interfaces:**
- Produces:
  - `ultraSeed.files(nowMs) -> {'agent.save.json': object, 'agent.roster.json': object, '_commander.dossier.json': object}`
  - Window keys `campaign` and `ultra-switches`, registered with `StationUI.registerWindow`
  - Dock buttons `.bb[data-term="campaign"]` and `.bb[data-term="ultra-switches"]`

- [ ] **Step 1: Write the failing seed test**

Create `tests/station-seed.test.cjs`:

```js
const assert=require('node:assert/strict'),test=require('node:test');
const Seed=require('../station/ultra-seed.js');
test('seed resumes straight into the station on the codex provider without inventing business facts',()=>{
  const files=Seed.files(1760054400000);
  assert.deepEqual(Object.keys(files).sort(),['_commander.dossier.json','agent.roster.json','agent.save.json']);
  const save=files['agent.save.json'];
  assert.equal(save.agentId,'agent');assert.equal(save.doc.schema,'starnet.save');assert.equal(save.doc.version,5);
  assert.equal(save.doc.prov,'codex');assert.equal(save.doc.agent.name,'ULTRA');assert.equal(save.doc.agent.model,'gpt-6.1-sol');
  assert.deepEqual(save.doc.agents,[]);assert.equal(save.doc.agent.stats.xp,0);
  assert.equal(files['agent.roster.json'].agents[0].provider,'codex');
  assert.doesNotMatch(JSON.stringify(files),/StarNet|STARNET/);
  assert.doesNotMatch(JSON.stringify(files),/revenue|\bTND\b/i);
  assert.match(save.doc.agent.docs.manual,/^Drafts go to the Outbox for review\. Never claim a message was sent/);
  assert.deepEqual(save.doc.usage,{tokens:0,cost:0,calls:0});
  assert.match(files['_commander.dossier.json'].block,/Adem sends messages and records outcomes himself/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/station-seed.test.cjs`
Expected: FAIL with `Cannot find module '../station/ultra-seed.js'`.

- [ ] **Step 3: Write the seed module and seed on first boot**

Create `station/ultra-seed.js`:

```js
'use strict';
// First-boot workspace for Starnet's interface: one lead agent on the codex provider, so the station resumes onto the
// floor instead of the first-run ceremony. Written only when agent.save.json is absent; existing files are never touched.
const IDENTITY='You are ULTRA, the lead of Adem\'s 1Ultra station. You plan work, delegate to crew when crew is switched on, and report only what tools actually returned.';
const PURPOSE='Help Adem find Tunisian B2B leads and prepare truthful outreach and bounded data-pilot work for his review.';
const MANUAL='Drafts go to the Outbox for review. Never claim a message was sent, a reply received, a client won or money received; Adem records those outcomes himself.';
const CONTEXT='You run inside 1Ultra, a local station. The campaign window holds the sourced lead records. Owner switches decide which models, tools and connections exist.';
function stats(){return {xp:0,level:1,lifetimeXp:0,confidence:50,samples:0,counters:{},milestones:[]};}
function files(now){
  const agent={id:'agent',name:'ULTRA',color:'#5ad0ff',model:'gpt-6.1-sol',personaId:'worker-homie',purpose:PURPOSE,specialtyId:null,createdAt:now,
    docs:{identity:IDENTITY,purpose:PURPOSE,manual:MANUAL,context:CONTEXT},stats:stats()};
  return {
    'agent.save.json':{version:1,agentId:'agent',updatedAt:now,savedAt:now,doc:{schema:'starnet.save',version:5,updatedAt:now,agent,agents:[],
      usage:{tokens:0,cost:0,calls:0},prov:'codex',station:null,stationStats:stats(),profile:{v:1,tags:{},seed:null,enabled:true,total:0},
      dossier:{v:1,dims:{identity:[],stack:[],goals:[],style:[],standing_orders:[]},seededFrom:{},updatedAt:0},workstreams:[],activeId:null,generalId:null}},
    'agent.roster.json':{version:1,agents:[{agentId:'agent',name:'ULTRA',system:IDENTITY,model:'gpt-6.1-sol',provider:'codex',role:'lead orchestrator'}]},
    '_commander.dossier.json':{block:'The Commander is Adem, in Sousse, Tunisia. 1Ultra finds Tunisian B2B leads and prepares truthful outreach for small, bounded data pilots. Agents prepare drafts; Adem sends messages and records outcomes himself. Keep claims sourced and unknowns unknown.'},
  };
}
module.exports={files};
```

In `station/ultra-host.js`, after the `switches` definition, add:

```js
// First boot only: give Starnet's interface a lead so it resumes onto the station. Never overwrites existing files.
if(!fs.existsSync(path.join(runtime,'agent.save.json')))for(const [name,value] of Object.entries(require('./ultra-seed.js').files(Date.now())))
  if(!fs.existsSync(path.join(runtime,name)))durable(path.join(runtime,name),value);
```

Run: `node --test tests/station-seed.test.cjs`
Expected: PASS.

- [ ] **Step 4: Write the windows and brand styles**

Create `station/frontend/ultra-window.js`:

```js
/* 1Ultra windows inside the station: the Tunisia campaign (its own page, framed) and the owner switches. */
'use strict';
(() => {
  if (typeof StationUI === 'undefined' || !StationUI.registerWindow) return;
  const esc = StationUI.h.esc;
  StationUI.registerWindow('campaign', 'CAMPAIGN', body => {
    body.innerHTML = '<iframe class="ultra-frame" src="/campaign/#campaign" title="1Ultra Tunisia campaign"></iframe>';
  }, { console: true, className: 'ultra-campaign-win' });

  async function api(method, payload, version) {
    const headers = { 'X-Starnet-Token': window.__STARNET_API_TOKEN__ || '' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['If-Match'] = version || ''; }
    const r = await fetch('/api/ultra/switches', { method, headers, body: payload ? JSON.stringify(payload) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }
  function control(s) {
    const dis = s.ready ? '' : ' disabled';
    if (s.type === 'bool') return '<input type="checkbox" data-switch="' + esc(s.id) + '"' + (s.value ? ' checked' : '') + dis + '>';
    return '<input type="number" data-switch="' + esc(s.id) + '" value="' + esc(String(s.value)) + '" min="' + esc(String(s.min)) + '" max="' + esc(String(s.max)) + '" step="' + (s.type === 'int' ? '1' : '0.01') + '"' + dis + '>';
  }
  function row(s) {
    const note = s.ready ? (s.needs ? 'Needs: ' + s.needs : '') : 'Not available yet' + (s.needs ? ' · needs: ' + s.needs : '');
    return '<label class="ultra-sw-row"><span class="ultra-sw-label"><b>' + esc(s.label) + '</b><small>' + esc(s.id) + (note ? ' · ' + esc(note) : '') + '</small></span>' + control(s) + '</label>';
  }
  async function build(body) {
    body.innerHTML = '<div class="ultra-sw"><p class="dim">Loading switches…</p></div>';
    let data;
    try { data = await api('GET'); } catch (e) { body.innerHTML = '<div class="ultra-sw"><p class="bad">' + esc(e.message) + '</p></div>'; return; }
    body.innerHTML = '<div class="ultra-sw"><p>Only you can change these. Agents can read them. Emergency stop overrides every switch.</p><p class="bad ultra-sw-error" hidden></p>'
      + data.switches.map(row).join('')
      + '<p class="dim ultra-credit">1Ultra is built on the MIT-licensed StarNet code by Andrew Sims. It is not affiliated with or endorsed by StarNet.</p></div>';
    body.querySelectorAll('[data-switch]').forEach(input => input.addEventListener('change', async () => {
      const id = input.dataset.switch, value = input.type === 'checkbox' ? input.checked : Number(input.value);
      try { await api('POST', { id, value }, data.version); }
      catch (e) { const err = body.querySelector('.ultra-sw-error'); err.textContent = e.message; err.hidden = false; return; }
      build(body);
    }));
  }
  StationUI.registerWindow('ultra-switches', 'SWITCHES', build, { console: true, className: 'ultra-switches-win' });
})();
```

Create `station/frontend/ultra-brand.css`:

```css
/* 1Ultra additions to the station: framed campaign window and the owner switches list. */
.ultra-campaign-win .ultra-frame{display:block;width:100%;height:min(78vh,900px);border:0;border-radius:8px;background:#111a22}
@media (max-width:720px){.ultra-campaign-win .ultra-frame{height:72vh}}
.ultra-sw{display:grid;gap:8px;font-size:14px}
.ultra-sw-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border:1px solid rgba(255,255,255,.12);border-radius:8px}
.ultra-sw-label{display:grid;gap:2px;min-width:0}
.ultra-sw-label small{opacity:.75;overflow-wrap:anywhere}
.ultra-sw-row input[type=number]{width:7em}
.ultra-credit{margin-top:8px;font-size:12px}
/* Starnet's own paid subscription is not part of 1Ultra (its link would read "1ULTRA SUBSCRIPTION" after rebranding). */
#model-dock-subscription{display:none!important}
```

- [ ] **Step 5: Generate the brand files**

Create `scripts/build_station_brand.py`:

```python
"""Write 1Ultra's own brand images at the paths Starnet's interface loads (no Starnet artwork is used)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

BRAND = Path(__file__).resolve().parents[1] / 'station/frontend/assets/brand'
WORDMARK = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 54" width="320" height="54">'
            '<text x="160" y="42" text-anchor="middle" font-family="DejaVu Sans Mono, monospace" font-size="44" '
            'font-weight="700" letter-spacing="6" fill="#000">1ULTRA</text></svg>\n')


def main():
    BRAND.mkdir(parents=True, exist_ok=True)
    (BRAND / 'starnet-wordmark.svg').write_text(WORDMARK)
    image = Image.new('RGBA', (560, 160), (0, 0, 0, 0)); draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=96)
    box = draw.textbbox((0, 0), '1ULTRA', font=font)
    x = (560 - (box[2] - box[0])) // 2 - box[0]; y = (160 - (box[3] - box[1])) // 2 - box[1]
    draw.text((x + 4, y + 4), '1ULTRA', font=font, fill=(0, 70, 90, 255))
    draw.text((x, y), '1ULTRA', font=font, fill=(90, 208, 255, 255))
    image.save(BRAND / 'starnet-logo.png')
    print(f'Wrote {BRAND}/starnet-wordmark.svg and starnet-logo.png')


if __name__ == '__main__':
    main()
```

Run: `python3 scripts/build_station_brand.py && file station/frontend/assets/brand/starnet-logo.png`
Expected: `PNG image data, 560 x 160`.

- [ ] **Step 6: Patch the station page to load the windows and add dock buttons**

Append these entries to `station/ultra-patches.json`. Their `find` strings are post-rebrand text from upstream `frontend/index.html`:

```json
  {"id": "dock-campaign", "file": "frontend/index.html",
   "find": "      </div>\n    </div>\n    <div class=\"bb-group\" data-group=\"build\">",
   "replace": "        <button class=\"bb\" data-term=\"campaign\"><span class=\"bb-i\">◆</span><span class=\"bb-tx\"><b>CAMPAIGN</b><small>Tunisia leads, pitches &amp; your recorded outcomes</small></span></button>\n      </div>\n    </div>\n    <div class=\"bb-group\" data-group=\"build\">"},
  {"id": "dock-switches", "file": "frontend/index.html",
   "find": "        <button class=\"bb\" data-term=\"settings\" data-hint=\"settings\">",
   "replace": "        <button class=\"bb\" data-term=\"ultra-switches\"><span class=\"bb-i\">⏻</span><span class=\"bb-tx\"><b>SWITCHES</b><small>what agents may use — you decide</small></span></button>\n        <button class=\"bb\" data-term=\"settings\" data-hint=\"settings\">"},
  {"id": "ultra-window-script", "file": "frontend/index.html",
   "find": "<script src=\"app/windows/find.js\"></script>",
   "replace": "<script src=\"app/windows/find.js\"></script>\n<script src=\"ultra-window.js\"></script>"},
  {"id": "ultra-brand-css", "file": "frontend/index.html",
   "find": "</head>",
   "replace": "<link rel=\"stylesheet\" href=\"ultra-brand.css\">\n</head>"}
```

Run the update, the source check and the anchor sanity check:

```bash
cd /home/adem/1ultra && python3 scripts/update_starnet.py --repo runs/upstream/starnet --revision 54899e5ff3f2b002b457757916b3977818db6fc1 && python3 scripts/check_station.py >/dev/null && grep -c 'data-term="campaign"\|data-term="ultra-switches"\|ultra-window.js\|ultra-brand.css' station/frontend/index.html
```

Expected: a clean update and check, and the count `4`.

- [ ] **Step 7: Run everything**

Run: `node --test tests/station-seed.test.cjs tests/station-policy.test.cjs tests/station-switches.test.cjs tests/station-ui-smoke.cjs && python3 scripts/station_smoke.py && python3 -m unittest discover -s tests 2>&1 | tail -1 && sha256sum -c runs/phase1-business-baseline.sha256`
Expected: PASS, the smoke exits 0, `OK`, every baseline line `OK`.

---

### Task 7: Browser check, upstream test baseline and documentation

**Files:**
- Create: `tests/station-starnet-browser.cjs`, `docs/ops/STATION_UPSTREAM_TESTS.md`
- Modify: `scripts/station_browser_smoke.py` (add `--starnet`), `scripts/station_smoke.py` (pre-filled runtime check), `docs/ops/STATION.md`, `README.md` (station section)

- [ ] **Step 1: Write the Starnet browser journey**

Create `tests/station-starnet-browser.cjs`:

```js
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.ULTRA_PLAYWRIGHT_MODULE);
(async()=>{
  const base=process.env.ULTRA_BROWSER_BASE,out=process.env.ULTRA_BROWSER_OUTPUT;assert.equal(process.env.ULTRA_BROWSER_FIXTURE,'copied-records');
  const browser=await chromium.launch({executablePath:process.env.ULTRA_BROWSER_EXECUTABLE});
  try{
    for(const [name,viewport] of [['desktop',{width:1440,height:960}],['phone',{width:390,height:844}]]){
      const page=await browser.newPage({viewport});const external=[],errors=[];
      page.on('request',r=>{if(!r.url().startsWith(base+'/')&&!r.url().startsWith('data:')&&!r.url().startsWith('blob:'))external.push(r.url());});
      page.on('pageerror',e=>errors.push(String(e&&e.message||e)));
      await page.goto(base+'/');
      await page.waitForSelector('#bottombar',{state:'attached',timeout:20000});
      assert.equal(await page.locator('#screen-connect:visible').count(),0,'seeded station must not show the connect screen');
      assert.doesNotMatch(await page.title(),/StarNet/i);
      assert.equal(await page.locator('#model-dock-subscription:visible').count(),0,'no Starnet subscription link');
      await page.evaluate(()=>document.querySelector('.bb[data-term="campaign"]').click());
      const frame=page.frameLocator('.ultra-frame');await frame.locator('#lead-list').waitFor({timeout:20000});
      assert.ok(await frame.locator('#lead-list').innerText().then(t=>t.length>20),'campaign lead list rendered inside the window');
      await page.screenshot({path:path.join(out,'starnet-campaign-'+name+'.png')});
      await page.evaluate(()=>document.querySelector('.bb[data-term="ultra-switches"]').click());
      await page.waitForSelector('.ultra-sw-row');
      assert.equal(await page.locator('[data-switch="lead.codex"]').isDisabled(),true);
      assert.equal(await page.locator('[data-switch="concurrency"]').isDisabled(),false);
      assert.match(await page.locator('.ultra-credit').innerText(),/not affiliated/);
      await page.screenshot({path:path.join(out,'starnet-switches-'+name+'.png')});
      assert.deepEqual(external,[],'no external requests');
      assert.deepEqual(errors,[],'no uncaught page errors');
      await page.close();
    }
    console.log('starnet browser journey passed at desktop and 390px');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
```

In `scripts/station_browser_smoke.py`, add the argument `parser.add_argument('--starnet', action='store_true', help="Exercise Starnet's interface at / with the campaign window")`. Then change the test selection to:

```python
                journey = 'tests/station-starnet-browser.cjs' if args.starnet else ('tests/station-agents-browser.cjs' if args.agents else 'tests/station-experience-browser.cjs')
                subprocess.run(['node', str(project / journey)],
```

Run:

```bash
cd /home/adem/1ultra && python3 scripts/station_browser_smoke.py --starnet --playwright-module /home/adem/.npm/_npx/86170c4cd1c5da32/node_modules/playwright --browser /home/adem/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome --output runs/station-qa-phase1
python3 scripts/station_browser_smoke.py --playwright-module /home/adem/.npm/_npx/86170c4cd1c5da32/node_modules/playwright --browser /home/adem/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome --output runs/station-qa-phase1
```

Expected: `starnet browser journey passed at desktop and 390px`, and the existing experience journey passes against `/campaign/`.

Image 404s for Starnet sprites are expected in Phase 1, because Phase 2 adds the CC0 art. They are not page errors.

If the connect screen assertion fails, open `runs/station-qa-phase1/` screenshots and check that `runs/station-runtime`-style fixture seeding ran. The fixture runtime must contain `agent.save.json` after boot.

- [ ] **Step 2: Prove an existing runtime survives**

In `scripts/station_smoke.py`, before the first `subprocess.Popen` that starts the station, pre-fill the fixture runtime:

```python
        runtime = root / 'runtime'; runtime.mkdir()
        (runtime / 'ultra-control.json').write_text('{"halted": true}\n')
        (runtime / 'ultra-state.json').write_text(json.dumps({'version': 1, 'world': None, 'workstreams': None, 'companySessions': {}, 'crew': {}, 'memory': [], 'tasks': [], 'workflows': [], 'workflowRuns': {}, 'focus': None, 'settings': {'theme': 'dark', 'text': 16, 'reducedMotion': False}, 'history': [{'at': 'fixture', 'fields': ['settings']}]}) + '\n')
```

Inside the `try:` block, directly after the first `token = json.loads(re.search(r'window.__STARNET_API_TOKEN__=([^;]+);', page).group(1))` line, so that it runs before any job starts, add:

```python
            assert request('/api/ultra/runtime')['halted'] is True, 'existing emergency stop must survive'
            assert request('/api/ultra/runtime')['state']['history'][0]['at'] == 'fixture'
            assert (runtime / 'agent.save.json').is_file() and json.loads((runtime / 'agent.save.json').read_text())['doc']['agent']['name'] == 'ULTRA'
            request('/api/ultra/control', {'action': 'resume'})
            checks.append('existing runtime kept (stop, state); seed added only missing files')
```

Run: `python3 scripts/station_smoke.py`
Expected: exit 0, including the new check.

- [ ] **Step 3: Record the upstream fast-test baseline**

Run: `cd /home/adem/1ultra/station && timeout 3000 node scripts/run-fast-tests.mjs 2>&1 | tee ../runs/station-qa-phase1/upstream-fast.log | tail -40`

Create `docs/ops/STATION_UPSTREAM_TESTS.md` with the date, the revision `54899e5`, total passed/failed, and one row per failing test file. Each row gets a reason from this fixed list:

- `excluded-art` — the test reads `frontend/assets`, `frontend/agent-demo` or review pages
- `excluded-tooling` — the test reads `website/`, `dev/`, `qa/`, `loops/` or `src-tauri/`
- `policy` — the test boots `sidecar/index.js` and hits a 1Ultra refusal
- `patch` — the test asserts upstream text that a listed patch changed
- `brand` — the test asserts an exact upstream string the rebrand changed in a file it did not also rebrand
- `dependency` — the test needs `node-pty`, `@huggingface/transformers`, `kokoro-js` or `ogg-opus-decoder`, which Phase 1 does not install

A failure that fits none of these is a bug. Investigate it with superpowers:systematic-debugging before finishing Phase 1.

- [ ] **Step 4: Update the docs**

In `docs/ops/STATION.md`, replace the "Start" and "Source and checks" sections with this content:

```markdown
## Start

Requires Python 3.10+ and Node.js 20+. Install pinned dependencies once with `cd station && npm ci --ignore-scripts --no-audit --no-fund`, then run `python3 scripts/station.py` and open http://127.0.0.1:8541.

- `/` is the Starnet station (1Ultra build). **WORK → CAMPAIGN** opens the Tunisia campaign; **SYSTEM → SWITCHES** shows what agents may use.
- `/campaign/` is the campaign page on its own. `/classic/` is the original Python interface.
- Phase 1: every switch that reaches a model, the network or a schedule is off and not yet available. Only the worker limit and the spend cap can change.

## Updating Starnet

1. Fetch: inside `runs/upstream/starnet` (a code-only sparse clone; see the plan for the clone commands), run `git fetch origin feat/harness-backend && git checkout <commit>`.
2. Back up: `cp -a station runs/upstream/station-before-<commit>`.
3. Update: `python3 scripts/update_starnet.py --repo runs/upstream/starnet --revision <commit>`. A patch that no longer matches stops the update. Fix its `find` text in `station/ultra-patches.json` and rerun.
4. Check: `cd station && npm ci --ignore-scripts && cd .. && python3 scripts/check_station.py && python3 scripts/station_smoke.py`.

## Source and checks

Upstream: https://github.com/androoAGI/starnet at the revision in `station/UPSTREAM.json`. Display branding is rewritten to 1Ultra. `LICENSE` and `NOTICE.md` are byte-identical to upstream. Starnet art is not imported; `station/frontend/assets/` holds only 1Ultra-owned files. 1Ultra-owned files: `station/ultra-*.js`, `station/ultra-patches.json`, `station/frontend/campaign/`, `station/frontend/ultra-window.js`, `station/frontend/ultra-brand.css`, `station/frontend/assets/`. Upstream fast-test results and the reason for each failure are in `docs/ops/STATION_UPSTREAM_TESTS.md`.
```

Add the boot patches from Task 3 Step 5, if any, as a list under "Source and checks".

In `README.md`, replace the sentence `Open **http://127.0.0.1:8541**. The merged station requires` with:

```markdown
Open **http://127.0.0.1:8541** for the station: **WORK → CAMPAIGN** opens the Tunisia campaign and **SYSTEM → SWITCHES** shows what agents may use. The campaign page alone is at **http://127.0.0.1:8541/campaign/**. The merged station requires
```

- [ ] **Step 5: Final verification for Phase 1**

Run:

```bash
cd /home/adem/1ultra
python3 -m unittest discover -s tests -v 2>&1 | tail -3
node --test tests/station-policy.test.cjs tests/station-state.test.cjs tests/station-workflows.test.cjs tests/station-experience.test.cjs tests/station-ui-smoke.cjs tests/station-switches.test.cjs tests/station-seed.test.cjs
python3 scripts/check_station.py >/dev/null && python3 scripts/station_smoke.py >/dev/null && echo smoke-ok
sha256sum -c runs/phase1-business-baseline.sha256
```

Expected: `OK`, all Node tests pass, `smoke-ok`, and every baseline line `OK`. Report the results, the screenshots in `runs/station-qa-phase1/`, and the upstream-test baseline to the owner. Phase 1 changes no business fact, so `STATE.md` is not updated.

---

## Carried into later phase plans

Phase 1 leaves these spec items for the plans that follow:

- **Phase 2 (art):**
  - CC0 crew, prop and tile sprites at the paths the renderer loads, plus `CREDITS.md`.
  - VT323 font (OFL) and UI sounds, imported only if `frontend/assets/sfx/LICENSE.md` shows a third-party permissive license.
  - A browser check for zero failed image loads.
- **Phase 3 (models):**
  - Codex lead (`gpt-6.1-sol`, `xhigh`) and the FreeLLMAPI install and crew. Seed the four campaign crew members in `agents`.
  - Crew capability management (`station/ultra-crew-health.js`), the campaign toolset and the data deny-list.
  - Remove or hide Starnet's own cloud provider (`starnet`), its credits flows and its `starnetos.com` links. After rebranding they read as 1Ultra services.
  - Allow the specific outbound hosts in `policy.install()` that each enabled switch needs, and flip `ready` for `lead.codex`, `crew.freellmapi` and `crew.escalate_to_lead`.
- **Phase 4 (remaining features):** convert each Phase 1 no-op patch (`no-cron`, `no-nightshift`, `no-discovery`, `no-loops`, `no-quest-refresh`, `no-trigger-poll`, `no-shell-hooks`, `no-skill-market-pull`, `quiet-boot` restoration) into a switch check, test it with fixtures, and flip its switch to `ready`.
- **Phase 5 (docs):** add the `AGENTS.md` "Authority and scope" note on owner switches.
