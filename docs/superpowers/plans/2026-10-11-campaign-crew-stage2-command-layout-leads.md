# Campaign crew Stage 2: the command layout, room templates, campaign tools and the LEADS window

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adem applies one station preset, **1ULTRA COMMAND**.
- ULTRA works from a COMMAND room in the center, as the orchestrator.
- The crew (Research, Delivery, Sales, QA) sit at their own desks in the CAMPAIGN room next door.
- Six room templates wait for future work. ULTRA adds one when Adem asks.
- The crew can read a company's packet, check and save pitch drafts, and propose sourced leads through campaign tools.
- The campaign moves out of its framed page into a native **LEADS** window in the station's own design.

**Architecture:**
- **Layout.** Starnet's station templates (`frontend/app/stationtemplates.js`) build a preset from a center room plus 18 × 11 wings, and offer room kits to ULTRA's station builder (`station.plan` / `station.build`).
  - A 1Ultra data file, `station/frontend/ultra-templates.js`, adds the 1ULTRA COMMAND preset and six kits.
  - Three patches merge it into the templates, let a preset name and furnish its center room, and bind preset desks to agents.
  - BUILD MODE's station presets dialog gains a **1ULTRA** section.
- **Tools.** `station/ultra-campaign-tools.js` registers `campaign.*` tools in Starnet's tool registry, next to `team.health`.
  - They call the Python worker in process (`scripts/campaign_tools.py` through `scripts/campaign_rpc.py`), never over HTTP.
  - Read tools return a privacy-filtered company packet.
  - Write tools add crew drafts and proposed leads to `data/campaign-workbench.json` as unreviewed preparation. They never write `data/leads.json`.
- **LEADS.** `station/frontend/ultra-leads.js` registers a native station window (`StationUI.registerWindow`), styled by `station/frontend/ultra-leads.css` with Starnet's phosphor tokens.
  - It reads the existing `/api/ultra/workspace` and `/api/ultra/campaign` routes and uses three new owner actions.
  - **WORK → LEADS** replaces **WORK → CAMPAIGN**. The classic page stays reachable from LEADS until Stage 4 retires it.

**Tech Stack:** Node 20.3+ (station sidecar, browser JavaScript without a framework), Python 3 (campaign worker), `node:test`, `unittest`, Playwright browser checks.

**Spec:** `docs/superpowers/specs/2026-10-10-campaign-crew-design.md` (Stage 2: the Campaign room with four crew desks, the campaign toolset, the LEADS board). Adem refined it on 11 October 2026:
- "create a layout so agents can start working, and integrate campaign into the main page design"
- "create a new layout entirely, that uses ultra in the center as the orchestrator and a campaign room next to it, and room templates for future work"

Research for this plan: the code seams were read directly (anchors are given in each task). Prototypes in the controller's scratchpad confirmed that the preset builds and validates, that every 1Ultra kit plans and builds on all four sides with clear doorways and one-step undo, and that the server can load Adem's saved station with `WorldModel.deserialize`.

## Decisions this plan makes

| Topic | Decision | Why |
|---|---|---|
| How the new layout arrives | As a station preset Adem applies himself: BUILD → BUILD MODE → STATION PRESETS → 1ULTRA COMMAND, or by asking ULTRA ("replace the station with 1ULTRA COMMAND", approved on ULTRA's card). Never applied automatically. | Replacing a layout is Adem's decision. Starnet's preset flow keeps agents and conversations, stores a backup and offers RESTORE PREVIOUS. |
| Center room | The starter HOME room (the five essentials and the hero desk) renamed COMMAND, with screens, a meeting table and ULTRA's desk bound to `agent` | ULTRA is the orchestrator in the center. The essentials keep every Starnet tool available. |
| CAMPAIGN room | The east wing: four desks bound to `research`, `delivery`, `sales` and `qa`, plus an INTEL CAB, a dish, a server cart and a whiteboard. No line yet: Stage 3 stamps the Tunisia Lead Line into its open lower half. | With no bay, an agent uses gear from anywhere on the station (`worldmodel.js` `agentRoomId` returns null without a bay). So desks give the crew their own place without taking any power away. |
| Room templates for future work | Six 1Ultra kits: CAMPAIGN, LEAD RESEARCH (research line), DRAFT & CHECK (draft and QA loop), DELIVERY LAB, CLIENT PILOT and RECORDS. ULTRA's station builder adds them on request, and a ROOM TEMPLATES window lists them. | Starnet already offers kits to the station builder (`stationbuilder.js` `planRoom`). Upstream `test/station-builder.test.js` checks every kit for clear doorways, routing and one-step undo, which covers the 1Ultra kits too. |
| Preset count test | `test/station-templates.test.js` asserts exactly seven presets and will fail with an eighth. It is recorded in `STATION_UPSTREAM_TESTS.md` as a `patch` failure. | Hiding the preset from the catalog would also hide it from ULTRA's station builder. |
| Crew packet privacy | The packet whitelists company-level public fields. It drops `raw_import`, `history`, contact names, the lead's `contact_route` text (it can hold an email or phone number) and anything under `data/private/`. Contacts appear only as role, route type and source link. | Crew models run on free providers that may log prompts. The 30-day campaign rules allow public research and drafts only. |
| Agent writes | `campaign.save_draft` adds to `crew_drafts` and `campaign.propose_lead` adds to `proposals`, both in `data/campaign-workbench.json` through the worker. Adem adopts a crew draft or accepts a proposal in LEADS. | Agents never change `data/leads.json` or record an outcome (AGENTS.md). |
| Draft checks | `campaign.check_draft` is a deterministic script with named rules: scope, exclusions, suppression, a source older than 180 days, and claim rules (price, percentage, time promise, guarantee, invented clients). `save_draft` refuses a draft that has problems. | Script-first rule. The 180-day staleness limit is a setting in `campaign_tools.py`, labelled as such. |
| Owner quests | Approve-draft quests and the quest confirm hook move to the next plan (Stage 2b). LEADS keeps today's evidence-gated **Record real outcome** form. | Adem asked for the layout and the integrated campaign. The quest hook is a separate, owner-safety-critical change. |
| CAMPAIGN window | WORK → LEADS opens the native window. The old framed page stays registered and is linked from LEADS as "Classic campaign page". | It is removed in Stage 4, once LEADS and the line cover its features. |

## Global Constraints

- **Who works where.**
  - Implementers are Codex agents (`codex exec -m gpt-6.1-sol -c model_reasoning_effort="xhigh" -s workspace-write`).
  - Each runs in its own worktree `/home/adem/1ultra/.worktrees/s2-t<N>`, created from branch `campaign-crew`, with `station/node_modules` symlinked from the main checkout.
  - Implementers do **not** commit; the reviewer commits after review.
  - The Codex sandbox forbids sockets and may refuse child processes. Implementers run the tests a task names. When their sandbox refuses a test, they say so, and the reviewer runs it. The reviewer runs `scripts/station_smoke.py` and the browser checks.
- **Never hand-edit upstream files.** All changes to upstream Starnet files go through `station/ultra-patches.json` and `python3 scripts/update_starnet.py --repo /home/adem/1ultra/runs/upstream/starnet --revision 54899e5ff3f2b002b457757916b3977818db6fc1`.
  - Append new entries at the end of the array. Edit the file as raw text and never re-serialize the whole file, so existing literal Unicode stays as it is.
  - Each `find` must match exactly once in the rebranded upstream text, or in that text after the patches listed before it. `tests/test_ultra_patches.py` enforces this.
  - New 1Ultra files under `station/frontend/` are added to `OWNED` in `scripts/update_starnet.py`.
- **Records.** Business records stay read-only in tests: `sha256sum -c --quiet runs/stage1a-business-baseline.sha256` must pass after every task. Python tests use temporary roots (as `tests/test_campaign.py` does), never `data/`.
- **Network and live calls.** Tests never call a live model or the network. The only live step is Task 6 Step 9, after Adem says go for that exact check.
- **Data rule.** Only public research, campaign drafts and synthetic examples go to crew models. Agents still cannot read the 1Ultra project folder; campaign tools hand them a filtered packet instead.
- **No upstream regressions.** Upstream fast tests must not regress beyond `docs/ops/STATION_UPSTREAM_TESTS.md` (146 recorded failures → the same set, plus the one `station-templates` count failure this plan explains). A new failure is fixed, or explained in that file.
- **Design.** Native windows use Starnet's own tokens and classes: `--ph`, `--ph-dim`, `--ph-bright`, `--ph-faint`, `--gold`, `--ok`, `--warn`, `--bad`, `--panel`, `--panel2`, `--ink`, `--text`, and `bb sm` buttons and `dim` text. They lay out at 390 px with no horizontal scroll.
- **Node.** The station requires Node.js 20.3+.

## Review Focus

1. **Applying 1ULTRA COMMAND to Adem's busy station.** He has rooms, desks, bays and an INTEL CAB of his own. Applying the preset replaces rooms, props and belts, keeps agents and conversations, and RESTORE PREVIOUS brings his layout back. *Pinned by Task 1 Step 1 (the preset builds over a populated station's next ids) and Task 6 Step 2 (the browser applies it to a fixture and restores it).*
2. **A crew member that no longer exists.** The preset binds a desk to an agent id that may have been deleted. The desk stays as unassigned furniture, and nothing throws. *Pinned by Task 1 Step 1 (`build` binds by id only; the model never checks the roster).*
3. **A private field reaching a crew model.** A lead with `raw_import`, an email in `contact_route` and a named contact must yield a packet with none of them. *Pinned by Task 2 Step 1.*
4. **An agent proposing a known, excluded or foreign company.** Duplicates (same company name or website), excluded companies and non-Tunisian companies are refused with the reason. *Pinned by Task 3 Step 1.*
5. **LEADS open while the crew writes.** A crew draft changes the workbench version. Adem's next save in LEADS gets HTTP 409. The window reloads its data and says so, and no save is lost silently. *Pinned by Task 5 Step 1 (browser: a write between load and save).*

