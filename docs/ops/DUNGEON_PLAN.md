# Dungeon and script-first implementation plan

> For agentic workers: use superpowers:executing-plans inline. Independent reviewers remain read-only; the coordinator applies changes.

Goal: provide a working desktop dungeon whose quests reflect genuine progress, with script-first automation available from UI and CLI.
Architecture: existing stdlib API and ES modules; new isolated progression and automation modules; no new dependencies.
Spec: docs/ops/DUNGEON_DESIGN.md.

## Global constraints

Bind 127.0.0.1 only. Existing tools, zero new purchases. Owner-confirmed evidence is not independent verification. Unknown financial data remains unknown. Scripts write artifacts only. XP never counts as income or AI ability. No live model, sending, scheduler or ledger changes through routine automation.

## Review focus

Cycles/duplicates must fail visibly; whitespace must not unlock tasks. Reopened prerequisites revoke derived progression. Gate reviews must check both task and gate versions. CSV conflicts/source rows must survive. New artifact filenames must remain inside approved run paths.

## Task 1 — progression

Files: scripts/quests.py; tests/test_quests.py; scripts/ultra.py; scripts/ultra_ui.py.
Interfaces: effective_done(tasks)->set; progress(tasks,game)->dict; gate_requirements(phase)->list.
- [x] Write and observe failing XP/dependency/gate tests.
- [x] Implement recursive eligibility, 25 XP, level thresholds, gate evidence and owner confirmation.
- [x] Apply consistent dependency checks to daily briefing and API writes; verify tests.

## Task 2 — useful scripts and policy

Files: scripts/automation.py; tests/test_automation.py; AGENTS.md; .codex/agents; docs/ops/AGENT_WORKFLOW.md.
Interfaces: run(root,automation,params=None)->Path; catalog()->list; default_script(role)->str.
- [x] Write failing tests for finance, lead audits, scope and CSV/no-model behavior.
- [x] Implement the nine services, safe reports, source preservation and default role dispatch.
- [x] Require a recorded judgment reason for model prompts; retire the three script-only roles; update policy and verify.

## Task 3 — API and dungeon frontend

Files: scripts/ultra_ui.py; tests/test_dungeon_ui.py; web/index.html/dungeon.css/game-app.js/game-views.js/dungeon.js; web/assets.
Interfaces: workspace.game/progression/automations; POST /api/automate; POST /api/judgment; POST /api/gates/<phase>.
- [x] Generate complete desktop concept and dedicated production map/actor art; extract tokens and layout.
- [x] Write failing request tests, implement allowlisted automation/gate actions, and verify.
- [x] Implement HUD, dungeon movement/room inspection, quest board, workshop forms, archive/artifact download and evidence dialogs.
- [x] Verify desktop interactions and compare actual render against concept.

## Task 4 — install and handoff

Files: README.md; docs/ops/INTERFACE.md; DUNGEON_INSTALLATION.json.
- [x] Obtain independent read-only review; fix material issues.
- [x] Install only reviewed changed files with backups and original-hash conflict checks; preserve the five real JSON ledgers and STATE.md.
- [x] Run required installed tests, restart loopback app, exercise installed desktop, and report limitations.

Verification details and resolved review findings: DUNGEON_VERIFICATION.md. The installation/handoff items are finalized only after installed checks are recorded in DUNGEON_INSTALLATION.json.
