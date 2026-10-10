# 1Ultra campaign station

The merged app runs the pinned Starnet Node host with a private Python campaign worker. Python owns company records, outcomes, exclusions, quest evidence and business XP. The station saves preparation state under `runs/station-runtime/`. No model, mailbox, paid API, scheduler or third-party plugin runs at installation.

## Start

Requires Python 3.10+ and Node.js 20+. The free runtime dependencies are pinned in `station/package-lock.json`.

```sh
cd station
npm ci --ignore-scripts --no-audit --no-fund
cd ..
python3 scripts/station.py --check
python3 scripts/station.py
```

Open http://127.0.0.1:8541. The same listener serves the original interface at `/classic/`. For a separate standard-library fallback, run `python3 scripts/station.py --classic --port 8542`.

## Find leads and convince a buyer

1. Inspect sourced Tunisian company cards and the contribution behind each ranking factor. Adjust the offer or versioned weights. Choose your offer/capacity and shortlist five companies.
2. Prepare a company pitch and a small proof pack. Open its source, checked output and exception list. Synthetic examples are labelled; they establish no client result or accuracy promise.
3. Review the pitch and proof. French or Tunisian Arabic channel variants require their own review. The pitch recipe binds three selected companies to current reviewed proofs and stops at owner checkpoints.
4. Send a concrete reviewed message yourself or separately authorize that exact external action. Record actual sends/replies with a date, evidence reference and owner confirmation. Confirm or correct reply interpretation to open the useful next action.
5. Save a proposed follow-up separately from an actual send. New replies invalidate prior outreach reviews and return older proposals to review. Company/contact refusals suppress matching routes in drafts and exports.
6. Confirm real quests only after completing their prerequisites. The quest form prepares record/artifact references for inspection; owner confirmation remains required.

Apollo provides country-filter guidance and local CSV preview/import, capped at 500 rows/300 KB. Company country must establish Tunisia scope. No Apollo API/account is connected. Swokei remains an external alternative: export the shortlist, with only current reviewed message text included. Exporting does not send anything.

In the classic Script workshop, **Run script** executes the selected local Python automation. The workshop now shows an indeterminate running bar, then a saved-run receipt or an explicit error. **Open result** opens the generated output separately. Lead Audit checks already saved leads; it does not scrape new companies from the web. In the station Recipes panel, tools needing no input run on the first click; CSV, scope and practice tools keep their input forms. Submitting a bound pilot scope starts its guarded scope-check step and stops before owner review.

## Specialist agents and tailored pitches

**Generate pitch & report** in either interface launches one Codex CLI judgment pass after local checks. The selected Tunisian company facts, offer, founder evidence, crew dossier and current reviewed proof metadata form the context. The default lead preflight sends only the selected company's rows. No raw court or client documents are included by this pitch action. It uses the existing ChatGPT login and CLI default model with explicit `xhigh` reasoning effort by default; usage consumes the account allowance and its cost remains unknown. API-key execution is refused. `codex login status` checks the account without running a model.

One click starts the checks and agent, generates `report.md`, loads that saved file into the dialog and refreshes the workspace automatically. The report appears in Outbox and the company’s recent run cards. No terminal command, manual upload or Refresh files click is needed. The dialog shows lifecycle activity and indeterminate progress until the saved report arrives, then reaches 100%. Reloading the same browser tab reconnects to the existing receipt and displays its report without starting another model. Closing the dialog lets the worker finish; the report returns when ready. Download report exports the saved file. **Use this draft** is a separate owner action; it stores provenance and leaves the pitch unreviewed and unsent. **Ask QA to review** hands the exact saved Sales output to one QA pass. A QA answer is advice, not owner approval. Generation never changes contact outcomes, quests, XP or money. Source/draft changes, exclusions, suppression and stale proof block adoption. An unsuccessful model run has an explicit failure and never silently substitutes a template.

The Crew screen offers manual Research, Sales, Delivery and QA judgment tasks with a recorded reason. Open **Settings & skills** on any desk to enable/disable that agent, choose low/medium/high/xhigh reasoning, select its project skill and save optional instructions. Settings survive reload and are captured when a job starts; edits affect the next run. Disabling an agent refuses new model jobs while its script tools remain usable. The classic agent dialog links to these same controls.