---

### Task 1: The 1ULTRA COMMAND station and the 1Ultra room kits

**Files:**
- Create: `station/frontend/ultra-templates.js`
- Modify: `station/ultra-patches.json` (six new entries at the end), regenerate `station/frontend/app/stationtemplates.js`, `station/frontend/app/build.js`, `station/frontend/index.html`, `station/UPSTREAM.json`
- Modify: `scripts/update_starnet.py` (`OWNED` gains `'frontend/ultra-templates.js'`)
- Test: `tests/station-templates-ultra.test.cjs` (new), `tests/test_ultra_patches.py`

**Interfaces:**
- Consumes: Starnet's `StationTemplates.build(id, model, sprites, nextId)`, `kits()`, `catalog`; `WorldModel` (`create`, `starterDoc`, `renameRoom`, `addProp`, `assignDesk`, `rooms`, `props`, `roomAt`); `PropSprites.spec(t)`.
- Produces: the global `UltraTemplates = { rooms, kitAbout, catalog }` (and `module.exports` in Node); the preset id `ultra-command`; the kit ids `ultraCampaign`, `ultraResearch`, `ultraDraftCheck`, `ultraDelivery`, `ultraPilot` and `ultraRecords`; preset group `ultra`. Task 5 reads `UltraTemplates`.

- [ ] **Step 1: Write the failing test**

Create `tests/station-templates-ultra.test.cjs`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const S = path.join(__dirname, '..', 'station');
const M = require(path.join(S, 'frontend/app/worldmodel.js'));
const T = require(path.join(S, 'frontend/app/stationtemplates.js'));
const Sprites = require(path.join(S, 'frontend/app/propsprites.js'));
const SB = require(path.join(S, 'frontend/app/stationbuilder.js'));
const U = require(path.join(S, 'frontend/ultra-templates.js'));
const { makeStationStore } = require(path.join(S, 'sidecar/station-store.js'));

const roomOf = (st, p) => st.roomById(st.roomAt(p.x, p.y)).name;

test('1ULTRA COMMAND puts ULTRA in a COMMAND room in the center and the crew in CAMPAIGN beside it', () => {
  const entry = T.catalog.find(c => c.id === 'ultra-command');
  assert.ok(entry, 'the preset is in the catalog');
  assert.equal(entry.group, 'ultra');
  assert.equal(entry.name, '1ULTRA COMMAND');
  const doc = T.build('ultra-command', M, Sprites);
  const v = makeStationStore().validateStationDoc(doc);
  assert.equal(v.ok, true, v.error);
  assert.equal(doc.meta.templateId, 'ultra-command');
  const st = M.create(doc);
  const names = st.rooms().filter(r => r.kind !== 'corridor').map(r => r.name).sort();
  assert.deepEqual(names, ['CAMPAIGN', 'COMMAND']);
  assert.equal(st.roomById(doc.meta.spawnRoomId).name, 'COMMAND', 'COMMAND is the spawn room, in the center');
  const seats = Object.fromEntries(st.props().filter(p => p.agentId).map(p => [p.agentId, roomOf(st, p)]));
  assert.deepEqual(seats, { agent: 'COMMAND', research: 'CAMPAIGN', delivery: 'CAMPAIGN', sales: 'CAMPAIGN', qa: 'CAMPAIGN' });
  const campaignGear = new Set(st.props().filter(p => roomOf(st, p) === 'CAMPAIGN').map(p => M.capForProp(p.t)).filter(Boolean));
  for (const cap of ['computer', 'cabinet', 'dish', 'notebook']) assert.ok(campaignGear.has(cap), 'CAMPAIGN brings ' + cap);
  const commandGear = new Set(st.props().filter(p => roomOf(st, p) === 'COMMAND').map(p => M.capForProp(p.t)).filter(Boolean));
  for (const cap of ['computer', 'cabinet', 'dish', 'notebook', 'workbench', 'studio']) assert.ok(commandGear.has(cap), 'COMMAND keeps the five essentials and the desk: ' + cap);
  for (const a of ['agent', 'research', 'sales']) assert.equal(st.agentRoomId(a), null, a + ' has no bay, so it keeps station-wide gear');
});

test('the preset builds over a populated station\'s ids and binds desks by id only', () => {
  const doc = T.build('ultra-command', M, Sprites, 900);
  assert.ok(doc._nid > 900);
  assert.ok(Object.keys(doc.rooms).every(id => Number(id.slice(1)) >= 900), 'room ids renumbered past the live station');
  const bound = doc.props.filter(p => p.agentId).map(p => p.agentId).sort();
  assert.deepEqual(bound, ['agent', 'delivery', 'qa', 'research', 'sales'], 'binding survives renumbering; ids need not exist yet');
});

test('the six 1Ultra room kits are offered to the station builder and each one builds cleanly', () => {
  const ids = T.kits().map(k => k.id);
  for (const id of ['ultraCampaign', 'ultraResearch', 'ultraDraftCheck', 'ultraDelivery', 'ultraPilot', 'ultraRecords']) assert.ok(ids.includes(id), id + ' is a kit');
  const env = { WorldModel: M, Pipeline: require(path.join(S, 'frontend/app/pipeline.js')), WorkflowLine: require(path.join(S, 'frontend/app/workflowline.js')),
    crew: [{ id: 'agent', name: 'ULTRA' }], heroId: 'agent', StationTemplates: T, PropSprites: Sprites, EquipmentHelp: require(path.join(S, 'frontend/app/equipmenthelp.js')) };
  for (const kit of T.kits().filter(k => k.id.startsWith('ultra'))) {
    assert.ok(kit.about.length > 10, kit.id + ' says what it is');
    const st = M.create(M.starterDoc());
    const r = SB.planRoom(st.serialize(), { kit: kit.name }, env);
    assert.equal(r.ok, true, kit.id + ': ' + (r.error || ''));
    const a = SB.apply(st, r.plan, env);
    assert.equal(a.ok, true, kit.id + ': ' + (a.error || ''));
    const nr = st.rooms().find(x => x.name === kit.name);
    assert.ok(nr, kit.id + ': a new room of that name');
    assert.ok(st.props().filter(p => st.roomAt(p.x, p.y) === nr.id).every(p => !p.agentId), kit.id + ': a kit never seats an agent');
    assert.equal(st.undo().ok, true);
  }
  const research = T.kits().find(k => k.id === 'ultraResearch');
  assert.equal(research.line.bp, 'research_line');
  assert.match(research.line.briefs.WRITER, /campaign\.propose_lead/);
  const draft = T.kits().find(k => k.id === 'ultraDraftCheck');
  assert.equal(draft.line.bp, 'revision_loop');
  assert.match(draft.line.briefs.REVIEWER, /VERDICT: approved or VERDICT: revise/);
});

