# 1Ultra campaign station

The merged app runs the pinned Starnet Node host with a private Python campaign worker. Python owns company records, outcomes, exclusions, quest evidence and business XP. The station saves preparation state under `runs/station-runtime/`. No model, mailbox, paid API, scheduler or third-party plugin runs at installation.

## Start

Requires Python 3.10+ and Node.js 20.3+. Install pinned dependencies once with `cd station && npm ci --ignore-scripts --no-audit --no-fund`, then run `python3 scripts/station.py` and open http://127.0.0.1:8541.

- `/` is the Starnet station (1Ultra build). **WORK → LEADS** opens the Tunisia campaign in the station's own design; **SYSTEM → SWITCHES** shows what agents may use; **BUILD → ROOM TEMPLATES** lists the 1Ultra rooms.
- `/campaign/` is the classic campaign page on its own (also linked from LEADS until Stage 4 retires it). `/classic/` is the original Python interface. For a separate standard-library fallback, run `python3 scripts/station.py --classic --port 8542`.
- Switches you can turn on now: **lead.codex** (then sign in: model dock → GPT / CODEX → Sign in with ChatGPT, and pick GPT 6.1 SOL · XHIGH), **crew.freellmapi** (crew on the local FreeLLMAPI service; see "Crew on FreeLLMAPI"), **crew.escalate_to_lead** (on by default: ULTRA takes over crew work that fails on every free option, while lead.codex is on) and **tools.web** (public web search and reading for agents; private network addresses stay blocked).
- One emergency stop: the 1Ultra stop halts Starnet too, Starnet's E-STOP sets the 1Ultra stop, and Starnet's RESUME clears both.
- Agents can never read or write the 1Ultra project folder, and it cannot be added as a project. Inside the station runtime each agent reaches only its own workspace, never the switches, the stop, saved settings or the ChatGPT tokens — even in Full Power. Searches and recursive listings skip protected files.
- Every model request (including retries, model catalogs and sign-in renewals) checks the emergency stop and the provider switch again, so turning `lead.codex` off takes effect on the next request, and pressing stop also aborts model requests already in flight.

## Your station layout

