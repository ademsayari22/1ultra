# 1Ultra

A local income workspace for Adem Sayari in Sousse, presented as a responsive lead hunt with a dungeon companion. The current focus is finding Tunisian B2B leads and preparing convincing, truthful outreach. Company cards, shortlist actions, French pitch preparation, real reply tracking and guided quests replace the form-only path. Repeatable preparation runs through scripts. The goal is received income from work Adem can deliver and check. The name is a working project name, not a registered company or evidence of clients.

## Open the campaign station

```sh
python3 scripts/station.py
```

Open **http://127.0.0.1:8541** for the station: **WORK → CAMPAIGN** opens the Tunisia campaign and **SYSTEM → SWITCHES** shows what agents may use. The campaign page alone is at **http://127.0.0.1:8541/campaign/**. The merged station requires Python 3.10+, Node.js 20+ and the pinned free runtime dependencies in `station/` (`npm ci --ignore-scripts --no-audit --no-fund`). No API key or paid service is needed.

The station adds explainable lead ranking, checked proof packs, reply branches, editable rooms and crew, durable company sessions, preparation tasks, bound script workflows, memory, an artifact outbox, focus timers and fictional practice. See the [station guide](docs/ops/STATION.md) for active features, local checks and retained provider/extension scope.

The original dungeon remains at **http://127.0.0.1:8541/classic/**. Its standard-library fallback is `python3 scripts/station.py --classic --port 8542`. The features below describe that companion interface.

- **Dungeon:** five rooms, a movable character, room locks and the next three available quests.
- **Quest journal:** all real tasks and separate training, search, readiness filters, dates and recoverable evidence history.
- **Script workshop:** nine local services with CSV uploads, scope forms, saved results and downloads.
- **Leads / Treasury:** add or update discoveries, actual contact outcomes, follow-ups and payments; keep unknown amounts and separate currencies.
- **Chronicle:** saved script results, judgment prompts and fictional training.

A distinct real quest earns 25 XP only with nonblank evidence, owner confirmation and a fully confirmed real prerequisite chain. Four quests raise the level. Repeated saves, script runs and training earn no extra XP. Reopening a prerequisite removes downstream effective progress while preserving recorded history.

Boss reviews require core quests and owner-confirmed references. Changing their quest evidence invalidates the previous review. Room clearance does not change the recorded business phase, agree terms or prove money arrived.

See the [interface guide](docs/ops/INTERFACE.md) and [script-first workflow](docs/ops/AGENT_WORKFLOW.md).

## Start earning work

1. Read [STATE.md](STATE.md) and the [30-day plan](docs/business/30_DAY_PLAN.md).
2. Use **Plan time** to set today's optional time budget, then run the daily pack. Billing preparation is currently deferred at Adem's request; enable it again in Plan time when useful. Unknown amounts and dates remain unknown.
3. Select one bounded service, prepare a permitted example and check it against its source.
4. Review the stored prospects, speak to actual buyers, agree a small scope and deliver it with checks.
5. Record real outcomes only after they happen. A prepared message is unsent; a simulated sale is fictional.

## Scripts replace routine agents

Mandatory rule in [AGENTS.md](AGENTS.md): **if a script can reliably perform the task, use or extend the script instead of an agent.**

| Service | What it prepares |
|---|---|
| daily-pack | Next quests, record checks, finance facts and lead warnings |
| next-quests | Three available actions, ordered by priority |
| validate-records | Task graph, confirmation, receipt and record checks |
| finance-pack | Separate currency totals, missing facts and unsent follow-up |
| lead-audit | Stored exclusions, duplicate IDs/sources, expiry and stale dates |
| outreach-drafts | Unsent introductions for eligible service prospects |
| scope-check | Completeness of explicitly supplied scope inputs |
| csv-workbench | Source-preserving CSV cleanup and exception report |
| rehearsal | Fixed fictional buyer questions and review checklist |

