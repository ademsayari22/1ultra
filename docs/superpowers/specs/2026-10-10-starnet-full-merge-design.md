# 1Ultra full Starnet merge

Status: draft for owner review, 10 October 2026.
Supersedes the active-scope sections of `2026-10-05-starnet-merge-design.md`. That document's records, evidence and authority rules stay in force.

## Goal

1Ultra runs Starnet's full feature set as one local app under the 1Ultra name, with CC0 art, while keeping the Tunisia campaign records and the rules in `AGENTS.md`.

Done means Adem opens `http://127.0.0.1:8541` and:

- sees the pixel-art station with crew walking between desks;
- chats with the lead agent (Codex, `gpt-6.1-sol`, reasoning `xhigh`), which delegates subtasks to crew agents running on FreeLLMAPI;
- opens the campaign window and does everything the current station does;
- turns on any other Starnet feature (channels, cron, Night Shift, MCP, browser, voice, Skill Market, more providers) from one Settings page.

The desktop app is out of scope for now.

## Owner decisions (10 October 2026)

| Topic | Decision |
|---|---|
| Approach | Merge Starnet's code directly and serve its own interface. No re-implementation. |
| Orchestrator | Codex on Adem's ChatGPT account, model `gpt-6.1-sol`, reasoning `xhigh` |
| Crew agents | FreeLLMAPI (https://github.com/tashfeenahmed/freellmapi, MIT): one local OpenAI-compatible endpoint over free-tier providers |
| Art | CC0 sprite packs, chosen for one consistent style |
| Desktop app | Later |

## Architecture

Three local processes, all bound to `127.0.0.1`:

1. **Station host:** `node station/sidecar/index.js` on port 8541, started by `scripts/station.py`. This is Starnet's server with the 1Ultra policy hook. It serves Starnet's interface at `/`, the current small station page at `/campaign/` and the Python classic interface at `/classic/`.
2. **Campaign worker:** `scripts/campaign_rpc.py`, over a private pipe, unchanged. It remains the only writer of `data/`.
3. **FreeLLMAPI:** a pinned checkout in `services/freellmapi/` on port 3001, built once with `npm install`. The station host starts it only after an owner action: turning on `crew.freellmapi`, or clicking **Set up FreeLLMAPI** in Settings. It stops when the station stops. Its dashboard at `http://127.0.0.1:3001` is where Adem adds free-tier provider keys and gets the unified local key.

Starnet runtime state stays in `runs/station-runtime/`, which is gitignored. FreeLLMAPI's database and `.env` stay inside `services/freellmapi/` and are added to `.gitignore`.

### Campaign inside Starnet

- A built-in app window, using Starnet's `PluginHost` `app` kind, loads `/campaign/`. A dock button opens it.
- First start seeds four crew members: Research, Sales, Delivery and QA. Their instructions come from `.codex/agents/ultra_*.toml` and their default skills from `.agents/skills/`, as today. Adem can edit them and recruit more with Starnet's class builder.
- Agents get a built-in `1ultra-campaign` toolset. It calls the existing catalogued script recipes (`lead-audit`, `outreach-drafts`, `scope-check`, `validate-records`, `csv-workbench`, `daily-pack`, `next-quests`, `finance-pack`, `rehearsal`) through the Python worker. Agents can read leads and save drafts. Recording sends, replies, outcomes, receipts, quests and XP stays an owner action in the interface, and the toolset refuses those routes.

## Upstream update

- Pin Starnet at the newest `feat/harness-backend` commit when implementation starts (v0.13.2 or later). Record the exact commit in `station/UPSTREAM.json`.
- Fetch it with a partial, sparse clone containing only `sidecar/`, `frontend/`, `shared/`, `scripts/`, `skills-catalog/`, `test/`, `package.json`, `package-lock.json`, `LICENSE` and `NOTICE.md`. Leave out `frontend/assets/`, `frontend/agent-demo/`, `website/`, `output/`, `qa/`, `dev/`, `loops/` and `src-tauri/`.
- Replace the upstream files in `station/`. Keep the 1Ultra files (`ultra-*.js`, `frontend/ultra-*`). Re-apply the one hook in `sidecar/index.js`. Regenerate `UPSTREAM.json` hashes and list every adapted file.
- Separately licensed upstream assets may be imported with their license text: the VT323 font (OFL), and the UI sounds only if `frontend/assets/sfx/LICENSE.md` shows a third-party permissive license. Everything that is Starnet brand or art stays out.
- `scripts/update_starnet.py` repeats this procedure for later updates.
- Install dependencies with `npm ci --ignore-scripts`.

## Models

### Lead (orchestrator)

- Uses Starnet's `codex` provider (`sidecar/providers/codex.js`), which calls the ChatGPT Codex backend with model `gpt-6.1-sol` and reasoning effort `xhigh`. If the backend model list Starnet fetches lacks `gpt-6.1-sol`, add it to the provider's static catalog. The installed Codex CLI catalog lists it with `xhigh` support.
- Adem signs in once with Starnet's own "Sign in with ChatGPT", using the same account as the CLI. Starnet keeps its own tokens. Sharing the CLI's `~/.codex/auth.json` is rejected because two clients refreshing one token can invalidate each other's sessions.
- Lead tools: `team.dispatch` (delegate to crew), station control, memory, Outbox, the campaign toolset, and any tool families whose switches are on.
- Usage draws on the ChatGPT plan allowance. Its money cost is recorded as unknown.

### Crew

- Uses Starnet's `openai-compatible` provider with base URL `http://127.0.0.1:3001/v1` and FreeLLMAPI's unified key. Each crew member's model is a FreeLLMAPI routing string for its tier (see below), and FreeLLMAPI sends tool requests only to tool-capable models.
- The provider records FreeLLMAPI's `X-Routed-Via` header (the model that actually answered) and `X-Fallback-Trail` header in every run receipt.
- Cost is recorded as zero: free tiers only.

### Crew capability management

Free tiers lose quality late in the day and change quotas without notice. The station therefore checks every crew result and moves work to a more capable crew member or model when one degrades. The checks and reassignment rules are deterministic host code (`station/ultra-crew-health.js`), so they behave the same on every run. The lead also sees each member's health and can reassign on its own judgment.

**Capability profile per crew member.** Each crew member has a profile, stored with the crew and editable in the dossier:

- minimum tier: `smart`, `standard` or `fast`;
- whether the member needs tool calling or vision;
- the task type sent as `X-FreeLLM-Task-Type` (`code` or `chat`);
- working languages (for example French for Sales).

Defaults: Research and QA are `smart` with tools; Sales is `smart`, chat, French and English; Delivery is `standard` with tools. The routing string is `auto:smart` for the `smart` tier, `auto:balanced` for `standard` and `auto:fast` for `fast`.

**Model tiers.** `runs/station-runtime/model-tiers.json` maps each FreeLLMAPI model id to a tier. A script seeds it from FreeLLMAPI's `/v1/models` catalog, using the catalog's intelligence ranking where the catalog provides one. Adem can edit it. A model missing from the file counts as `fast`.

**What counts as losing capability.** Each crew result is classified as one of these:

| Outcome | Detected by |
|---|---|
| `unavailable` | HTTP 429 or 5xx, a timeout, FreeLLMAPI's `no_vision_model` or no-model error, or no `ready` model at the member's tier in `/v1/models?execution_status=ready` before dispatch |
| `downgraded` | `X-Routed-Via` names a model below the member's minimum tier |
| `failed_check` | The output fails the dispatch's result schema (Starnet `result-contract.js`), the campaign script checks, or Starnet's verdict gate |
| `ok` | None of the above |

**Reassignment ladder.** Each subtask can move at most three times. Every move is written to the run receipt, shown in the lead's chat, and animated on the station floor as a handoff.

1. For `downgraded` or `failed_check`: retry the same member once with `auto:smart`.
2. Reassign to another crew member whose profile covers the subtask's needs and whose tier currently has a `ready` model.
3. The lead does the subtask itself on Codex `gpt-6.1-sol` at `xhigh`. This uses Codex allowance, so the setting `crew.escalate_to_lead` (default on) controls it. It applies only while `lead.codex` is on, and the escalation count appears in the usage view.
4. If every step fails, the subtask is marked failed with the full trail and the lead reports it to Adem. Nothing is dropped silently.

**Benching.** A member with three non-`ok` results in a row within 30 minutes is benched, and its station figure shows a "benched: no capable model" status. The lead stops dispatching to it. Before each later dispatch, the host checks readiness again and unbenches the member as soon as its tier has a `ready` model. This needs no scheduler.

**Lead fallback.** If Codex itself is unavailable (usage limit reached, signed out or erroring), the lead continues on FreeLLMAPI `auto:smart` with a visible "lead running on free tier" notice, and reports which turns ran there. The data rule applies unchanged.

**Lead visibility.** A read-only `team.health` tool gives the lead each member's profile, current tier readiness, last outcomes and bench state, so it can plan assignments rather than only react to failures.

### Data rule for both routes

- Only public research, campaign lead records, owner-written drafts and synthetic examples go to a model.
- `data/private/`, `delivery/jobs/`, court records and client samples are on a path deny-list. The file tools and the campaign toolset enforce it, and it applies to both providers.
- Free-tier providers may log prompts or train on them under their terms. This rule is what keeps client material out of them.
- Adem chooses which free providers to add keys for. FreeLLMAPI's own May 2026 terms review marks Cohere as "avoid" and Gemini, NVIDIA and GitHub Models as "caution". Whether a free tier allows Adem's business use is decided under that provider's terms.

## Switches

Switches replace the current deny-everything `ultra-policy.js` with owner-controlled settings.

- They are stored in `runs/station-runtime/ultra-switches.json`.
- Only the owner can change them, through `POST /api/ultra/switches`. That route requires same origin and an `If-Match` version, and each change is appended to a timestamped history.
- Agents may read the switches so the lead knows what is available. No agent tool can change them, and Starnet's station-control verbs (`look.set`, settings) exclude them.
- Emergency stop overrides every switch and halts runs, cron, Night Shift and channels.

| Switch | Default | Unlocks | Prerequisite |
|---|---|---|---|
| `lead.codex` | off | Lead chat and orchestration | ChatGPT sign-in in Starnet |
| `crew.freellmapi` | off | Crew agents, `team.dispatch` targets | FreeLLMAPI running with at least one provider key |
| `crew.escalate_to_lead` | on | The lead takes over crew subtasks that fail on every free option | `lead.codex` on |
| `tools.web` | off | Web search and page reading | none |
| `tools.browser` | off | Agent-driven headless browser | Playwright Chromium (present in `~/.cache/ms-playwright`) |
| `tools.shell` | off | Shell, terminal, and file access outside the agent workspace | none |
| `tools.computer` | off | Desktop control and opening windows on Adem's screen | none |
| `tools.mcp` | off | MCP connectors and plugins | Per-connector key or OAuth |
| `channels.telegram`, `.discord`, `.slack`, `.signal`, `.matrix` | off | Talking to the station from Adem's own accounts | A bot token Adem creates, plus owner pairing |
| `cron` | off | Scheduled routines | none |
| `nightshift` | off | Unattended work inside Starnet's leash, with the "While you were away" report | none |
| `voice` | off | Push-to-talk and spoken replies | An audio-capable provider |
| `skills.market` | off | Browsing and installing Skill Market packages | none |
| `providers.<id>` for each other provider | off | Direct use of Anthropic, OpenRouter, Gemini, Ollama and others | Adem's own key. A paid provider is refused while the spend cap is 0. |
| `concurrency` | 2 | Maximum simultaneous agent runs | none |
| `spend_cap_usd` | 0 | Paid provider use | none |

Always available without a switch: the station view and builder, crew editing and recruiting, memory, Outbox, Ctrl+K search, task board, workflows, recipes, the campaign window and its scripts, and the emergency stop.

### Outbound messages

- Channels connect Adem's own accounts to the station.
- The `comms` tool (agent speaks first) may only message Adem's paired owner chat.
- No tool sends email or messages to a third party. Messages to buyers still require Adem's explicit instruction for that exact message, as `AGENTS.md` requires.

### AGENTS.md update

`AGENTS.md` currently tells agents not to enable a scheduler or run endless loops. That stays true for agents: switches are owner-only. A short addition to "Authority and scope" says that Adem turning on `cron` or `nightshift` in the station is the owner's instruction for that switch, limited to Starnet's leash and away report. It does not authorize third-party messages, purchases or paid APIs.

## Art

- **Sources:** CC0 only. Each pack's license file is kept next to its images. `station/frontend/assets/CREDITS.md` lists pack, author, URL, license, download date and SHA-256 for each pack.
- **Starting candidates:** Ninja Adventure Asset Pack (Pixel-Boy and AAA, CC0) for crew with four-direction walk and idle frames. Kenney packs (CC0) for interior furniture, computers, and floor and wall tiles. A one-room visual check chooses the final set before everything is mapped.
- **Builder script:** `scripts/build_station_art.py`, using Pillow (installed), slices the sheets into the layouts Starnet loads:
  - Character skins in `assets/sprites/manifest.json`, with tracks `<skin>.<walk|sit|idle|blink>.<east|north|south|west>`. A missing pose reuses the nearest one; for example, sit reuses idle.
  - Prop images referenced by `app/prop-catalog-data.js`.
  - Floor and wall tiles.
- **Fallbacks:** a prop with no CC0 match uses Starnet's procedural fallback, or a labelled box when no fallback exists. No broken image may appear anywhere, and the browser check requires zero failed image loads.
- **Brand:** 1Ultra name and logo. No Starnet name, logo or wordmark in the interface, page titles or icons.

## Invariants (unchanged rules from AGENTS.md)

- Starnet code never writes `data/`. The SHA-256 of every `data/*.json` is identical before and after the upstream update, startup and the test suites.
- Agent output is a draft in Outbox. Contacts, replies, outcomes, receipts and XP come only from owner actions with evidence.
- No third-party message is sent without explicit per-message instruction.
- No live model call happens from cold start, restored settings, interface suggestions or tests. Tests use Starnet's replay fixtures and the existing fake Codex fixture.
- Exclusions in `data/exclusions.json` and the Tunisia-only scope apply to the campaign toolset.

## Verification

- `python3 -m unittest discover -s tests -v`
- Starnet's fast suite, `npm run test:fast`, inside `station/`. Tests that depend on excluded art, the website or Starnet branding are adapted where possible. Any test skipped is listed with its reason in `docs/ops/STATION.md`.
- The existing 1Ultra station JavaScript tests, updated for the new interface.
- New tests:
  - Every switch starts at its table default (off, except `crew.escalate_to_lead`, which is on but inert while `lead.codex` is off, and `concurrency`, which is 2), and only the owner route changes it.
  - An agent tool cannot change a switch.
  - The path deny-list holds for both providers.
  - With switches off, a network stub records zero outbound connections.
  - The campaign toolset refuses owner-only routes.
  - `comms` refuses any recipient other than the paired owner.
  - Crew health, using recorded FreeLLMAPI fixtures: each outcome class (429, timeout, `no_vision_model`, a downgraded `X-Routed-Via`, a result-schema failure) gives the expected ladder step. The three-move limit holds. Escalation is skipped when `crew.escalate_to_lead` or `lead.codex` is off. A member is benched after three failures and unbenched when readiness returns. The lead falls back to `auto:smart` when Codex fails.
  - Business record hashes are unchanged.
- Browser check at desktop width and 390 px, on copied records:
  - the station renders with crew;
  - zero failed image loads;
  - the campaign window opens;
  - the chat panel and Settings switches work.
- Live checks run only with Adem's approval of each specific check: one lead message through Codex, and one crew task through FreeLLMAPI after Adem adds provider keys.

## Phases

Each phase ends with a working app Adem can open.

1. **Foundation:** upstream update, Starnet interface at `/`, the switches (all off), the campaign window, and 1Ultra branding. The old views remain at `/campaign/` and `/classic/`.
2. **Art:** CC0 packs, the builder script, credits, and the zero-broken-image check.
3. **Models:** the Codex lead, the FreeLLMAPI install and crew, crew capability management, the campaign toolset, and the data deny-list.
4. **Remaining features, switch by switch:** web and browser tools, shell and computer tools, MCP and plugins, channels, cron, Night Shift, voice, Skill Market, other providers, and concurrency. Each is unblocked, tested with fixtures and documented.
5. **Documentation:** `docs/ops/STATION.md`, the `AGENTS.md` authority addition, and `README.md`.

Later: the desktop app (Tauri Linux build, OS keychain).

## Risks

- Starnet's views were designed around its own art, so some may look sparse with CC0 sprites.
- Free tiers lose quality late in the day as top models hit daily caps, and providers change quotas without notice. Crew capability management moves work to stronger options, but on a bad day more work escalates to the lead and uses more Codex allowance. The usage view shows how much.
- Without the desktop shell, Starnet stores provider keys and bot tokens as plaintext files under `runs/station-runtime/` (gitignored, mode 0600). FreeLLMAPI encrypts provider keys at rest; its encryption key sits in `services/freellmapi/.env` (gitignored). The OS keychain arrives with the desktop app.
- Besides calling the providers, FreeLLMAPI fetches its signed model catalog from freellmapi.co while it runs. Phase 3 lists every outbound host it contacts.
- Starnet has about 1,357 test files. Some depend on the website or excluded art. Those are listed, not deleted.
- The fork will drift from upstream. `UPSTREAM.json` and `scripts/update_starnet.py` make later updates repeatable.
