# Historical automation plan

The initial implementation below is retained for provenance. The current implementation and verification plan is [DUNGEON_PLAN.md](DUNGEON_PLAN.md). All routine role calls now dispatch to scripts. Model preparation requires a judgment reason; Operations, Finance and Customer agent definitions are retired. The mandatory script-first rule in AGENTS.md takes precedence over this historical plan.

# 1Ultra Local Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans if available to implement future changes task-by-task. If unavailable, follow the interfaces, tests and stop conditions below in the current workspace.

**Goal:** Prepare daily work and fictional rehearsals without inventing cash or performing external business actions.

**Architecture:** Markdown and JSON records feed a Python helper. Optional one-role Codex calls return a checked draft into a unique run folder. The helper never applies model output to real ledgers.

**Tech Stack:** Python 3.10+ standard library; existing Codex CLI for opt-in model runs.

**Spec:** `docs/business/DESIGN.md`.

## Global constraints

- Runtime: Python 3.10+; no required third-party Python packages.
- Never sum different currencies.
- TND monetary units use 1,000 per dinar; USD/EUR use 100.
- Unknown amounts are null, not zero.
- Optional live results stay drafts with an owner-action list.
- Simulations write to their own run directories and never update real ledgers.

## Review focus

- A claimed payment without receipt evidence must not inflate received cash.
- Unknown receivable values must remain visibly unknown.
- A fictional buyer/payment must not affect real metrics.
- A dry run must not start a subprocess or spend model usage.
- A failed, missing, malformed or wrong-role result must fail visibly and leave records untouched.

## Task 1: Status and local preparation

Files: `scripts/ultra.py`, `tests/test_ultra.py`, `data/payments.json`, `data/tasks.json`.

Interfaces: `cash_summary(records: list[dict]) -> dict`, `money(amount_minor: int | None, currency: str) -> str`, `prepare(root: Path) -> Path`.

- [x] Define failing checks for evidenced received cash, unknown amounts, per-currency totals and TND fractions.
- [x] Implement read-only status calculation and unique brief folders.
- [x] Verify real data records remain unchanged after local preparation.

## Task 2: Fictional case preparation

Files: `simulations/scenarios.json`, `scripts/ultra.py`, `tests/test_ultra.py`.

Interfaces: `simulate(root: Path, scenario_id: str) -> Path`; scenario IDs must exist in the fixture file.

- [x] Define a check that a fictional receipt never changes actual cash records.
- [x] Prepare the scenario and role prompts in an isolated run directory.
- [x] Reject an unknown scenario before creating output.

## Task 3: Optional model-backed role run

Files: `scripts/ultra.py`, `schemas/agent_result.schema.json`, `.codex/agents/*.toml`, `tests/test_ultra.py`.

Interfaces: `agent(root: Path, role: str, scenario_id: str | None = None, execute: bool = False, runner=None) -> Path`; default runner calls `subprocess.run` without a shell only in execute mode.

- [x] Define checks for dry-run behavior, command sandbox/role settings, failed subprocesses and invalid result modes.
- [x] Build a command from fixed flags, fixed project paths and a validated role, with stdin prompt and 180-second timeout.
- [x] Validate the returned role/mode/evidence/action structure; record failure rather than updating real records.
- [ ] Owner-authorized live test using the existing Codex account, with an input suitable for the model. This has not run during installation.

## Run checks

`python3 -m unittest discover -s tests -v`

Run local `status`, `prepare`, `simulate messy-pilot` and a dry `agent ultra_sales`. Check outputs and real-record hashes. Documentation syntax, native-role format and skill frontmatter validation complement these behavior tests; they do not prove account/model access.
