# Script-first workflow

Adem owns the business. Scripts prepare, calculate and validate repeatable work. Real conversations, accepted scopes, checked delivery and actual receipts establish business progress. Dungeon XP measures recorded work, not income or skill.

## Default services

| Former role | Default local service | Residual agent work |
|---|---|---|
| Operations | daily-pack, next-quests | Role retired; owner chooses direction |
| Finance | finance-pack | Role retired; owner verifies money and handles disputes |
| Customer | rehearsal | Role retired; fixed fictional encounter |
| Research | lead-audit | Interpret or find unfamiliar public sources |
| Sales | outreach-drafts, scope-check | Unusual buyer objection or specific tailoring |
| Delivery | scope-check, csv-workbench | Ambiguous inputs or genuinely new requirements |
| QA | validate-records, CSV issue report | Contextual review that exact checks cannot resolve |

Run any service from the Script workshop or CLI:

```sh
python3 scripts/ultra.py script daily-pack
python3 scripts/ultra.py script finance-pack
python3 scripts/ultra.py script lead-audit
python3 scripts/ultra.py script outreach-drafts
python3 scripts/ultra.py script rehearsal --params '{"scenario":"messy-pilot"}'
```

The CSV workbench takes explicitly supplied CSV text, identifier/amount column names and a delimiter. It preserves the source and every row, trims cells, neutralizes spreadsheet formulas and reports conflicts or invalid amounts. Scope-check takes a JSON scope object. The workshop supplies forms for these inputs. Outputs are saved under unique runs/ directories as report.md/result.json and relevant CSV/draft files.

Scripts do not browse sources online, contact people, verify bank transfers, agree client terms or silently update real records. Lead audits show gaps in stored facts; outreach is unsent. Unknown finance fields remain unknown. Daily packs award no XP.

## Residual judgment

If a script can do the job reliably, use or extend it. Only the four remaining native roles under .codex/agents/ are available for residual judgment. The three retired definitions are archived under .codex/retired/ for historical reference and must not be invoked.

Ordinary `agent ROLE` calls now run the default script. Preparing a judgment prompt requires a reason. Choose a saved script result in the workshop, or add `--script-run SCRIPT_RUN_ID` to carry its actual scope/CSV inputs and report into the review:

```sh
python3 scripts/ultra.py agent ultra_sales --judgment-reason 'Interpret this unusual buyer objection after the script draft'
```

This performs the applicable script preflight and saves a prompt; it does not call a model. The workshop offers the same preparation action. A separate explicit --execute CLI flag uses the existing account for one bounded, read-only model call. No live model call was made during this redesign, and the website exposes no live execution endpoint.

Workers return findings; the coordinator alone writes accepted real records. Use at most two workers concurrently, never recursive delegation. Inputs, reason, question, output, tools and stop conditions must be explicit. Account usage can have a cost; new spending remains unauthorized.

## Progress and review

Complete quests only from actual owner input. Nonblank evidence, owner confirmation and fully owner-confirmed real dependency chains are required for XP. Reopening a prerequisite invalidates downstream effective completion without deleting historical records. SIM01 and simulation-mode tasks are training and award no business XP.

Boss gates need their prerequisite quests and references for real phase evidence. Gate reviews are owner-confirmed declarations, not independent proof. A review is bound to its prerequisite evidence versions; changed quest evidence requires a fresh review. They affect dungeon clearance records only, not payments, leads or STATE.md. The current campaign progresses through Scout Outpost, Pitch Workshop, Conversation Hall, Delivery Forge and Repeat Chamber. Sourcing remains inside Tunisia.

External actions still require the concrete owner instruction in AGENTS.md. A template, script output, AI answer, level or cleared room never authorizes sending, purchasing, publishing or accepting terms.