test('Starnet\'s own presets are unchanged', () => {
  assert.deepEqual(T.catalog.filter(c => c.group !== 'ultra').map(c => c.id), ['software', 'research', 'creative', 'operations', 'cozy', 'default', 'retreat']);
  const doc = T.build('research', M, Sprites);
  assert.equal(M.create(doc).rooms().find(r => r.id === doc.meta.spawnRoomId).name, 'HOME', 'a preset without a center keeps HOME');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/station-templates-ultra.test.cjs`
Expected: FAIL (`Cannot find module .../frontend/ultra-templates.js`).

- [ ] **Step 3: Write the templates file**

Create `station/frontend/ultra-templates.js`:

```js
/* 1Ultra station templates: the 1ULTRA COMMAND station (ULTRA in the center, the crew's CAMPAIGN room beside it) and the
   1Ultra room kits for future work. Starnet's stationtemplates.js merges these (ultra-templates patches), so BUILD MODE's
   station presets, the setup preview and ULTRA's station builder all read them. Rooms are Starnet's 18 x 11 size.
   A prop is [type, x, y, facing?, seat?]: x/y are room tiles; seat binds a desk to that agent when the preset is built
   (one desk per agent). Kits never bind seats: ULTRA's station builder places their furniture unassigned. */
'use strict';
const UltraTemplates = (() => {
  const RULES = 'Prepare only: never send, publish, buy or record outcomes. Stay inside Tunisia, respect exclusions, and mark anything unverified as unknown.';
  const rooms = {
    ultraCampaign: { name: 'CAMPAIGN', kind: 'bridge', floorStyle: 'cobalt', floorMat: 'resin', props: [
      ['war_intelcab', 1, 0], ['whiteboard', 4, 0], ['comms_dish', 15, 0], ['gigs_servercart', 1, 9], ['plant', 17, 9],
      ['desk', 2, 3, 0, 'research'], ['desk', 6, 3, 0, 'delivery'], ['desk', 10, 3, 0, 'sales'], ['desk', 14, 3, 0, 'qa']] },
    ultraResearch: { name: 'LEAD RESEARCH', kind: 'lab', floorStyle: 'teal', floorMat: 'resin', props: [
      ['war_intelcab', 0, 0], ['desk', 3, 1], ['research_samplecart', 11, 1], ['comms_dish', 15, 0], ['bookshelf', 2, 8], ['bookshelf', 12, 8]],
      line: { bp: 'research_line', x: 0, y: 4, label: 'TUNISIA · LEAD RESEARCH', briefs: {
        RESEARCHER: 'Find Tunisian companies that could use a small, bounded data pilot. For each one record the source URL, the date you saw it and the exact quoted text, and check it with campaign.leads so you never repeat a known or excluded company. ' + RULES,
        WRITER: 'Turn the research notes into proposed leads with campaign.propose_lead: one Tunisian company each, with its country, source URL, observed date and quoted text. Then write a short list of what you proposed and what stays unknown. ' + RULES
      } } },
    ultraDraftCheck: { name: 'DRAFT & CHECK', kind: 'hab', floorStyle: 'ash', floorMat: 'plank', props: [
      ['desk', 3, 1], ['industrial_roundtable', 10, 2], ['dinerchair', 9, 2, 3], ['dinerchair', 12, 2, 1], ['bookshelf', 15, 1], ['plant', 17, 3]],
      line: { bp: 'revision_loop', x: 0, y: 4, label: 'TUNISIA · DRAFT & CHECK', briefs: {
        WRITER: 'Write a short French pitch for the company named in the job, using only its packet from campaign.lead: no invented facts, prices, deadlines or results. Run campaign.check_draft, fix every problem it lists, then save it with campaign.save_draft. If QA sent it back, fix exactly what QA asked. ' + RULES,
        REVIEWER: 'Check the pitch against the company packet (campaign.lead) and campaign.check_draft. List every problem you find. End with exactly one line: VERDICT: approved or VERDICT: revise. ' + RULES
      } } },
    ultraDelivery: { name: 'DELIVERY LAB', kind: 'lab', floorStyle: 'sterile', floorMat: null, props: [
      ['war_intelcab', 0, 0], ['desk', 3, 1], ['rack', 12, 1], ['plant', 16, 1], ['workbench', 12, 8], ['industrial_drawerbank', 2, 8]] },
    ultraPilot: { name: 'CLIENT PILOT', kind: 'hab', floorStyle: 'ash', floorMat: 'resin', props: [
      ['war_intelcab', 0, 0], ['desk', 3, 1], ['whiteboard', 12, 0], ['industrial_roundtable', 12, 6], ['dinerchair', 11, 6, 3], ['dinerchair', 14, 6, 1], ['plant', 17, 9]] },
    ultraRecords: { name: 'RECORDS', kind: 'storage', floorStyle: 'rust', floorMat: null, props: [
      ['bookshelf', 1, 1], ['bookshelf', 4, 1], ['rack', 12, 1], ['gigs_servercart', 16, 1], ['desk', 3, 8], ['safe', 15, 8]] }
  };
  const kitAbout = {
    ultraCampaign: 'the crew\'s campaign room: four desks, files, web and memory',
    ultraResearch: 'a lead research lab with a Research + write line that proposes sourced Tunisian companies',
    ultraDraftCheck: 'a draft and check room with a Draft + QA loop for company pitches',
    ultraDelivery: 'a delivery lab for one bounded pilot: a desk, a terminal workbench, files and a rack',
    ultraPilot: 'a client pilot room: a desk, files, a whiteboard and a meeting table',
    ultraRecords: 'a records room: bookshelves, a rack, a server cart and a safe'
  };
  const catalog = [
    { id: 'ultra-command', group: 'ultra', name: '1ULTRA COMMAND', rooms: 2,
      pitch: 'ULTRA orchestrates from the center, and the crew works the campaign next door',
      description: 'A command room in the center for ULTRA, your orchestrator, with all five essentials, and the CAMPAIGN room beside it with a desk for Research, Delivery, Sales and QA. The free sides take room templates as your work grows.',
      center: { name: 'COMMAND', seat: 'agent', props: [['screens', 10, 0], ['industrial_roundtable', 7, 5], ['dinerchair', 6, 5, 3], ['dinerchair', 9, 5, 1], ['plant', 0, 9], ['plant', 17, 9]] },
      wings: [['ultraCampaign', 'east']] }
  ];
  return { rooms, kitAbout, catalog };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = UltraTemplates;
```

- [ ] **Step 4: Add the patches**

Append these six entries at the end of `station/ultra-patches.json` (raw text, before the closing `]`). Each `find` occurs exactly once.

```json
{"id": "ultra-templates-merge", "file": "frontend/app/stationtemplates.js",
 "find": "  return { catalog: catalog.map(({wings,...entry}) => Object.freeze(entry)), guides, build, example, recommend, kits, presetKits };",
 "replace": "  /* 1Ultra: the 1ULTRA COMMAND station and the 1Ultra room kits (station/frontend/ultra-templates.js) join the catalog and the kits. */\n  const ULTRA_TEMPLATES = (typeof module !== 'undefined' && module.exports) ? require('../ultra-templates.js') : (typeof UltraTemplates !== 'undefined' ? UltraTemplates : null);\n  if (ULTRA_TEMPLATES) { catalog.push(...ULTRA_TEMPLATES.catalog); Object.assign(rooms, ULTRA_TEMPLATES.rooms); Object.assign(KIT_ABOUT, ULTRA_TEMPLATES.kitAbout); }\n  return { catalog: catalog.map(({wings,...entry}) => Object.freeze(entry)), guides, build, example, recommend, kits, presetKits };"},
{"id": "ultra-templates-center", "file": "frontend/app/stationtemplates.js",
 "find": "    const requireOK = r => { if (!r.ok) throw new Error(r.msg || r.error); return r; };\n",
 "replace": "    const requireOK = r => { if (!r.ok) throw new Error(r.msg || r.error); return r; };\n    // 1Ultra: a preset may name and furnish its center room and seat an agent at the center desk (1ULTRA COMMAND).\n    if (entry.center) {\n      const home = station.rooms()[0];\n      if (entry.center.name) requireOK(station.renameRoom(home.id, entry.center.name));\n      for (const [t,x,y,facing=0] of entry.center.props || []) {\n        const spec = sprites.spec(t);\n        if (!spec) throw new Error('Missing station furniture: '+t);\n        requireOK(station.addProp({t,x,y,w:spec.w,h:spec.h,r:facing,block:spec.blocks!==false}));\n      }\n      const desk = entry.center.seat && station.props().find(p => p.t === 'desk' && station.roomAt(p.x, p.y) === home.id);\n      if (desk) requireOK(station.assignDesk(desk.id, entry.center.seat));\n    }\n"},
{"id": "ultra-templates-seats", "file": "frontend/app/stationtemplates.js",
 "find": "      for (const [t,x,y,facing=0] of r.props) {\n        const spec = sprites.spec(t);\n        if (!spec) throw new Error('Missing station furniture: '+t);\n        requireOK(station.addProp({t,x:slot.x+x,y:slot.y+y,w:spec.w,h:spec.h,r:facing,block:spec.blocks!==false}));\n      }\n",
 "replace": "      for (const [t,x,y,facing=0,seat] of r.props) {\n        const spec = sprites.spec(t);\n        if (!spec) throw new Error('Missing station furniture: '+t);\n        const placed = requireOK(station.addProp({t,x:slot.x+x,y:slot.y+y,w:spec.w,h:spec.h,r:facing,block:spec.blocks!==false}));\n        if (seat) requireOK(station.assignDesk(placed.id, seat));   // 1Ultra: a preset desk can seat a named agent\n      }\n"},
{"id": "ultra-templates-group", "file": "frontend/app/build.js",
 "find": "  const PRESET_GROUPS = [\n",
 "replace": "  const PRESET_GROUPS = [\n    ['ultra', '1ULTRA', 'Stations for your 1Ultra work: ULTRA orchestrates from the center, and the crew works beside it.'],\n"},
{"id": "ultra-templates-section", "file": "frontend/app/build.js",
 "find": "(item.group === 'work' ? 'work' : 'look')",
 "replace": "(item.group === 'work' ? 'work' : item.group === 'ultra' ? 'ultra' : 'look')"},
{"id": "ultra-templates-script", "file": "frontend/index.html",
 "find": "<script src=\"app/stationtemplates.js\"></script>",
 "replace": "<script src=\"ultra-templates.js\"></script>\n<script src=\"app/stationtemplates.js\"></script>"}
```


Add `'frontend/ultra-templates.js'` to `OWNED` in `scripts/update_starnet.py`. Regenerate with the update command in Global Constraints.

In `tests/test_ultra_patches.py` add:

```python
    def test_ultra_templates_are_merged_and_seat_preset_desks(self):
        templates = (ROOT / 'station/frontend/app/stationtemplates.js').read_text()
        self.assertIn("require('../ultra-templates.js')", templates)
        self.assertIn('if (entry.center) {', templates)
        self.assertIn('if (seat) requireOK(station.assignDesk(placed.id, seat));', templates)
        build = (ROOT / 'station/frontend/app/build.js').read_text()
        self.assertIn("['ultra', '1ULTRA',", build)
        self.assertIn("item.group === 'ultra' ? 'ultra' : 'look'", build)
        index = (ROOT / 'station/frontend/index.html').read_text()
        self.assertLess(index.index('<script src="ultra-templates.js"></script>'), index.index('<script src="app/stationtemplates.js"></script>'))
```

- [ ] **Step 5: Run the tests**

Run: `node --test tests/station-templates-ultra.test.cjs && python3 -m unittest tests.test_ultra_patches tests.test_update_starnet -v`
Expected: PASS.

Also run the upstream template and builder tests on the generated tree (no sockets needed):

```bash
cd station && node test/station-builder.test.js && node test/desk-one-per-agent.test.js && node test/station-layout.test.js && node test/station-templates.test.js; cd ..
```

Expected: the first three pass. `station-templates.test.js` fails only on `assert.equal(T.catalog.length,7)` (now 8). Report its full output.

- [ ] **Step 6: Reviewer checks**

```bash
node --test tests/station-*.test.cjs tests/station-ui-smoke.cjs && python3 -m unittest discover -s tests && python3 scripts/check_station.py >/dev/null && python3 scripts/station_smoke.py | grep '"passed"'
PW=/home/adem/.npm/_npx/86170c4cd1c5da32/node_modules/playwright; BR=/home/adem/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome
for m in --starnet "" --agents; do python3 scripts/station_browser_smoke.py $m --playwright-module $PW --browser $BR --output runs/station-qa-stage2; done
sha256sum -c --quiet runs/stage1a-business-baseline.sha256 && echo records-unchanged
```

Expected: all pass; smoke 22.

- [ ] **Step 7: Commit (reviewer)**

```bash
git add station/frontend/ultra-templates.js station/ultra-patches.json station/frontend/app/stationtemplates.js station/frontend/app/build.js station/frontend/index.html station/UPSTREAM.json scripts/update_starnet.py tests/station-templates-ultra.test.cjs tests/test_ultra_patches.py
git commit -m "s2 t1: 1ULTRA COMMAND puts ULTRA in the center and the crew in CAMPAIGN; six room templates for future work"
```

---

### Task 2: Campaign packets for agents (`campaign.leads`, `campaign.lead`)

**Files:**
- Create: `scripts/campaign_tools.py`, `station/ultra-campaign-tools.js`
- Modify: `scripts/campaign_rpc.py` (tool routes), `station/ultra-host.js` (create and export the tools), `station/ultra-patches.json` (register the tools, capability rows, lead brief), regenerate `station/sidecar/index.js`, `station/sidecar/capability/registry.js`, `station/UPSTREAM.json`
- Test: `tests/test_campaign_tools.py` (new), `tests/station-campaign-tools.test.cjs` (new), `tests/test_ultra_patches.py`

**Interfaces:**
- Consumes: `campaign.Campaign(workspace)` (`read`, `leads`, `snapshot(offer)`, `suppressed`, `fingerprint`), `prospecting.in_scope`, the host's `call({route, method, body, version})` worker bridge (`station/ultra-host.js:45`), the host's `isHalted()`.
- Produces:
  - Python: `campaign_tools.leads(store, args) -> {offer, count, leads:[...]}` and `campaign_tools.packet(store, args) -> {lead, ranking, contacts, signals, proofs, draft, crew_drafts, suppressed, source_version}`; `campaign_tools.PACKET_FIELDS`.
  - Worker routes: `GET /api/tools/leads?offer=&query=&limit=` and `GET /api/tools/lead?id=`. They are reachable only from the in-process bridge: `ultra-host.js` refuses any HTTP request whose path starts with `/api/ultra/tools/`.
  - JS: `makeCampaignTools({call, isHalted}) -> {register(registry), brief()}`, with tool names `campaign.leads` and `campaign.lead`, `capability: 'campaign'`, `scope: 'read'`. Task 3 adds three more tools to the same module.
  - Capability rows under `computer` with `capId: 'campaign'`, so every agent with compute (ULTRA and the crew) gets the tools, the same way `quest.update` rides `computer` (`station/sidecar/capability/registry.js:18-30`).

- [ ] **Step 1: Write the failing Python test**

Create `tests/test_campaign_tools.py`:

```python
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import campaign
import campaign_tools
from ultra_ui import Workspace


class CampaignToolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'data').mkdir()
        self.lead = {'id': 'tn', 'company': 'Local ERP', 'kind': 'service_prospect', 'country': 'TN', 'location': 'Sfax',
            'mode': 'real', 'status': 'discovered', 'recommended_offer': 'catalogue', 'industry': 'ERP',
            'website': 'https://example.tn', 'source_url': 'https://example.tn/services', 'observed_fact': 'Published ERP services',
            'observed_text': 'Nous proposons des services ERP.', 'pitch_hook': 'Votre site présente des services ERP.',
            'checked_date': '2026-10-05', 'contact_route': 'ceo@example.tn; +216 20 000 000', 'exclusion_check': 'not_excluded',
            'source_live_checked': True, 'raw_import': {'Email': 'ceo@example.tn'}, 'history': [{'note': 'private'}]}
        self.foreign = {**self.lead, 'id': 'fr', 'company': 'Paris SA', 'country': 'FR'}
        (self.root / 'data/leads.json').write_text(json.dumps([self.lead, self.foreign]))
        (self.root / 'data/exclusions.json').write_text('{"companies":[]}')
        self.store = campaign.Campaign(Workspace(self.root, self.root))
        self.store.action('contact', {'lead_id': 'tn', 'name': 'Sami Ben Ali', 'role': 'Directeur', 'route': 'email',
            'source_url': 'https://example.tn/equipe', 'checked_on': '2026-10-05', 'relationship': 'none'}, self.store.version())

    def tearDown(self):
        self.temp.cleanup()

    def test_leads_lists_only_tunisian_companies_ranked(self):
        out = campaign_tools.leads(self.store, {})
        self.assertEqual([r['id'] for r in out['leads']], ['tn'])
        row = out['leads'][0]
        self.assertEqual(set(row), {'id', 'company', 'location', 'industry', 'stage', 'score', 'shortlisted', 'suppressed', 'has_draft', 'crew_drafts'})

    def test_packet_never_carries_private_fields(self):
        packet = campaign_tools.packet(self.store, {'id': 'tn'})
        text = json.dumps(packet, ensure_ascii=False)
        for secret in ('ceo@example.tn', '+216 20 000 000', 'Sami Ben Ali', 'raw_import', 'private'):
            self.assertNotIn(secret, text)
        self.assertEqual(set(packet['lead']), set(campaign_tools.PACKET_FIELDS) & set(self.lead) | {'has_contact_route'})
        self.assertIs(packet['lead']['has_contact_route'], True)
        self.assertEqual(packet['contacts'], [{'role': 'Directeur', 'route': 'email', 'source_url': 'https://example.tn/equipe', 'checked_on': '2026-10-05'}])
        self.assertEqual(packet['source_version'], campaign.fingerprint(self.lead))

    def test_packet_refuses_unknown_and_out_of_scope_companies(self):
        with self.assertRaises(ValueError): campaign_tools.packet(self.store, {'id': 'missing'})
        with self.assertRaises(ValueError): campaign_tools.packet(self.store, {'id': 'fr'})


if __name__ == '__main__':
    unittest.main()
```

Run: `python3 -m unittest tests.test_campaign_tools -v` → FAIL (`No module named 'campaign_tools'`).

- [ ] **Step 2: Implement `scripts/campaign_tools.py`**

Requirements (write the module to satisfy them and the tests above):
- `PACKET_FIELDS = ('id', 'company', 'country', 'location', 'industry', 'website', 'source_url', 'source_type', 'checked_date', 'observed_fact', 'observed_text', 'need_hypothesis', 'pitch_hook', 'recommended_offer', 'status', 'shortlisted', 'exclusion_check', 'buyer_need_confirmed', 'contact_sent')`. The packet copies only these fields that are present, plus `has_contact_route` (bool).
- `leads(store, args)`: `args` may hold `offer` (default `'documents'`, one of the offers the snapshot knows), `query` (case-insensitive substring of company, location or industry, at most 100 characters) and `limit` (1–50, default 20). Rows come from `store.snapshot(offer)['rankings']` order, filtered to `prospecting.in_scope(store.leads())`. Each row has exactly the fields the test names. `stage` uses `prospecting.stage(lead)`. `crew_drafts` is the count of that lead's crew drafts (`0` until Task 3).
- `packet(store, args)`: `args.id` must be an in-scope lead id, else `ValueError('Unknown or out-of-scope company.')`.
  - `ranking` is the lead's ranking row (`score`, `factors`, `unknowns`), or `None`.
  - `contacts` keeps `role`, `route`, `source_url` and `checked_on` only.
  - `signals` keeps `text`, `source_url`, `checked_on` and `hypothesis`.
  - `proofs` keeps `id`, `offer`, `reviewed` and `review_current`.
  - `draft` is `{'subject', 'body', 'reviewed'}` from the lead's current draft, or `None`.
  - `crew_drafts` is `[]` until Task 3.
  - `suppressed` is a bool. `source_version` is `campaign.fingerprint(lead)`.
- Neither function writes anything.

In `scripts/campaign_rpc.py` `dispatch`, before the existing GET branches:

```python
        if path == '/api/tools/leads': return campaign_tools.leads(store, {k: v[0] for k, v in parse_qs(route.query).items()})
        if path == '/api/tools/lead': return campaign_tools.packet(store, {k: v[0] for k, v in parse_qs(route.query).items()})
```

Import `campaign_tools` at the top. A `ValueError` becomes the worker's normal 400 answer.

- [ ] **Step 3: Write the failing node test**

Create `tests/station-campaign-tools.test.cjs`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeCampaignTools } = require('../station/ultra-campaign-tools.js');

function fakeRegistry() { const tools = new Map(); return { tools, register: t => tools.set(t.name, t) }; }

test('campaign tools register as read tools on the campaign capability and call the worker in process', async () => {
  const calls = [];
  const tools = makeCampaignTools({ call: async req => { calls.push(req); return { ok: true, route: req.route }; }, isHalted: () => false });
  const reg = fakeRegistry();
  tools.register(reg);
  for (const name of ['campaign.leads', 'campaign.lead']) {
    const t = reg.tools.get(name);
    assert.ok(t, name);
    assert.equal(t.capability, 'campaign');
    assert.equal(t.scope, 'read');
    assert.equal(t.requiresConsent, false);
  }
  const out = await reg.tools.get('campaign.lead').run({ id: 'tn' }, {});
  assert.equal(calls[0].route, '/api/tools/lead?id=tn');
  assert.equal(calls[0].method, 'GET');
  assert.match(out.content, /"route"/);
  await reg.tools.get('campaign.leads').run({ query: 'ERP & co', limit: 5 }, {});
  assert.equal(calls[1].route, '/api/tools/leads?query=ERP+%26+co&limit=5');
  assert.match(tools.brief(), /campaign\.lead/);
});

test('a worker refusal comes back as a readable tool error, never a crash', async () => {
  const tools = makeCampaignTools({ call: async () => { throw new Error('Unknown or out-of-scope company.'); }, isHalted: () => false });
  const reg = fakeRegistry(); tools.register(reg);
  const out = await reg.tools.get('campaign.lead').run({ id: 'x' }, {});
  assert.equal(out.summary, 'error');
  assert.match(out.content, /Unknown or out-of-scope company/);
});

test('the emergency stop refuses every campaign tool before the worker is called', async () => {
  let called = false;
  const tools = makeCampaignTools({ call: async () => { called = true; return {}; }, isHalted: () => true });
  const reg = fakeRegistry(); tools.register(reg);
  const out = await reg.tools.get('campaign.leads').run({}, {});
  assert.equal(called, false);
  assert.match(out.content, /emergency stop/i);
});
```

Run: `node --test tests/station-campaign-tools.test.cjs` → FAIL (module not found).

- [ ] **Step 4: Implement `station/ultra-campaign-tools.js`**

- `makeCampaignTools({call, isHalted})` returns `{register(registry), brief()}`.
- Each tool is `{name, capability: 'campaign', scope, requiresConsent: false, description, schema, run}`, in the same shape as `team.health` in `station/ultra-crew.js`.
- `run(args, ctx)` behaviour:
  - It refuses with `{content: 'The emergency stop is on: campaign tools are paused.', summary: 'error'}` while `isHalted()`.
  - It builds the route with `URLSearchParams` from the allowed args only: `offer`, `query` and `limit` for `campaign.leads`; `id` for `campaign.lead`.
  - It awaits `call({route, method: 'GET', body: null, version: ''})` and returns `{content: JSON.stringify(result), summary}`.
  - A thrown error becomes `{content: 'Campaign tool error: ' + message, summary: 'error'}`.
- Descriptions (plain words, used by the model):
  - `campaign.leads`: "List the Tunisian companies on Adem's campaign board, ranked, with stage and score. Optional: offer, query, limit (1–50). Read-only."
  - `campaign.lead`: "Read one company's checked packet by id: public source facts, ranking reasons, contact roles (no names), signals, proofs and drafts. Use it before any research, pitch or check about that company. Read-only."
- `brief()` returns: `"[CAMPAIGN] Campaign tools read Adem's Tunisia campaign: campaign.leads lists companies and campaign.lead gives one company's checked packet. Hand the crew the packet, never your own guesses. Nothing is ever sent: Adem reviews every draft and proposed lead in LEADS."`

In `station/ultra-host.js`:
- Create the tools after `call` is defined: `const campaignTools=require('./ultra-campaign-tools.js').makeCampaignTools({call,isHalted});`.
- Export `registerCampaignTools:registry=>campaignTools.register(registry)` and `campaignBrief:()=>campaignTools.brief()`.
- At the top of the HTTP handler, refuse paths under `/api/ultra/tools/`: `if(p.startsWith('/api/ultra/tools/'))return json(res,404,{error:'Not found.'});`.

Patches (append at the end of `station/ultra-patches.json`; check each anchor occurs exactly once):
- `campaign-tools-register` in `sidecar/index.js`: find `  ultraHost.crew.registerTools(registry);\n`, replace with that line plus `  ultraHost.registerCampaignTools(registry);\n`.
- `campaign-tools-capability` in `sidecar/capability/registry.js`: find `      { capId: 'compute', tool: 'model.chat', scope: 'execute', requiresConsent: false, network: true },\n`, replace with that line plus:
  ```
      // 1Ultra: the campaign tools ride compute, like quest.update, so ULTRA and every crew member can read the campaign.
      { capId: 'campaign', tool: 'campaign.leads', scope: 'read', requiresConsent: false, network: false },
      { capId: 'campaign', tool: 'campaign.lead', scope: 'read', requiresConsent: false, network: false },
  ```
- `campaign-tools-brief` in `sidecar/index.js`: find `    if (resolved.tools.includes('team.health')) teamNote += '\n' + ultraHost.crew.leadBrief();\n`, replace with that line plus `    if (resolved.tools.includes('campaign.lead')) teamNote += '\n' + ultraHost.campaignBrief();\n`.

Add source assertions for the three patches to `tests/test_ultra_patches.py`.

- [ ] **Step 5: Run the tests**

Run: `python3 -m unittest tests.test_campaign_tools tests.test_campaign tests.test_ultra_patches -v && node --test tests/station-campaign-tools.test.cjs tests/station-crew-supervisor.test.cjs`
Expected: PASS.

- [ ] **Step 6: Reviewer checks** — as Task 1 Step 6. Also, with the station from the smoke fixture, confirm `curl -s -H "X-Starnet-Token: $TOKEN" http://127.0.0.1:$PORT/api/ultra/tools/lead?id=x` answers 404. The smoke in Task 6 makes this permanent.

- [ ] **Step 7: Commit (reviewer)** — `git commit -m "s2 t2: agents read campaign packets with campaign.leads and campaign.lead, privacy-filtered"`

---

### Task 3: Crew drafting tools (`campaign.check_draft`, `campaign.save_draft`, `campaign.propose_lead`)

**Files:**
- Modify: `scripts/campaign_tools.py`, `scripts/campaign_rpc.py`, `scripts/campaign.py` (owner actions), `station/ultra-campaign-tools.js`, `station/ultra-patches.json` (three more capability rows: edit the `campaign-tools-capability` entry's `replace` as raw text), regenerate `station/sidecar/capability/registry.js`, `station/UPSTREAM.json`
- Test: `tests/test_campaign_tools.py`, `tests/station-campaign-tools.test.cjs`, `tests/test_ultra_patches.py`

**Interfaces:**
- Produces:
  - Python: `campaign_tools.check_draft(store, args) -> {ok, problems:[{rule, text}], lead_id, source_version}`; `campaign_tools.save_draft(store, args, agent_id) -> {id, lead_id, ...}`; `campaign_tools.propose_lead(store, args, agent_id) -> {id, company, ...}`; `campaign_tools.STALE_SOURCE_DAYS = 180` (a setting, not a sourced rule); `campaign_tools.CLAIM_RULES` (list of `(rule, compiled regex, message)`).
  - Worker routes (bridge only): `POST /api/tools/check-draft`, `POST /api/tools/save-draft`, `POST /api/tools/propose-lead`. The body is the tool args plus `agent_id` from the host.
  - Owner actions on `POST /api/ultra/campaign/<action>` (versioned like the others):
    - `crew-draft-status` `{id, status: 'adopted'|'dismissed'}`
    - `proposal-status` `{id, status: 'rejected', reason}`
    - `accept-proposal` `{id}`: adds the company to `data/leads.json` through the worker, as `source_type: 'crew_proposal'`, `status: 'discovered'`, `source_live_checked: false`, `contact_route: None`.
  - JS tools: `campaign.check_draft` (`scope: 'read'`), and `campaign.save_draft` and `campaign.propose_lead` (`scope: 'write'`, `requiresConsent: false`). The write tools pass `ctx.agentId` (or `'unknown'`) as `agent_id`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_campaign_tools.py`:

```python
    def test_check_draft_names_each_broken_rule(self):
        bad = ('Bonjour, pour 500 DT nous garantissons 99 % de précision en 48h, '
               'comme pour nos clients actuels.')
        out = campaign_tools.check_draft(self.store, {'lead_id': 'tn', 'body': bad})
        self.assertFalse(out['ok'])
        self.assertEqual({p['rule'] for p in out['problems']}, {'price', 'percentage', 'time_promise', 'guarantee', 'invented_clients'})
        good = campaign_tools.check_draft(self.store, {'lead_id': 'tn', 'body': 'Bonjour, votre site présente des services ERP. Un court échange vous intéresserait-il ?'})
        self.assertTrue(good['ok'], good['problems'])

    def test_check_draft_flags_scope_suppression_and_stale_source(self):
        with self.assertRaises(ValueError): campaign_tools.check_draft(self.store, {'lead_id': 'fr', 'body': 'Bonjour'})
        old = {**self.lead, 'id': 'old', 'company': 'Old SARL', 'checked_date': '2025-01-01'}
        (self.root / 'data/leads.json').write_text(json.dumps([self.lead, old]))
        out = campaign_tools.check_draft(self.store, {'lead_id': 'old', 'body': 'Bonjour, une question courte.'})
        self.assertIn('stale_source', {p['rule'] for p in out['problems']})

    def test_save_draft_refuses_problems_and_keeps_a_checked_unreviewed_draft(self):
        before = (self.root / 'data/leads.json').read_bytes()
        with self.assertRaises(ValueError): campaign_tools.save_draft(self.store, {'lead_id': 'tn', 'body': 'Garanti à 100 %.'}, 'sales')
        saved = campaign_tools.save_draft(self.store, {'lead_id': 'tn', 'subject': 'Services ERP', 'body': 'Bonjour, votre site présente des services ERP.'}, 'sales')
        self.assertEqual((saved['lead_id'], saved['agent_id'], saved['reviewed'], saved['status']), ('tn', 'sales', False, 'proposed'))
        self.assertEqual(saved['source_version'], campaign.fingerprint(self.lead))
        self.assertEqual((self.root / 'data/leads.json').read_bytes(), before, 'an agent never writes leads.json')
        self.assertEqual(campaign_tools.packet(self.store, {'id': 'tn'})['crew_drafts'][0]['id'], saved['id'])

    def test_propose_lead_refuses_duplicates_exclusions_and_foreign_companies(self):
        base = {'company': 'Nouvelle Data SARL', 'country': 'Tunisia', 'location': 'Tunis', 'website': 'https://nouvelle.tn',
                'source_url': 'https://nouvelle.tn/a-propos', 'observed_on': '2026-10-10', 'quote': 'Nous numérisons des archives pour nos clients.'}
        made = campaign_tools.propose_lead(self.store, base, 'research')
        self.assertEqual((made['status'], made['agent_id']), ('proposed', 'research'))
        for change, reason in [({'company': 'Local ERP', 'website': 'https://other.tn'}, 'Duplicate company'),
                               ({'company': 'Other Co', 'website': 'https://example.tn'}, 'Duplicate company website'),
                               ({}, 'Already proposed'),
                               ({'company': 'Lyon SA', 'website': 'https://lyon.fr', 'country': 'France'}, 'outside Tunisia')]:
            with self.assertRaisesRegex(ValueError, reason): campaign_tools.propose_lead(self.store, {**base, **change}, 'research')
        (self.root / 'data/exclusions.json').write_text('{"companies":[{"company":"Blocked SA"}]}')
        with self.assertRaisesRegex(ValueError, 'Company excluded'): campaign_tools.propose_lead(self.store, {**base, 'company': 'Blocked SA', 'website': 'https://blocked.tn'}, 'research')

    def test_owner_accepts_a_proposal_into_leads_and_rejects_another(self):
        made = campaign_tools.propose_lead(self.store, {'company': 'Nouvelle Data SARL', 'country': 'Tunisia', 'location': 'Tunis', 'website': 'https://nouvelle.tn',
            'source_url': 'https://nouvelle.tn/a-propos', 'observed_on': '2026-10-10', 'quote': 'Nous numérisons des archives.'}, 'research')
        self.store.action('accept-proposal', {'id': made['id']}, self.store.version())
        added = [l for l in json.loads((self.root / 'data/leads.json').read_text()) if l['company'] == 'Nouvelle Data SARL'][0]
        self.assertEqual((added['source_type'], added['status'], added['source_live_checked'], added['contact_route'], added['country']), ('crew_proposal', 'discovered', False, None, 'TN'))
        self.assertEqual(added['observed_text'], 'Nous numérisons des archives.')
        other = campaign_tools.propose_lead(self.store, {'company': 'Autre SARL', 'country': 'TN', 'location': 'Sousse', 'source_url': 'https://autre.tn',
            'observed_on': '2026-10-10', 'quote': 'Archives papier à numériser.'}, 'research')
        self.store.action('proposal-status', {'id': other['id'], 'status': 'rejected', 'reason': 'Too small'}, self.store.version())
        self.assertEqual(self.store.read()['proposals'][-1]['status'], 'rejected')
```

Add to `tests/station-campaign-tools.test.cjs`:

```js
test('drafting tools pass the calling agent and use the right scopes', async () => {
  const calls = [];
  const tools = makeCampaignTools({ call: async req => { calls.push(req); return { ok: true }; }, isHalted: () => false });
  const reg = fakeRegistry(); tools.register(reg);
  assert.equal(reg.tools.get('campaign.check_draft').scope, 'read');
  assert.equal(reg.tools.get('campaign.save_draft').scope, 'write');
  assert.equal(reg.tools.get('campaign.propose_lead').scope, 'write');
  await reg.tools.get('campaign.save_draft').run({ lead_id: 'tn', body: 'Bonjour', agent_id: 'forged' }, { agentId: 'sales' });
  assert.deepEqual(calls[0], { route: '/api/tools/save-draft', method: 'POST', body: { lead_id: 'tn', body: 'Bonjour', agent_id: 'sales' }, version: '' });
  await reg.tools.get('campaign.propose_lead').run({ company: 'X' }, {});
  assert.equal(calls[1].body.agent_id, 'unknown');
});
```

Run both → FAIL.

- [ ] **Step 2: Implement**

Python (`scripts/campaign_tools.py`):
- `CLAIM_RULES`. Each regex is case-insensitive and covers French and English:
  - `price`: a number followed by DT, TND, dinar(s), €, EUR, euro(s), $ or USD.
  - `percentage`: a number followed by `%`.
  - `time_promise`: "en/in/within/sous" followed by a number and an hour, day or week word, or a bare `24h`/`48h`/`72h`.
  - `guarantee`: `garanti…`, `guarantee…`, or `100 %`.
  - `invented_clients`: `nos clients`, `our clients`, `déjà travaillé avec`, `already worked with`, or `références clients`.
- Each rule has a plain message, for example `'Remove the price: prices are agreed with Adem, never promised in a first message.'`.
- `check_draft(store, args)`:
  - `lead_id` must be in scope (else `ValueError`).
  - `body` must be 1–8000 characters, and `subject` at most 200.
  - Problems:
    - every `CLAIM_RULES` match
    - `excluded` when the lead's `exclusion_check` is not `'not_excluded'` or the company is in `data/exclusions.json`
    - `suppressed` when `campaign.suppressed(state, lead_id)`
    - `stale_source` when `checked_date` is missing or more than `STALE_SOURCE_DAYS` days before `records.local_today()`
  - It returns `ok = not problems`.
- `save_draft(store, args, agent_id)`:
  - It runs `check_draft` and raises `ValueError('Fix these first: ' + '; '.join(messages))` when there are problems.
  - Otherwise it appends to `state['crew_drafts']` (create the list when absent): `{id: 'cd-' + 8 hex, lead_id, agent_id, subject, body, language: 'fr' unless args say 'en', source_version, created_at: UTC ISO, status: 'proposed', reviewed: False}`.
  - It keeps at most the newest 5 per lead and writes with `workspace.atomic_json` under `workspace.lock`. Mirror `Campaign.action`'s write, without the owner version check.
- `propose_lead(store, args, agent_id)`:
  - `company` is 2–200 characters.
  - `country` must pass `prospecting.tunisian(country)` (TN, Tunisia, Tunisie or تونس), else `'Company country is outside Tunisia or unknown'`. `location` is an optional city (at most 100 characters).
  - `source_url` and an optional `website` are http(s) with a host.
  - `observed_on` is a date no later than today.
  - `quote` is 10–1000 characters.
  - Refusals use the same normalisation as `prospecting.preview_import`, checked in this order: country, then `'Company excluded'` for an exclusion, `'Duplicate company'` for a known lead's name, `'Duplicate company website'` for a known website, and `'Already proposed'` for an open proposal with the same name or website.
  - It appends `{id: 'pl-' + 8 hex, company, country: 'TN', location, industry, website, source_url, observed_on, quote, agent_id, status: 'proposed', created_at}` to `state['proposals']`, with at most 200 open proposals.
- `packet` and `leads` now fill `crew_drafts` from `state.get('crew_drafts', [])`.

Python (`scripts/campaign.py` `mutate`), new owner actions in `allowed`:
- `'crew-draft-status': {'id', 'status'}` (`status` in `{'adopted', 'dismissed'}`)
- `'proposal-status': {'id', 'status', 'reason'}` (`status == 'rejected'`, reason 3–300 characters)
- `'accept-proposal': {'id'}`. It builds one lead row with the same shape `prospecting.preview_import` gives accepted rows, with these values:
  - `country: 'TN'`, and `location` from the proposal or `'Tunisia'`
  - `source_type: 'crew_proposal'`
  - `source_reference: 'Crew proposal ' + id + ' by ' + agent_id`
  - `observed_fact` and `observed_text` are the quote
  - `checked_date` is `observed_on`
  - `raw_import` is absent, `contact_route` is `None` and `import_row` is absent
  - a fresh `id` generated the way the CSV import commit does

  The action rechecks duplicates and exclusions, appends the row through the same `Workspace` method the CSV import commit uses for `data/leads.json`, and marks the proposal `accepted`.

Read each existing helper before reusing it, and keep the refusal wording above.

`scripts/campaign_rpc.py`: the three `POST /api/tools/...` routes call the functions with `body.pop('agent_id', 'unknown')`.

JS (`station/ultra-campaign-tools.js`):
- Add the three tools. `campaign.check_draft` takes `{lead_id, subject?, body}`. `campaign.save_draft` takes the same plus `language?`. `campaign.propose_lead` takes `{company, country, location?, industry?, website?, source_url, observed_on, quote}`.
- Copy only those keys from args. Set `agent_id` from `ctx.agentId`, never from args.
- Descriptions:
  - `campaign.check_draft`: "Check a pitch draft for one company against Adem's rules (no prices, percentages, time promises, guarantees or invented clients; scope, exclusions, suppression, source age). Read-only. Fix every problem before saving."
  - `campaign.save_draft`: "Save a checked pitch draft for one company as unreviewed. Adem reviews it in LEADS. Refused while the draft has problems. Never sends anything."
  - `campaign.propose_lead`: "Propose one new Tunisian company with its source URL, the date you saw it and the exact quoted text. Refused for known, excluded or non-Tunisian companies. Adem accepts or rejects it in LEADS."

Patch: edit the `campaign-tools-capability` entry's `replace` (raw text) to add three rows: `campaign.check_draft` (read), `campaign.save_draft` (write) and `campaign.propose_lead` (write), all with `capId: 'campaign'`, `requiresConsent: false`, `network: false`. Extend the source assertion.

- [ ] **Step 3: Run the tests**

Run: `python3 -m unittest tests.test_campaign_tools tests.test_campaign tests.test_prospecting tests.test_ultra_patches -v && node --test tests/station-campaign-tools.test.cjs`
Expected: PASS.

- [ ] **Step 4: Reviewer checks** — as Task 1 Step 6.

- [ ] **Step 5: Commit (reviewer)** — `git commit -m "s2 t3: the crew checks and saves pitch drafts and proposes sourced leads, all unreviewed until Adem decides"`

---

### Task 4: The LEADS window: board and company card in the station's design

**Files:**
- Create: `station/frontend/ultra-leads.js`, `station/frontend/ultra-leads.css`
- Modify: `station/ultra-patches.json` (edit `dock-campaign` so WORK shows LEADS; add the stylesheet and script tags), regenerate `station/frontend/index.html`, `station/UPSTREAM.json`; `scripts/update_starnet.py` (`OWNED` gains both files)
- Modify: `tests/station-starnet-browser.cjs` (LEADS journey; CAMPAIGN iframe check moves behind the classic link)
- Test: `tests/station-leads.test.cjs` (new, pure view functions), `tests/test_ultra_patches.py`

**Interfaces:**
- Consumes: `GET /api/ultra/workspace` (`hunt.leads`, `hunt.offers`, `record_versions.leads`), `GET /api/ultra/campaign?offer=` (`rankings`, `analytics.counts`, `events`, `contacts`, `signals`, `followups`, `variants`, `proofs`, `suppressed_ids`, `crew_drafts`, `proposals`, `version`), `POST /api/ultra/prospecting/shortlist` (`If-Match: record_versions.leads`). Also `StationUI.registerWindow`, `StationUI.h.esc`, `Workstreams.create`, `App.openWorkstream` and `Chat.prefill`: the quest-session pattern at `station/frontend/app/stationui.js:9660-9690`.
- Produces: the window key `leads` (title `LEADS`) and `window.UltraLeads = {view}` for tests. `view` holds the pure functions `ranked(W, C, query)`, `stageOf(lead, events)`, `outreachPrompt(lead)` and `cardModel(lead, C)`. Task 5 extends the card.

- [ ] **Step 1: Write the failing tests**

Create `tests/station-leads.test.cjs`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('../station/frontend/ultra-leads.js');
const V = window.UltraLeads.view;

const W = { hunt: { leads: [
  { id: 'a', company: 'Alpha SARL', location: 'Sfax', industry: 'ERP', pipeline_stage: 'discovered', shortlisted: false },
  { id: 'b', company: 'Beta Data', location: 'Tunis', industry: 'Archives', pipeline_stage: 'pitch', shortlisted: true }] } };
const C = { rankings: [{ id: 'b', score: 80, factors: [], unknowns: [] }, { id: 'a', score: 40, factors: [], unknowns: [] }], events: [], suppressed_ids: [], crew_drafts: [] };

test('the board ranks by score and filters by company, place or industry', () => {
  assert.deepEqual(V.ranked(W, C, '').map(r => r.id), ['b', 'a']);
  assert.deepEqual(V.ranked(W, C, 'sfax').map(r => r.id), ['a']);
  assert.deepEqual(V.ranked(W, C, 'archives').map(r => r.id), ['b']);
});

test('the stage follows confirmed events, never drafts', () => {
  const lead = W.hunt.leads[0];
  assert.equal(V.stageOf(lead, []), 'discovered');
  assert.equal(V.stageOf(lead, [{ lead_id: 'a', kind: 'sent', confirmed: true }]), 'Contacted');
  assert.equal(V.stageOf(lead, [{ lead_id: 'a', kind: 'reply', confirmed: false }]), 'discovered');
});

test('asking ULTRA names the company, its id and the tools, and says nothing is sent', () => {
  const text = V.outreachPrompt(W.hunt.leads[1]);
  assert.match(text, /Beta Data/); assert.match(text, /\bb\b/);
  assert.match(text, /campaign\.lead/); assert.match(text, /campaign\.save_draft/); assert.match(text, /VERDICT/);
  assert.match(text, /Do not send/);
});
```

In `tests/station-starnet-browser.cjs`, replace the CAMPAIGN iframe block (the `.bb[data-term="campaign"]` click through the `starnet-campaign-` screenshot) with:

```js
      await page.evaluate(()=>document.querySelector('.bb[data-term="leads"]').click());
      await page.waitForSelector('.ultra-leads .ul-row');
      assert.ok(await page.locator('.ultra-leads .ul-row').count()>=1,'LEADS lists companies');
      await page.locator('.ultra-leads .ul-row').first().click();
      await page.waitForSelector('.ultra-leads .ul-card h3');
      assert.ok((await page.locator('.ultra-leads .ul-card').innerText()).length>40,'the company card shows its facts');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no horizontal scroll');
      assert.equal(await page.locator('.ultra-leads iframe').count(),0,'LEADS is native, not a framed page');
      await page.screenshot({path:path.join(out,'starnet-leads-'+name+'.png')});
```

Run: `node --test tests/station-leads.test.cjs` → FAIL.

- [ ] **Step 2: Implement the window**

`station/frontend/ultra-leads.js` (browser IIFE; the pure view also loads in Node for the test):
- `api(path, body, version)`, in the same pattern as `ultra-window.js`: the `X-Starnet-Token` header, `If-Match` on writes, and an error carrying `status`.
- **Layout.** `<div class="ultra-leads">` holds:
  - a header row: search input, offer select and funnel counts (Sourced / Shortlisted / Contacted / Replies) from `C.analytics.counts`
  - a two-pane body: the left list `.ul-list` of `.ul-row` buttons (company, score, location · industry · stage), and the right card `.ul-card`
  - a footer link "Classic campaign page", which opens the existing `campaign` window
  - Below 720 px the panes stack, and opening a card scrolls it into view.
- **Company card** (`cardModel`):
  - `h3` with the company, stage chip, score, and chips for shortlisted or outreach suppressed
  - the observed fact as a blockquote
  - the need hypothesis
  - a source link (http/https only; `rel="noopener noreferrer"`, `target="_blank"`), checked date and route type
  - "Why this ranks here" with the ranking factors and unknowns. The text says it is preparation priority, never a buying probability.
  - Buttons:
    - **Shortlist / Remove shortlist** (`prospecting/shortlist`)
    - **Ask ULTRA to prepare outreach**: create or reuse a workstream titled `Outreach · <company>` bound to `agent`, open it, and `Chat.prefill(outreachPrompt(lead))`
- `outreachPrompt(lead)` text: `Prepare outreach for <company> (lead <id>). Read its packet with campaign.lead. Have Sales write a short French pitch, check it with campaign.check_draft and save it with campaign.save_draft. Then have QA review it and end with VERDICT: approved or VERDICT: revise. Do not send anything: I review the draft in LEADS.`
- **Errors.** A load or save error shows inside the window (`.ul-error`, role `alert`). A 409 reloads the data and says "The campaign changed while you were looking. It is reloaded; check and save again."
- Register: `StationUI.registerWindow('leads', 'LEADS', build, { console: true, className: 'ultra-leads-win' })`.

`station/frontend/ultra-leads.css`: only Starnet tokens (`--ph*`, `--gold`, `--ok`, `--warn`, `--bad`, `--panel*`, `--ink`, `--text`) and the station's monospace font inheritance. Rows and cards use a 1 px `rgba(var(--ph-rgb), .25)` border and the station's radius tokens. Do not use the teal or sans-serif style of `station/frontend/campaign/ultra.css`.

Patches:
- Edit the existing `dock-campaign` entry's `replace` (raw text) so the WORK menu button reads `data-term="leads"`, icon `◆`, title **LEADS**, and subtitle `Tunisia companies, pitches &amp; your recorded outcomes`.
- Append `ultra-leads-assets` on `frontend/index.html`: find `<script src="ultra-window.js"></script>` and replace it with `<link rel="stylesheet" href="ultra-leads.css">\n<script src="ultra-window.js"></script>\n<script src="ultra-leads.js"></script>`.
- Check how `data-term` opens a registered window (`station/frontend/app/stationui.js`, where `bb[data-term]` is handled) and register under the same key. Add source assertions.

- [ ] **Step 3: Run the tests**

Run: `node --test tests/station-leads.test.cjs && python3 -m unittest tests.test_ultra_patches tests.test_update_starnet -v`
Expected: PASS. The reviewer runs the browser test.

- [ ] **Step 4: Reviewer checks** — as Task 1 Step 6. Read `starnet-leads-desktop.png` and `starnet-leads-phone.png` and confirm the window matches the station's look (amber monospace, no teal frame).

- [ ] **Step 5: Commit (reviewer)** — `git commit -m "s2 t4: LEADS opens natively in the station's design, with the board, the company card and Ask ULTRA"`

---

### Task 5: LEADS: crew drafts, proposed leads, the conversation room and ROOM TEMPLATES

**Files:**
- Modify: `station/frontend/ultra-leads.js`, `station/frontend/ultra-leads.css`, `station/frontend/ultra-window.js` (ROOM TEMPLATES window), `station/ultra-patches.json` (one BUILD menu entry), regenerate `station/frontend/index.html`, `station/UPSTREAM.json`
- Test: `tests/station-leads.test.cjs`, `tests/station-starnet-browser.cjs`, `tests/test_ultra_patches.py`

**Interfaces:**
- Consumes: Task 3's owner actions (`crew-draft-status`, `proposal-status`, `accept-proposal`), the existing `prospecting/draft-edit` (`If-Match: record_versions.leads`) and `campaign/event` (the evidence form), `UltraTemplates` (Task 1).
- Produces: a PROPOSED tab in LEADS; the crew drafts section on the card; the window key `ultra-room-templates` (title `ROOM TEMPLATES`) on the BUILD menu.

- [ ] **Step 1: Write the failing tests**

Add to `tests/station-leads.test.cjs`:

```js
test('crew drafts show newest first with who wrote them, and adopted or dismissed ones leave the queue', () => {
  const C2 = { ...C, crew_drafts: [
    { id: 'd1', lead_id: 'a', agent_id: 'sales', body: 'v1', status: 'proposed', created_at: '2026-10-11T08:00:00Z' },
    { id: 'd2', lead_id: 'a', agent_id: 'sales', body: 'v2', status: 'proposed', created_at: '2026-10-11T09:00:00Z' },
    { id: 'd3', lead_id: 'a', agent_id: 'sales', body: 'v0', status: 'dismissed', created_at: '2026-10-11T07:00:00Z' }] };
  assert.deepEqual(V.cardModel(W.hunt.leads[0], C2).crewDrafts.map(d => d.id), ['d2', 'd1']);
});

test('proposed leads list only open proposals, with their source, date and quote', () => {
  const rows = V.openProposals({ proposals: [
    { id: 'p1', company: 'X', source_url: 'https://x.tn', observed_on: '2026-10-10', quote: 'Q', status: 'proposed', agent_id: 'research' },
    { id: 'p2', company: 'Y', status: 'accepted' }] });
  assert.deepEqual(rows.map(r => r.id), ['p1']);
});

test('the evidence form refuses evidence shorter than ten characters', () => {
  assert.equal(V.evidenceOk('short'), false);
  assert.equal(V.evidenceOk('2026-10-11 email to info@x.tn'), true);
});
```

Extend the browser journey after the LEADS block:

```js
      await page.locator('.ultra-leads [data-tab="proposed"]').click();
      await page.waitForSelector('.ultra-leads .ul-proposed');
      await page.evaluate(()=>document.querySelector('.bb[data-term="ultra-room-templates"]').click());
      await page.waitForSelector('.ultra-rt-row');
      assert.ok(await page.locator('.ultra-rt-row').count()>=6,'the six 1Ultra room templates are listed');
      assert.match(await page.locator('.ultra-rt').innerText(),/1ULTRA COMMAND/);
```

Run → FAIL.

- [ ] **Step 2: Implement**

LEADS card additions:
- **Crew drafts.** Show each open crew draft for the company (newest first): the agent, time, subject and body, the check result chip, and whether the company's source changed since (`source_version` differs from the packet's).
  - **Use this draft** calls `prospecting/draft-edit` with the subject and body, which makes it Adem's unreviewed draft, then `crew-draft-status` `adopted`.
  - **Dismiss** calls `crew-draft-status` `dismissed`.
  - Adem's own current draft shows above, with **Mark reviewed**, which uses the existing `prospecting/review-draft` and its confirm text.
- **Conversation room.** Show the recorded events, contacts (role, route, source; names stay visible to Adem), signals and follow-ups, read-only. **Record real outcome** opens the existing evidence form: kind, date, evidence of at least 10 characters, and text. It posts `campaign/event` with `confirmed: true`, exactly as the classic page does (`station/frontend/campaign/ultra-app.js` `changed('event', …)`).
- **PROPOSED tab.** List the open proposals: company, location, source link, observed date, the quote and the proposing agent.
  - **Accept** sends `accept-proposal` (confirm text: "Add <company> to your leads? Its source still needs your own check.").
  - **Reject** asks for a reason of 3–300 characters and sends `proposal-status`.
- Pure helpers for tests: `openProposals(C)` and `evidenceOk(text)` (trimmed length of at least 10).

ROOM TEMPLATES (`station/frontend/ultra-window.js`):
- Register `ultra-room-templates`. It lists `UltraTemplates.catalog` (the preset, with "Open station presets", which clicks `#refit-stations` after opening BUILD MODE, or says where it is when that element is absent) and every kit in `UltraTemplates.rooms` with its name and `kitAbout`.
- Each kit row has **Ask ULTRA to add**. It opens ULTRA's General session and calls `Chat.prefill('Add the <NAME> room template beside the station.')`.
- Rows use class `ultra-rt-row` inside `.ultra-rt`.
- Patch: append `ultra-room-templates-dock` on `frontend/index.html`, adding after the `bb-build` button in the BUILD menu: `<button class="bb" data-term="ultra-room-templates"><span class="bb-i">▤</span><span class="bb-tx"><b>ROOM TEMPLATES</b><small>1Ultra rooms ULTRA can add for future work</small></span></button>`. Anchor on the full existing `bb-build` button line and check that it occurs once.

- [ ] **Step 3: Run the tests**

Run: `node --test tests/station-leads.test.cjs tests/station-campaign-tools.test.cjs && python3 -m unittest tests.test_ultra_patches -v`
Expected: PASS.

- [ ] **Step 4: Reviewer checks** — as Task 1 Step 6, and read the new screenshots.

- [ ] **Step 5: Commit (reviewer)** — `git commit -m "s2 t5: LEADS reviews crew drafts and proposed leads and records real outcomes; ROOM TEMPLATES lists rooms for future work"`

---

### Task 6: Integration checks, docs, upstream suite, final review and live checks

**Files:**
- Modify: `scripts/station_smoke.py`, `tests/station-starnet-browser.cjs`, `docs/ops/STATION.md`, `docs/ops/STATION_UPSTREAM_TESTS.md`

- [ ] **Step 1: Smoke checks**

Add two smoke checks to `scripts/station_smoke.py` (copied records, fake FreeLLMAPI as in Stage 1b). Expected total: 24 passed.
- "Campaign tools: ULTRA and the crew get campaign.* tools; a crew packet carries no contact route or names; /api/ultra/tools/ answers 404". Read the tool list through the existing `/tools` slash readout or `station.inspect` if exposed. Otherwise assert the capability registry rows through a node one-liner against the generated files, and the packet through `python3 -c` on the copied root.
- "LEADS: /api/ultra/campaign carries crew_drafts and proposals; accept-proposal adds a crew_proposal lead in the copied records only; the original business records are unchanged".

- [ ] **Step 2: Browser preset journey**

In `tests/station-starnet-browser.cjs` (desktop only):
1. Open BUILD MODE, then STATION PRESETS.
2. Select **1ULTRA COMMAND** and confirm.
3. Assert the floor has rooms named COMMAND and CAMPAIGN and that the crew rows still list Research, Delivery, Sales and QA.
4. Click **RESTORE PREVIOUS** and assert the fixture's original room names are back.

Use the dialog's own buttons (`[data-station-build="ultra-command"]`, `[data-use-build]` twice, `[data-restore-build]`).

- [ ] **Step 3: Full local verification (reviewer)** — Task 1 Step 6 commands; smoke 24; three browser checks; records unchanged.

- [ ] **Step 4: Upstream fast suite (reviewer)** — rerun the 1101 steps on a frozen copy of the final tree, as in `docs/ops/STATION_UPSTREAM_TESTS.md`, with runtime snapshots before and after. Expected: the 146 recorded failures plus `test/station-templates.test.js` (count assertion only), which gets a `patch` row: "asserts exactly seven presets; 1Ultra adds 1ULTRA COMMAND". Any other new failure is fixed or explained.

- [ ] **Step 5: Whole-branch review (reviewer)** — final Codex review of `campaign-crew` from this plan's base to HEAD with the Review Focus; one fix pass for Critical and Important; scoped re-review; rulings and deferred minors in the ledger.

- [ ] **Step 6: Docs (reviewer)**
- `docs/ops/STATION.md`:
  - "Start": how to apply 1ULTRA COMMAND, and that RESTORE PREVIOUS undoes it.
  - A "Room templates" paragraph.
  - Rewrite "Find leads and convince a buyer" for LEADS: the board, the card, Ask ULTRA, crew drafts, proposed leads and recording outcomes. Say that the classic page remains until Stage 4.
  - "Crew on FreeLLMAPI": the campaign tools and the packet's privacy rule.
  - A Stage 2 verification-history entry with the counts from Steps 3 and 4. Say which live checks have happened.
- `docs/ops/STATION_UPSTREAM_TESTS.md`: the rerun line and the new `patch` row.

- [ ] **Step 7: Commit (reviewer)** — `git commit -m "s2 t6: smoke and browser checks for the command layout, campaign tools and LEADS; docs"`

- [ ] **Step 8: Apply the layout, with Adem**

Ask Adem: "Ready to switch your station to 1ULTRA COMMAND? It replaces the rooms and furniture you placed (agents and conversations stay; RESTORE PREVIOUS brings your layout back)." Only after he says go, Adem applies it in BUILD MODE (or tells ULTRA to). The reviewer then confirms from `agent.save.json` (read-only) that COMMAND and CAMPAIGN exist and the five desks are bound.

- [ ] **Step 9: First live campaign check, with Adem's go**

Ask Adem: "Ready for the first live campaign check? You pick one company in LEADS and press Ask ULTRA to prepare outreach; ULTRA and the crew use the campaign tools, and the draft appears in LEADS, unsent." After his go, record in the Stage 2 verification history:
- which tools ran, and which models answered (run details)
- whether a crew draft reached LEADS, and its check result
- the Codex and FreeLLMAPI cost
- that nothing was sent and no business record changed except the workbench's crew draft

Never include a key.