Every specialist loads its required `.codex/agents/ultra_ROLE.toml` developer instructions. Research defaults to `ultra-prospect`, Sales to `ultra-sales` and Delivery to `ultra-deliver`, loaded from this project’s `.agents/skills/`. QA uses its required role without a separate installed skill. Selected skills are supplied as bounded instruction text with the role and owner preferences; missing or symlinked files refuse preparation before script/model work. This does not enable tool execution or automatic skill installation. Run receipts store the effective settings, instruction paths and SHA-256 hashes, and reports show effort and source provenance. The interface labels the requested model as CLI default; it does not infer an unreported resolved model. Project/native role configuration and the terminal live-judgment helper also default to xhigh. Delivery requires a saved script result. Models receive curated input and run with shell, web search, apps, MCP, skill discovery and recursive agents disabled, inside a read-only CLI sandbox. The Node host permits only the fixed private Python worker; upstream provider/connector routes remain blocked. Agent jobs share the two-worker/one-per-desk limit and support cancellation, emergency stop and explicit retry. Closing a dialog does not cancel the job. Receipts persist; interrupted jobs do not replay.

Agent controls require the merged station host. The standalone `--classic` server retains scripts; its agent dialog links to the station. Former classic hash bookmarks on the main listener redirect to `/classic/`.

## Station features

- The station floor is the default landing screen. A Starnet-style crew rail, room inspector, activity console and bottom command deck keep leads, quests, workflows and outputs within reach. The rendering and crew figures are original 1Ultra artwork.
- Back returns to the previous section, company or room, including after refresh. Popup Back returns to its preceding dialog or work area. A room selector and horizontal map scrolling support smaller screens.
- A persistent task strip and dialog progress bar appear as preparation is requested. Running scripts show indeterminate activity and elapsed time; saved results remain available in the Run console. Failed, cancelled and interrupted jobs never show full completion. `needs_review` means execution finished with unresolved checks, and remains separate from owner review.
- Workflow percentages count distinct passed script steps and confirmed owner checkpoints. Changing a workflow resets displayed progress until the revised plan produces its own receipts. Preparation progress does not award business XP.
- Saved five-room layout, four desks and movable crew/operator bodies; camera controls and checked room movement/resizing.
- Native company workstreams with durable transcripts, rename/pin/archive/export and a task-brief decision journal.
- Separate preparation board with assignment, priority, actual artifact references and owner review. It cannot award business XP.
- Typed local script recipes, editable workflow lines, bound campaign conditions and owner checkpoints. `needs_review` results remain blocked until their inputs/checks are resolved and rerun. A passed script is labelled separately from owner review.
- Four specialist settings panels with reasoning, selected project skills, enable/disable and optional instructions. Source-linked specialist notes support pin/edit/forget and feedback history through the imported memory core.
- Artifact outbox with safe text previews/downloads, source run, checks and current review status.
- Contact maps, dated public signals, proposed follow-ups, stable A/B assignments and descriptive company funnel counts. Actual sends may reference an experiment assignment; no reliable winner is inferred from a small sample.
- 20/45/90-minute focus plans use ready dependencies, due proposals and known effort estimates. Pause/resume survives refresh. Unknown effort stays unknown.
- Choice-based fictional practice uses a fixed script rubric and grants no business XP.
- Persistent emergency stop, cancellation of active script processes, interrupted receipts and explicit retry. Two preparation workers maximum, one per desk. Short atomic preparation writes finish safely; new preparation is refused after stop.

Provider adapters, consent/extension infrastructure and broader upstream modules are retained in source. The provider readiness dialog describes those inactive adapters; **Crew → Check account connection** separately checks the Codex CLI login. A detected login does not prove a successful model response. External connectors, plugin execution and autonomous schedules remain inactive.

## Records and recovery

`data/campaign-workbench.json` is created only when the owner saves campaign preparation or evidence. It is separate from the previous `data/campaign.json` migration marker. Campaign, lead, task and runtime saves reject stale versions. The Node host does not write business JSON directly.

