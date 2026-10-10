# 1Ultra campaign crew: the campaign as Starnet agent work

Status: draft for owner review, 10 October 2026.
Builds on `2026-10-10-starnet-full-merge-design.md`. This document replaces that spec's "Campaign inside Starnet" section and refines its Phase 3. The models, switches, FreeLLMAPI and capability-management sections of that spec still apply. Phase 1 (`docs/superpowers/plans/2026-10-10-starnet-merge-phase1-foundation.md`) is complete on branch `phase1-foundation`.

## Goal

Adem runs the Tunisia lead campaign from the station, with every step visible:

- He talks to **ULTRA** in COMMS, or picks a company on the **LEADS** board.
- ULTRA runs on Codex `gpt-6.1-sol` at reasoning `xhigh`. It plans the work, asks Adem anything unclear on a question card, and hands steps to crew agents.
- The crew agents run on FreeLLMAPI. Each one has a desk in a Campaign room, and Adem watches them walk, work and hand crates along the **Tunisia Lead Line**.
- Results land in Deliverables → TO REVIEW, and as proposed leads on the LEADS board.
- Adem sends every message himself and confirms what really happened through quests. Only those confirmations change business records or business XP.

Done means:

- With `lead.codex`, `crew.freellmapi` and `tools.web` on, Adem asks ULTRA in COMMS to prepare outreach for one sourced company.
- ULTRA dispatches the crew, the job rides the line on the floor, and a checked French pitch and proof pack appear in TO REVIEW.
- Approving the pitch creates a "Send pitch to <company>" quest.
- Confirming that quest with evidence records the contact through the Python worker.
- Nothing is sent by any agent, and `data/` changes only through the worker.

## Owner decisions (10 October 2026)

| Topic | Decision |
|---|---|
| Shape | The campaign runs as normal Starnet agent work (COMMS, crew, lines, Deliverables, quests), not as add-on windows or script stand-ins |
| Orchestrator | ULTRA on Codex `gpt-6.1-sol`, reasoning `xhigh` |
| Crew | Agents on FreeLLMAPI, with failover as in the full-merge spec |
| Visibility | Everything happens on the station in front of Adem |
| Build | Codex agents (`gpt-6.1-sol`, `xhigh`) implement plan tasks; Claude writes the briefs, reviews and tests each result |

## Crew

First start seeds four crew members next to ULTRA, each with a desk in a **Campaign room**:

| Agent | Role | Default tier (FreeLLMAPI) | Tools |
|---|---|---|---|
| Research | Finds and checks Tunisian companies; records source URL, date and quoted text | `smart`, tools | campaign read, `campaign.propose_lead`, `campaign.audit`, web search and page reading |
| Delivery | Builds the proof pack for one company from a permitted sample or a labelled synthetic example | `standard`, tools | campaign read, `campaign.proof`, files |
| Sales | Writes the company-specific French pitch from the checked packet | `smart`, French and English | campaign read, `campaign.save_draft`, files |
| QA | Checks claims, sources, exclusions and suppression; ends with `VERDICT: approved` or `VERDICT: revise` | `smart`, tools | campaign read, `campaign.check_draft` |

- Each crew member's standing instructions come from `.codex/agents/ultra_<role>.toml` and the matching `.agents/skills/` file, as today.
- Adem can edit them in the dossier and recruit more crew with Starnet's class builder.
- The Campaign room holds the props that grant capabilities: a computer per desk, a cabinet (files) and a dish (web). Web tools still need the `tools.web` switch.

## Campaign toolset

The deterministic campaign services become tools that every agent run can call:

- They are registered by a 1Ultra patch where Starnet builds each run's tool registry.
- They are thin wrappers over the Python worker (`scripts/campaign_rpc.py`).
- They are read and draft only.

| Tool | Does | Writes |
|---|---|---|
| `campaign.leads` | Lists sourced leads with ranking and reasons, honouring exclusions and Tunisia scope | nothing |
| `campaign.lead` | Returns one company: sources, contacts, signals, follow-ups, proofs, drafts, events | nothing |
| `campaign.audit` | Runs the source audit on chosen leads | a run folder under `runs/` |
| `campaign.proof` | Builds a proof pack for a company | a run folder under `runs/` |
| `campaign.check_draft` | Checks a draft against suppression, stale sources, exclusions and claim rules | nothing |
| `campaign.save_draft` | Saves a pitch draft as **unreviewed**, bound to the company and source version | `data/campaign-workbench.json`, via the worker |
| `campaign.propose_lead` | Adds a **proposed** company with source URL, observed date and quoted text; refuses a duplicate, an exclusion or a non-Tunisian company | a pending list via the worker; never `data/leads.json` directly |

