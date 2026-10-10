# Business workflow implementation plan

> Implement inline with scripts and tests. The owner approved the five improvements from the preceding review and asked to leave billing facts for later.

**Goal:** Record real outcomes, keep evidence history, plan dated work and present a useful daily brief without requiring billing details.

**Architecture:** Keep the local standard-library server and JSON records. Add validated, versioned record edits with history in the same atomic JSON write. Use one script-generated daily plan in the CLI and dungeon.

**Constraints:** No purchases, external actions, invented outcomes or automatic quest completion. Unknown finance fields stay null. Amounts use integer minor units. Existing task/payment/lead facts remain intact. Persist only the owner's preference to defer billing preparation.

**Review focus:** Stale edits must retain unsaved form data; receipts must require evidence and remain unique; task reopening must invalidate XP while keeping old evidence; dates use Africa/Tunis; excluded or anonymous companies cannot become eligible through editing.

- [x] Add failing regression tests for dated/capacity-aware planning, billing deferral, history, record validation and stronger scope completeness.
- [x] Implement record validators and atomic versioned lead/payment/planning endpoints in `scripts/records.py` and `scripts/ultra_ui.py`; retain task revision history and editable dates.
- [x] Implement `next_quests(root, today=None)` and readable daily brief rendering in `scripts/automation.py`; expose the same plan in the workspace snapshot.
- [x] Add native record/planning forms, task dates/history, scope fields and expandable daily details in `web/record-editor.js`, `web/game-app.js`, `web/game-views.js`, `web/index.html` and `web/dungeon.css`.
- [x] Run `python3 -m unittest discover -s tests -v`, syntax checks and rendered browser flows on a disposable workspace. Inspect desktop screenshots and retain unknown real facts. Update README/interface/data documentation.

Execution notes and verification will be recorded here as each stage finishes.

Verification: 96 Python tests passed, including 20 new workflow regressions and four new HTTP checks. Initial regressions failed before implementation. Nineteen bounded browser checks passed, including stale writes, precise TND deposits, historical-value loading, unknown billing fields, scope completeness and expandable daily results. No page/console errors or external interaction requests were observed. Screenshots at desktop and laptop sizes were inspected. The browser checks used a copied workspace under /tmp; their synthetic contacts and receipts never entered data/.

Three JavaScript checks (`node tests/test_web_views.mjs`) passed for warm-contact references, exact currency precision and escaped history with revision loading. The warm-contact reference check failed before removing its empty source link; the corrected view was also checked in the rendered browser. A final daily-brief screenshot used a clean copy of the real records (no recorded receipts); a separate synthetic check confirmed that deposits retain visible delivery/refund obligations. Test servers and the disposable browser were stopped after verification.

Author review: all five requested changes map to implemented code and executable checks. Existing localhost anti-forgery, version and path boundaries remain in use. The daily capacity gets a local date to prevent yesterday's limit from silently constraining today. No new dependency, external action or automatic business completion was introduced. Mobile and simultaneous independent filesystem writers remain outside the tested scope.