Operations, routine Finance and fixed Customer roles are retired as agents; their definitions are archived in `.codex/retired/`. Research, Sales, Delivery and QA remain only for questions scripts cannot resolve. Their routine commands also run scripts by default.

```sh
python3 scripts/ultra.py status
python3 scripts/ultra.py script daily-pack
python3 scripts/ultra.py script finance-pack
python3 scripts/ultra.py script lead-audit
python3 scripts/ultra.py agent ultra_sales
python3 -m unittest discover -s tests -v
```

Outputs go to unique `runs/` folders. The daily pack opens with a readable brief; full checks remain in `result.json` and can be expanded in the preview. Due and overdue quests precede undated work; future-dated work stays scheduled. The daily time budget applies only to the day on which it was saved, and follow-up time is additional. Scripts do not send messages, browse sources, verify transfers or automatically complete quests. The CSV workbench retains every row, original input and amount text; it flags conflicting identifiers, ambiguous amounts and formulas, including headers.

Record forms keep billing details optional. Actual contact outcomes require a date, evidence and owner confirmation. Actual receipts require an amount, a unique receipt reference and confirmation; deposits also require their delivery/refund obligation. Each edit keeps a dated revision. **Use previous values** loads a historical version into the form for review and a fresh save.

## Judgment only when needed

The workshop can prepare a review prompt referencing a selected saved script result, including its scope or CSV inputs. It requires a specific reason the script cannot answer the question. No model runs through the website.

The equivalent CLI preparation is:

```sh
python3 scripts/ultra.py agent ultra_sales --judgment-reason 'Interpret the unusual buyer acceptance clause' --script-run SCRIPT_RUN_ID
```

Omit `--script-run` to generate the specialist’s default preflight. A separately chosen `--execute` flag performs one bounded read-only Codex call through the existing account. Live model execution was not exercised during this redesign; it consumes account usage and does not update real records. Script-only roles reject judgment execution.

For an ordinary Codex session:

```sh
codex -C /home/adem/1ultra
```

> Use $ultra-start. Follow AGENTS.md and STATE.md. Run the daily script pack, inspect its warnings and identify my next real action. Use scripts for every repeatable task. If interpretation remains, explain why and prepare one bounded judgment review.

## Project structure

```text
1ultra/
├── AGENTS.md, STATE.md        Operating rule and business facts
├── .codex/agents/            Four residual judgment roles
├── .codex/retired/           Three archived script-replaced roles
├── .agents/skills/           Five saved script-first workflows
├── context/                 Founder evidence and unknowns
├── docs/business/            Phases, offers and decision rules
├── docs/ops/                 Dungeon and automation guides
├── data/                    Real records plus separate game reviews
├── research/                Dated source notes
├── sales/, delivery/        Templates and scoped checks
├── finance/                 Payment follow-up template
├── simulations/             Fictional cases and historical rehearsals
├── schemas/                 Optional judgment-result contract
├── scripts/                 Local server, quests, automation and runner
├── tests/                   Helper and HTTP regression checks
├── web/                     Native desktop interface and generated art
└── runs/                    Saved preparation artifacts
```

The active list contains 20 Tunisian B2B discoveries: four prior local prospects and 16 additions reviewed on 5 October 2026. A stored-record audit does not establish current availability, buying interest or permission to contact. Use the phase evidence to decide the next business action.

## Lead hunt update · 5 October 2026

Use Lead hunt → Lead board → shortlist five companies → prepare three specific pitches → review them → record actual buyer replies. The in-game Apollo desk provides Tunisia sourcing recipes and CSV previews/imports. Swokei is linked as an external outreach alternative, with shortlist CSV export. These are external-account workflows; no API scraping, mailbox sending or scheduler is connected.

The owed consulting payment and billing quests were removed from the active campaign at Adem’s request. Original records are recoverable in `data/archive/2026-10-05-lead-focus/`; no receipt was inferred. Your existing 30-hour weekly capacity is preserved. Read [source research](research/TUNISIA_B2B_2026-10-05.md) and [interface details](docs/ops/INTERFACE.md).