**1ULTRA COMMAND** is the station preset for this work. Apply it in **BUILD → BUILD MODE → STATION PRESETS → 1ULTRA COMMAND**, then confirm, or ask ULTRA to switch the station to it (you approve ULTRA's card).

- **COMMAND**, in the center, is ULTRA's room: ULTRA's desk, all five essentials (files, web, memory, terminal and images), screens and a meeting table. ULTRA orchestrates from here.
- **CAMPAIGN**, east of COMMAND, has a desk each for Research, Delivery, Sales and QA, plus an INTEL CAB, a dish, a server cart and a whiteboard. Its open lower half is kept for the Tunisia Lead Line (Stage 3).
- Applying the preset replaces rooms, furniture and conveyors. Agents and conversations stay. **RESTORE PREVIOUS** in the same dialog brings back the layout you had before.
- Until an agent works a line step (a bay), it uses equipment from anywhere on the station, so desks never take a power away.

**Room templates for future work.** Six 1Ultra rooms are ready to add beside the station: CAMPAIGN; LEAD RESEARCH (a research line that proposes sourced companies); DRAFT & CHECK (a draft and QA loop for pitches); DELIVERY LAB; CLIENT PILOT; and RECORDS. **BUILD → ROOM TEMPLATES** lists them, and **Ask ULTRA to add** prepares the request; ULTRA's station builder shows you the plan on a card before anything is built. A line room's steps come with written instructions; you choose who works each step.

## Crew on FreeLLMAPI

Research, Delivery, Sales and QA work next to ULTRA on free models through [FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi), running locally on `127.0.0.1:3001`. ULTRA stays on Codex.

1. Install once: `python3 scripts/freellmapi.py install`. This downloads FreeLLMAPI at the pinned commit and its packages.
2. Start it: `python3 scripts/freellmapi.py start`. It begins with OVH AI Endpoints' keyless access, which is slow (about 2 requests per minute per model).
3. Give the station its key: `python3 scripts/freellmapi.py key`.
4. To make it faster, add free keys:
   - Run `python3 scripts/freellmapi.py admin` for the dashboard login.
   - Open http://127.0.0.1:3001/keys and paste keys from Groq, Cerebras and OpenRouter there. Never paste a key in a chat.
5. Tier the models, and again after adding keys: `python3 scripts/freellmapi.py tiers`. You can edit tiers in `runs/station-runtime/model-tiers.json`.
6. In **SYSTEM → SWITCHES**, turn on **crew.freellmapi**. The line under it shows whether FreeLLMAPI is running, how many models are ready and how many crew members can work.
7. Talk to a crew member in COMMS, or ask ULTRA to delegate. Each run's details show **answered by** with the model FreeLLMAPI actually used.

How the crew stays capable:
- **Checks:** the station checks every delegated crew result. A result is caught when its model was below the member's tier, when it failed its checks, or when QA gave no verdict.
- **Ladder:** a caught result is retried once on `auto:smart`, then handed to another member who covers the work, then back to ULTRA (with **crew.escalate_to_lead**). That is at most three moves.
- **Bench:** a member with three bad results in 30 minutes is benched until a model at its tier is ready again.
- **team.health:** ULTRA can read all of this with `team.health`.
- **Free-tier ULTRA:** if Codex is signed out or out of allowance and the crew is on, ULTRA continues on the free tier with a visible "lead running on free tier" notice.

Campaign tools (every agent with a computer gets them; **1ULTRA CAMPAIGN** in the TOOLSETS console can switch them off):
- `campaign.leads` and `campaign.lead` read the campaign. A company's packet carries public, sourced company facts, the ranking reasons, signals, proof metadata and drafts. Contacts appear only as role, channel type (email, phone, LinkedIn, website or other) and source link: no names, addresses, phone numbers or imported raw rows. Excluded companies are never offered.
- `campaign.check_draft` checks a pitch against fixed rules: no prices, percentages, time promises, guarantees or invented clients, and the company's scope, exclusions, suppression and source age (a source older than 180 days counts as stale; that limit is a setting). `campaign.save_draft` saves only a draft with no problems, as unreviewed.
- `campaign.propose_lead` proposes one Tunisian company with its source URL, date seen and exact quote; known, excluded or non-Tunisian companies are refused.
- No campaign tool sends anything or changes `data/leads.json`; agent drafts and proposals wait in `data/campaign-workbench.json` for your decision in LEADS.

Privacy:
- Free providers may log prompts. Crew models get only public research, campaign drafts and synthetic examples, and agents still cannot read the project folder.
- FreeLLMAPI keeps request metadata (not message bodies) for 90 days in `services/freellmapi/state/`.
- Stop it with `python3 scripts/freellmapi.py stop`.

After the first start with this update, close and reopen any station tab, so the page picks up the new crew members.

## Find leads and convince a buyer

**LEADS** (WORK → LEADS) is the campaign's own window in the station:

- **Board:** the ranked Tunisian companies with search, the offer used for ranking, and the funnel counts (sourced, shortlisted, contacted, replies).
- **Company card:** the observed fact, source link and date, why it ranks where it does (preparation priority, never a buying probability), and **Shortlist**.
- **Ask ULTRA to prepare outreach** opens that company's own conversation with ULTRA, with a prepared request: read the packet with `campaign.lead`, have Sales write and check a French pitch and QA give a verdict. Nothing is sent; the draft comes back to LEADS.
- **Crew drafts:** each saved crew draft shows who wrote it and whether the company's source changed since. **Use this draft** makes it your own unreviewed draft (subject and body editable); **Dismiss** removes it from the queue. **Mark reviewed** stays your own step.
- **PROPOSED:** companies the crew proposed, with source link, date and quote. **Accept** adds one to your leads (its source still needs your own check); **Reject** records why.
- **Record real outcome** saves an actual send or reply with its date and at least ten characters of evidence, exactly as before.

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

Agent controls require the merged station host. The standalone `--classic` server retains scripts; its agent dialog links to the station. Former classic hash bookmarks on the campaign page (`/campaign/`) redirect to `/classic/`.

## Station features

- The campaign page (`/campaign/`, also the CAMPAIGN window on the station) opens on its station floor. A crew rail, room inspector, activity console and bottom command deck keep leads, quests, workflows and outputs within reach. The rendering and crew figures are original 1Ultra artwork.
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

## Updating Starnet

1. Fetch: inside `runs/upstream/starnet` (a code-only sparse clone; clone commands are in `docs/superpowers/plans/2026-10-10-starnet-merge-phase1-foundation.md`, Task 3), run `git fetch origin feat/harness-backend && git checkout <commit>`.
2. Back up: `cp -a station runs/upstream/station-before-<commit>`.
3. Update: `python3 scripts/update_starnet.py --repo runs/upstream/starnet --revision <commit>`. A patch that no longer matches stops the update. Fix its `find` text in `station/ultra-patches.json` and rerun.
4. Check: `cd station && npm ci --ignore-scripts && cd .. && python3 scripts/check_station.py && python3 scripts/station_smoke.py`.

## Source and checks

Upstream: https://github.com/androoAGI/starnet at the revision in `station/UPSTREAM.json` (currently `54899e5`, v0.13.2). Display branding is rewritten to 1Ultra only in prose and HTML text. A brand word joined by `-` or `/` (the `X-StarNet-Token` header, data paths) or standing alone as a code value (the `STARNET_` environment filter, provider labels) keeps its upstream spelling, because those strings are functional. What third parties see says 1Ultra: the OpenRouter `X-Title` and referer, the image tool's `User-Agent`, the MCP OAuth client name and the MCP client info (`name-*` patches). Four page patches relabel the brand marks. `LICENSE` and `NOTICE.md` are byte-identical to upstream. Starnet art is not imported; `station/frontend/assets/` holds only 1Ultra-owned files. 1Ultra-owned files: `station/ultra-*.js`, `station/ultra-patches.json`, `station/frontend/campaign/`, `station/frontend/ultra-window.js`, `station/frontend/ultra-brand.css`, `station/frontend/assets/`. Upstream fast-test results and the reason for each failure are in `docs/ops/STATION_UPSTREAM_TESTS.md`. The update to `54899e5` needed no boot patches beyond the listed `station/ultra-patches.json` entries; Starnet's startup browser-install probe logs one refused (fail-open) call.

```sh
python3 scripts/check_station.py
python3 -m unittest discover -s tests -v
python3 scripts/station_smoke.py
node --test tests/station-*.test.cjs tests/station-ui-smoke.cjs
```

The repeatable browser checks use temporary copied records and require an already installed Playwright package and browser executable. They perform no installation:

```sh
python3 scripts/station_browser_smoke.py --starnet --playwright-module /path/to/playwright --browser /path/to/chromium
python3 scripts/station_browser_smoke.py --playwright-module /path/to/playwright --browser /path/to/chromium
python3 scripts/station_browser_smoke.py --agents --playwright-module /path/to/playwright --browser /path/to/chromium
```

### Verification history (11 October 2026, Stage 2: the 1ULTRA COMMAND layout, room templates, campaign tools and LEADS)

Local checks on copied records: 229 Python tests, 208 station Node tests, `check_station.py`, 24 HTTP smoke checks and the three browser journeys (desktop and 390px) pass; business records are unchanged. The browser journey applies 1ULTRA COMMAND to a fixture station (COMMAND and CAMPAIGN appear, the crew stay), then RESTORE PREVIOUS brings the fixture's rooms back; it also opens LEADS, the PROPOSED tab and ROOM TEMPLATES, and checks that Ask ULTRA leaves the prepared conversation visible. The two new smoke checks prove that ULTRA and the crew get the campaign tools, that `/api/ultra/tools/` is refused over HTTP, that a crew packet carries no contact route or names, and that accepting a crew proposal changes only the copied records. A read-only check on the real campaign found none of the 40 company packets carrying an email address, phone number, profile link or imported raw row. The upstream fast suite has four new explained `patch` failures (see `STATION_UPSTREAM_TESTS.md`); the real `runs/station-runtime` was unchanged. Every task passed a Codex review. The final review found five gaps, all fixed with regression tests before merge: free text such as a draft could carry contact details to a model; draft checks missed declined companies and suppressed routes; agents received a generic message instead of the refusal reason; Ask ULTRA left LEADS covering the conversation; and renaming a company split its conversation. No live model call has been made for Stage 2 yet: applying the layout to Adem's station and the first live campaign check wait for Adem's go.

### Verification history (11 October 2026, Stage 1b: the crew on FreeLLMAPI)

Local checks on copied records: 181 Python tests, 145 station Node tests, `check_station.py`, 22 HTTP smoke checks and the three browser journeys (desktop and 390px) pass; business records are unchanged. The two new smoke checks drive a fake FreeLLMAPI on 127.0.0.1: a seeded crew member answers with the unified key and task type sent, the routed model recorded in the run and $0 booked, and a signed-out Codex lead continues on the free tier with its notice. The upstream fast suite matches the earlier baseline (see `STATION_UPSTREAM_TESTS.md`). FreeLLMAPI was installed at the pinned commit and started once locally on OVH's keyless access (14 ready models, catalog tiered 91 smart, 81 standard, 108 fast), then stopped; 1Ultra has sent no chat request through it. Every task and the whole branch passed a Codex review. The final review found six gaps, all fixed with regression tests before merge: crew requests could follow a caller's endpoint, a reassigned subtask lost QA's verdict rule, the emergency stop could still hand work back to ULTRA, a resumed worker skipped the crew checks, a failed Codex sign-in at run start skipped the free-tier fallback, and a broken profile turned supervision off. Live crew check, 11 October 2026: Adem started FreeLLMAPI (OVH keyless access), turned on `crew.freellmapi` and messaged Sales twice in a COMMS group with ULTRA. Sales answered both times; the run details record **answered by** `ovh/Qwen3.8-27B` and `ovh/Qwen3.6-27B`, each run booked $0, and business records are unchanged. Sales' reply said it had no file access and asked for an INTEL CAB; by the station's placement rule it already has one, because an agent without a desk draws on station-wide gear, including the INTEL CAB in HOME.

### Verification history (10 October 2026, Stage 1a: ULTRA on Codex)

Local checks on copied records: 148 Python tests, 73 station Node tests, `check_station.py`, 20 HTTP smoke checks and the three browser journeys (desktop and 390px) pass; business records are unchanged. The smoke run turns `lead.codex` on with a fake ChatGPT token, restarts, confirms the token loads, and proves the emergency stop refuses a Codex run before any model call; an `strace` of that run showed connections only to 127.0.0.1 and the local name cache, with no lookup of chatgpt.com or openai.com. Over HTTP, a resume whose saves fail answers 503 with the stop still on, and a retry after saves work clears it. The upstream fast suite matches the Phase 1 baseline (see `STATION_UPSTREAM_TESTS.md`). The final review found four gaps (recursive search into the project under Full Power, runtime control files reachable under Full Power, and stop and switch checked only when a provider was built). All four were fixed with regression tests before merge; the Codex re-review then showed that adapter retries and model catalogs still skipped the checks, so the checks moved into each adapter's own network calls. Live check, 10 October 2026: Adem turned on `lead.codex`, signed in with ChatGPT and sent ULTRA "hello"; ULTRA answered on Codex `gpt-6.1-sol` ("Hello, Adem. What do you need done?") and Starnet then ran one internal goal-decomposition pass on Codex. Both runs booked $0.

### Verification history (5 October 2026, before the Starnet update)

HTTP checks use copied records and verify original business hashes. Browser checks use copied records at desktop and 390px. The `--agents` check adds a fake Codex executable to the fixture's PATH; production code has no fixture-provider switch. It exercises lifecycle, usage receipts, handoff, explicit adoption, cancellation, failures and classic controls without a provider call. On 5 October 2026 the owner explicitly approved one live Cabinet ZAATIR test. The existing-account Codex CLI completed using the exact reviewed prompt; its structured result and source references passed local checks. The pitch remains unsent and unreviewed by the owner. The approved input, authorization, usage and result are saved in `runs/agent-20261005T174901Z-1930c646/`. This verifies CLI generation; it does not verify upstream provider adapters or live UI job orchestration. The later one-click report update passed nine copied-record agent browser checks, including reload recovery in both interfaces, automatic artifact loading, collection refresh, failure handling and mobile reports. A read-only check of the running listener opened the earlier actual report in Outbox. The owner then explicitly approved one additional live interface test. A single browser-launched Sales pass completed for Cabinet ZAATIR: same-job reload recovery, automatic saved-report display, workspace refresh and 100% progress passed. Its unsent report is `runs/agent-20261005T185447Z-01ea2530/report.md`. The initial click was refused by an active emergency stop before any model; preparation was resumed for the approved test and the stop restored afterward. A trailing-newline comparison and an asynchronous stop-state assertion in the test harness were resolved by read-only checks of the already completed job; no model was repeated. No business records changed. This verifies the main interface and installed account; live classic orchestration, other live roles and upstream adapters remain untested. The earlier additional-transmission approval rejection was resolved by the owner’s explicit go. Verification artifacts for this update are in `runs/station-qa-20261005-reports/`. The earlier export refusal was resolved by the owner’s explicit `go` instruction. Selected native module tests pass; upstream tests tied to the old HTML or excluded artwork are retained but do not apply to the active 1Ultra renderer. The entire upstream suite is not claimed passing.


The 5 October agent settings update passed 132 Python tests, the five selected JavaScript suites (11 cases), 12 copied-record agent browser checks and all 14 existing interface browser checks. The installed CLI catalog supports xhigh, and an isolated read-only `config/read` confirmed that the explicit effort override parses correctly. A read-only browser check on the updated real listener verified xhigh defaults, available role/skill files, desktop/mobile controls and unchanged job IDs/control state. No additional live inference was run for this settings update. Evidence is in `runs/station-qa-20261005-agent-settings/`.