Runtime saves use atomic durable writes with a last-known-good backup. Session notes, workflow checkpoints, task briefs, job receipts, memory and emergency stop persist. Interrupted jobs are never automatically replayed. Preparation artifacts cannot count as contacts, agreements, receipts or owner-confirmed business completion.

The consulting receivable remains archived, billing facts stay deferred, and existing 30-hour weekly capacity is preserved. No business fact changed during implementation.

## Source and checks

Upstream: https://github.com/androoAGI/starnet, commit `e0a36dcd31787248b877aea01a6e53741012bc46`. The fork retains 2,394 source/config/test files. MIT license and all notices are byte-preserved. Upstream branding/art/sprites and historical workspaces were excluded; the active interface uses original procedural rendering. `station/UPSTREAM.json` records source hashes and adaptations. The original HTML is retained as an unserved source archive.

```sh
python3 scripts/check_station.py
python3 -m unittest discover -s tests -v
python3 scripts/station_smoke.py
node tests/station-policy.test.cjs
node tests/station-state.test.cjs
node tests/station-workflows.test.cjs
node tests/station-experience.test.cjs
node tests/station-ui-smoke.cjs
```

The repeatable browser check uses temporary copied records and requires an already installed Playwright package and browser executable. It performs no installation:

```sh
python3 scripts/station_browser_smoke.py --playwright-module /path/to/playwright --browser /path/to/chromium
python3 scripts/station_browser_smoke.py --agents --playwright-module /path/to/playwright --browser /path/to/chromium
```

HTTP checks use copied records and verify original business hashes. Browser checks use copied records at desktop and 390px. The `--agents` check adds a fake Codex executable to the fixture's PATH; production code has no fixture-provider switch. It exercises lifecycle, usage receipts, handoff, explicit adoption, cancellation, failures and classic controls without a provider call. On 5 October 2026 the owner explicitly approved one live Cabinet ZAATIR test. The existing-account Codex CLI completed using the exact reviewed prompt; its structured result and source references passed local checks. The pitch remains unsent and unreviewed by the owner. The approved input, authorization, usage and result are saved in `runs/agent-20261005T174901Z-1930c646/`. This verifies CLI generation; it does not verify upstream provider adapters or live UI job orchestration. The later one-click report update passed nine copied-record agent browser checks, including reload recovery in both interfaces, automatic artifact loading, collection refresh, failure handling and mobile reports. A read-only check of the running listener opened the earlier actual report in Outbox. The owner then explicitly approved one additional live interface test. A single browser-launched Sales pass completed for Cabinet ZAATIR: same-job reload recovery, automatic saved-report display, workspace refresh and 100% progress passed. Its unsent report is `runs/agent-20261005T185447Z-01ea2530/report.md`. The initial click was refused by an active emergency stop before any model; preparation was resumed for the approved test and the stop restored afterward. A trailing-newline comparison and an asynchronous stop-state assertion in the test harness were resolved by read-only checks of the already completed job; no model was repeated. No business records changed. This verifies the main interface and installed account; live classic orchestration, other live roles and upstream adapters remain untested. The earlier additional-transmission approval rejection was resolved by the owner’s explicit go. Verification artifacts for this update are in `runs/station-qa-20261005-reports/`. The earlier export refusal was resolved by the owner’s explicit `go` instruction. Selected native module tests pass; upstream tests tied to the old HTML or excluded artwork are retained but do not apply to the active 1Ultra renderer. The entire upstream suite is not claimed passing.


The 5 October agent settings update passed 132 Python tests, the five selected JavaScript suites (11 cases), 12 copied-record agent browser checks and all 14 existing interface browser checks. The installed CLI catalog supports xhigh, and an isolated read-only `config/read` confirmed that the explicit effort override parses correctly. A read-only browser check on the updated real listener verified xhigh defaults, available role/skill files, desktop/mobile controls and unchanged job IDs/control state. No additional live inference was run for this settings update. Evidence is in `runs/station-qa-20261005-agent-settings/`.
