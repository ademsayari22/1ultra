# 1Ultra Tunisia lead hunt

Start from /home/adem/1ultra:

```sh
python3 scripts/ultra_ui.py
```

Open http://127.0.0.1:8541. Ctrl+C stops it. Use --port 8542 for another local port. Existing Python and browser tools are sufficient; no product dependencies, API keys, hosting or new subscriptions are required.

## Dungeon and quests

Start at the Lead hunt home or Lead board. The five rooms now represent finding Tunisian leads, preparing convincing pitches, real buyer conversations, checked pilot delivery and repeat work. Click any room to inspect its quests and boss requirements, including locked rooms. Arrow keys/WASD move the character within the selected unlocked room when the map is focused. Movement is cosmetic. Zoom and fit adjust the map.

The camp board lists the next three real actions using the same script as the CLI daily pack. Due/overdue dates take precedence over undated work; future-dated work remains scheduled. **Plan time** chooses one small opening offer and sets optional weekly hours and today's minutes; payment planning is expandable. Today's minutes expire after that local date (Africa/Tunis); follow-up time is additional to quest estimates. The consulting payment and billing quests are removed from the active campaign and archived. Optional billing details remain available for future client receipts.

The Quest journal supports search, readiness/owner/blocked/done/training filters and room-specific inspection. Select a quest and Update quest to change status, next-action date and estimated minutes. Evidence notes can be retained while work is in progress. Done requires nonblank evidence, owner confirmation and effective prerequisites. Conflicting edits are rejected; unsaved evidence is retained and confirmation must be repeated. Edit history preserves prior values; **Use previous values** loads them into the form for review before a new save.

Each distinct evidenced real quest earns 25 XP once, with a new level every 100 XP. XP is derived from records on each snapshot. Running scripts, rewriting evidence and training earn no extra business XP. Reopening a prerequisite removes downstream effective eligibility without erasing its historical completion record. Legacy completions without owner confirmation need reconfirmation for XP.

Boss clearance is separate from XP and actual money. Each boss requires specific completed quests and owner-confirmed references for real phase evidence. Review boss gate becomes available after those prerequisites. Game reviews live in data/game.json and do not update payments, leads or STATE.md. The Scout Outpost opens the Pitch Workshop after the two required scouting quests and a confirmed gate review. Optional expansion quests do not inflate required room totals. The Floor guide retains the business plan and evidence gates.

## Script workshop

| Service | Actual output |
|---|---|
| Daily pack | Next actions, record checks, finance facts, lead warnings and payment draft |
| Quest planner | Prioritized next three real quests and dependency blockers |
| Record sentinel | Task graph, receipt and record checks |
| Payment scribe | Currency-separated reconciliation, missing facts and an unsent follow-up |
| Lead scout | Stored exclusions, duplicates, expiry and freshness flags |
| Message press | Unsent French introductions for eligible service prospects |
| Scope inspector | Missing agreement inputs from the supplied form |
| Data forge | Original/cleaned CSV, source hash, preserved rows, conflicts and issue report |
| Training encounter | Fixed fictional buyer questions and review checklist |

Run daily pack performs one bounded local pass. All services save report.md/result.json and their relevant files in a unique runs/ folder. Workshop services launch no model, send no messages, complete no real quests and add no cash. An explicit Apollo import creates discovery records with original CSV provenance; it creates no contact, buyer need or XP. No scheduler is enabled.

The Data forge accepts a local CSV file or pasted text up to 60 KB, at most 5,000 rows and 50 columns. Supply the identifier column, optional amount column and separator. It trims cells, preserves all rows and never infers ambiguous amounts. Conflicting duplicates remain separate. Spreadsheet formulas are escaped in cleaned.csv; source.csv remains unchanged. Download cleaned.csv from its artifact preview and inspect flagged values before delivery. Synthetic examples are labelled in the form.

Scope completeness requires a permitted sample reference, fields, output format, quantity, exceptions, price/currency, payment terms, start condition, deadline and acceptance checks. It remains a preparation check, not buyer acceptance. Lead audits inspect stored facts without fetching websites or establishing interest. Payment references are owner-supplied; the script does not verify transfers with a bank. Unknown money remains unknown.

## Scripts before agents

The mandatory rule lives in AGENTS.md and the saved project workflows. Operations, routine finance and fixed customer agent definitions are archived. All seven role calls default to scripts. Research, Sales, Delivery and QA are available only for residual judgment with a stated reason. The workshop runs the applicable preflight and prepares a prompt. It has no live execution endpoint. See AGENT_WORKFLOW.md for the separate bounded CLI path.