- No tool sends anything, marks anything sent, or records a reply, outcome, receipt, quest or XP.
- Tool outputs are files written with Starnet's own file tools, so they appear in Deliverables with run provenance.
- The data rule from the full-merge spec holds. Founder documents, court records, client samples and `data/private/` never go to a model.

## The Tunisia Lead Line

- A ready-made line is stamped into the Campaign room on first start:
  - **LEADS IN**, then the **Research** bay, then the **Delivery** bay, then the **Sales** bay
  - then a **QA** reviewer with a loop gate: back to Sales until `VERDICT: approved`, at most 3 passes
  - then the **OUTBOX**
- Each bay has DOES and HANDS OFF instructions matching the crew table.
- A job carries one company: its ID plus the checked packet from `campaign.lead`. It appears as a crate riding the belts, a line-job record under WORKFLOWS, and files in Deliverables.
- A job starts from any of three places:
  - **LEADS → Work this company**
  - ULTRA in COMMS ("prepare outreach for Cabinet ZAATIR"), using its line launch or `team.dispatch`
  - a recipe card "Prepare outreach for {company}"
- A loop gate that runs out of passes delivers the job marked **unapproved**. TO REVIEW shows that state.
- Adem can reshape the line in Starnet's workflow panel.

## LEADS board

LEADS is a native station window: the campaign's one screen of its own.

- **Board:** sourced companies with ranking, reasons and adjustable weights; shortlist; offer and capacity; exclusions.
- **Proposed:** companies the crew proposed, with source link, date and quote. **Accept** adds a proposed company to `data/leads.json` through the worker; **Reject** records why.
- **Company card:**
  - sources, contacts, signals, follow-ups, proof packs, drafts and recorded events
  - **Work this company**, which starts a line job
  - **Open session**, which opens the company's COMMS session
  - **Approve draft**, which binds the approval to the draft version
- Funnel counts (sourced, shortlisted, contacted, replied) appear as a top-bar widget.

## Owner actions through quests

- **Approving a draft** creates an attest quest, "Send pitch to <company>". Its contract key is `ultra:send:<lead id>:<draft version>`.
- **Confirming the quest** requires evidence of at least ten characters (date, channel, recipient) and records the contact event through the worker.
- A **reply** is recorded the same way, as an attest quest "Record reply from <company>" holding the original wording. Interpretation of the reply is a separate crew task, kept apart from the original text.
- **Agreed scope, deposit and payment** follow the same pattern. Each needs the evidence `AGENTS.md` requires.
- The quest confirm and report routes call a 1Ultra hook that writes through the worker. That hook runs only for owner-initiated confirmations (same-origin page with the API token).
- An agent submitting attest evidence never completes such a quest by itself.
- Business XP is derived only from these confirmed quests, with the existing dependency rules in `data/tasks.json` and `data/game.json`. Starnet's own Commander points and crew XP stay separate.

## Plan as a goal

- The 30-day plan (`docs/business/30_DAY_PLAN.md`) is seeded as a Starnet goal: "Win one bounded paid pilot in Tunisia".
- The plan's phases become milestones, and their owner steps become quests.
- Automated milestone progress never awards business XP.

## Models and switches

The full-merge spec's model sections apply.

- **ULTRA:** Starnet's `codex` provider with `gpt-6.1-sol` and `xhigh`, after Adem signs in with ChatGPT inside 1Ultra.
- **Crew:** Starnet's `openai-compatible` provider pointed at FreeLLMAPI on `127.0.0.1:3001`.
  - Crew capability management runs as specified: tiers, `X-Routed-Via`, the reassignment ladder and benching.
  - **Before Adem's keys exist,** FreeLLMAPI is configured with OVH AI Endpoints' anonymous access (no account; 2 requests per minute per model), so the crew can be tested.
  - **Adem then adds free keys** for Groq, Cerebras and OpenRouter on FreeLLMAPI's Keys page. Keys are never pasted into chat.