```sh
python3 scripts/ultra.py script daily-pack
python3 scripts/ultra.py script finance-pack
python3 scripts/ultra.py script csv-workbench --params '{"csv_text":"id,amount\nA,12.500\n"}'
```

## Other sections

The Lead board shows Tunisian B2B company cards, source observations, unconfirmed need hypotheses and pipeline stages: Find → Shortlist → Prepare pitch → Await reply → Convince → Agree pilot. Search, city, niche and stage filters work locally. Star a lead to shortlist it; choose a small offer in its inspector to prepare a French pitch. Edit and confirm the pitch review before using it. The focused outcome form records actual contact/replies, evidence and follow-up dates. Discovery, shortlist and draft preparation are distinct from buyer outcomes. **Add lead** creates a discovery, including a warm contact with a relationship reference. Select a row and **Update lead** to record actual outcomes, evidence and follow-up dates. Positive progress requires a checked company, actual contact date, evidence and owner confirmation. Excluded or anonymous companies cannot become eligible through an outcome edit. Opening a source does not send anything.

Treasury shows actual receipt evidence, unknown receivables and deposit obligations with currencies separate. **Add payment** and **Update payment** accept unknown amounts and optional billing details. A receipt requires an exact amount, receipt evidence and confirmation; a deposit also needs its delivery/refund obligation. Correcting a receipt requires fresh confirmation. Reused receipt references are rejected. Run payment scribe creates a fresh unsent follow-up. Quest edits never update those business records.

Chronicle lists saved script results, training and judgment prompts. The daily brief opens as readable headings and actions with expandable full validation/finance/lead details. Other previews render literal text and allow downloading only an approved file. Lead, payment and task edits keep before/after history in their JSON records. A stale edit retains unsaved form values and loads current history for review before another save.

## Verification

Run `python3 -m unittest discover -s tests -v`. Request tests use temporary synthetic records. The updated lead hunt passed 109 Python tests and 27 browser interaction checks at 1584×992, 1366×768 and 390×844. The Playwright connector's expected Chrome binary was absent, so the checks used an already-installed Chromium 1223 with a disposable profile and a local script through its debugging protocol; no browser package was installed. Screenshots were inspected. The lead hunt now adapts to mobile layouts as well.

The server preserves loopback Host, same Origin, anti-forgery token, request size/type checks, optimistic versions, atomic records and path containment. UI text and controls are native; map and character assets are generated artwork. No live model call was verified during this change.

Run `node tests/test_web_views.mjs` for three additional view/amount/history checks when Node is available. Warm contacts display their relationship reference instead of an empty Source page button. No Node package is required to run the app.

## Evidence and review revisions

Real prerequisites must themselves be owner-confirmed real work. Training never unlocks a real chain. A seeded blocked quest becomes available when its prerequisites finish; an explicit owner-blocked status stays blocked. Floor guide uses the same effective real progress as the dungeon.

Boss reviews are bound to prerequisite evidence versions and need review again after those versions change. In the workshop, select the saved script result for a judgment prompt; its report and scope or CSV inputs travel with the question. Omitting a selection runs the specialist’s default preflight.

## Apollo and Swokei sourcing desk

The native popup is available from the home, Lead board and sidebar. Apollo guidance fixes Account HQ to Tunisia, with a city, niche, company-size suggestion and decision-maker titles. **Open Apollo** opens the external account; filters must be applied there. The local importer accepts up to 500 CSV rows / 300 KB and requires Company Name and Company Country (contact Country alone is insufficient). Comma, semicolon and tab exports are supported. Preview skips foreign/unknown company countries, exclusions and duplicate companies/websites. Commit checks the lead-record version again and saves the original CSV with row provenance. Imported contact/website details still need owner review.

Swokei is linked as an external alternative. Export the shortlist to a spreadsheet-safe CSV carrying company, website, contact route, source observation and any locally saved message. General Outreach is relevant to owner-controlled document/data templates; Smart Site Outreach targets website offers. No paid API, live Apollo scraping, connected mailbox or automated sending is configured. External account availability, deliverability and campaign behavior remain untested.

Quests now have action buttons, numbered steps and completion references prepared from current records for source review, shortlist, drafts and pitch reviews. Prepared references are drafts until the owner confirms the actual steps. Boss references are also prefilled from completed quest evidence. Returning to the dungeon preserves character position and zoom. Mobile lead selection scrolls to its inspector, with a back-to-board control.

The current research batch and source caveats are documented in `research/TUNISIA_B2B_2026-10-05.md`. Full prior records are preserved in `data/archive/2026-10-05-lead-focus/`; the previous plan is in `docs/business/archive/30_DAY_PLAN_2026-10-04.md`. Archive removal does not establish settlement of the historical payment. Browser QA used synthetic copies; no real contact, completed quest or cash was created.