- `lead.codex`, `crew.freellmapi`, `crew.escalate_to_lead` and `tools.web` become `ready`, so Adem can turn them on. Every other switch stays as in Phase 1.
- **Before any switch becomes `ready`,** the 1Ultra emergency stop is wired to every switch-gated path. When it is on, model calls, line jobs, crew dispatch and web tools are refused.
- The outbound network guard allows only these hosts, and only while their switch is on:
  - the Codex backend: `chatgpt.com`, plus the OAuth hosts Starnet's sign-in uses
  - FreeLLMAPI on `127.0.0.1:3001`
  - web search and page hosts for `tools.web`
- Starnet-named code values that reach third parties are patched to 1Ultra: the OAuth client name, the `X-Title` header and the MCP client info.

## Visibility

- **Floor:** crew bodies walk to their bays and crates ride the line. ULTRA's lead runs and crew handoffs animate as Starnet already does.
- **COMMS:** ULTRA's conversation with Adem, plus one session per company holding that company's jobs and agent transcripts.
- **Run receipts:** which model actually answered (`X-Routed-Via`), each failover step, and Codex usage. This is shown in the run details and the spending view.
- **Deliverables → TO REVIEW** for every produced file.
- **LEADS** for records, and **Quests** for confirmations.

## Retired

The `/campaign/` page and its frozen library copies are removed once LEADS and the line cover its features. `/classic/` stays. The campaign page's own floor, sessions, task board, workflow editor, recipes tab, crew tab, memory tab, outbox and settings are replaced by Starnet's own features.

## Build

Codex agents implement the plan tasks:

- Each runs `codex exec -m gpt-6.1-sol -c model_reasoning_effort="xhigh" -s workspace-write`, in its own git worktree under `.worktrees/`, with no network.
- At most two run at once, as `AGENTS.md` requires.
- Claude writes each task brief, then runs the tests and reviews the diff before merging the result into the feature branch.
- Codex usage draws on Adem's ChatGPT allowance.

### Stages

Each stage ends with a working station.

1. **Models:**
   - Codex sign-in and ULTRA on `gpt-6.1-sol` at `xhigh`.
   - FreeLLMAPI installed in `services/freellmapi/`, with OVH anonymous access configured.
   - The crew provider and crew capability management.
   - Emergency stop wiring, the host allow-list, the data deny-list and the third-party name patches.
   - The four switches made `ready`.
2. **Campaign crew:**
   - The Campaign room with four crew desks.
   - The campaign toolset.
   - The LEADS board.
   - Owner quests and the quest confirm hook.
3. **The line:**
   - The Tunisia Lead Line.
   - Line jobs from LEADS and from ULTRA.
   - Company COMMS sessions.
   - The goal with its milestones.
   - The funnel widget and usage display.
4. **Cleanup:** remove `/campaign/` and update the docs.

## Verification

- Every stage runs the Phase 1 suites, the HTTP smoke test, the three browser checks and the business-record hash check. Upstream fast tests must not regress beyond `docs/ops/STATION_UPSTREAM_TESTS.md`.
- **Model behaviour** is tested with recorded provider fixtures: Codex and FreeLLMAPI responses, including 429s, a downgraded `X-Routed-Via` and a schema failure. Tests never call a live model.
- **New tests cover:**
  - Every campaign tool refuses send, record and XP actions.
  - `campaign.propose_lead` refuses duplicates, exclusions and non-Tunisian companies.
  - A quest confirm from an agent run never records a business event; one from the owner does.
  - The emergency stop refuses model calls, line jobs and dispatch.
  - With every switch off, a network stub sees zero outbound connections.
  - Business record hashes are unchanged except through owner-confirmed worker writes in a copied fixture.
- **Live checks**, each only with Adem's go-ahead for that specific check:
  - one ULTRA message on Codex
  - one crew job through FreeLLMAPI (OVH anonymous first, then Adem's keys)
  - one full line job for one sourced company, ending in TO REVIEW

## Risks

- OVH anonymous access is slow (2 requests per minute per model), so the first live crew test will be slow.
- Free tiers lose quality late in the day. On a bad day, failover moves more work to ULTRA on Codex, which uses more ChatGPT allowance.
- Starnet's line runs every bay as an agent, so a crew failure on one step holds the crate until the failover ladder resolves it or the job fails visibly.
- The quest confirm hook and the campaign tools are 1Ultra patches inside Starnet's server. Upstream updates may move their anchors; the update script refuses to continue until the patches match again.
