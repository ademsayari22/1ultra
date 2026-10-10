# 1Ultra Interface Implementation Plan

> For agentic workers: use superpowers:executing-plans for inline implementation. Workers review read-only; the coordinator writes project files.

Goal: make the existing income workspace usable through a green ecosystem interface.
Architecture: thin local Python API plus native HTML/CSS/ES modules.
Tech stack: Python 3.10+ standard library; browser-native JavaScript and SVG.
Spec: docs/ops/INTERFACE_DESIGN.md.

## Global constraints

Bind only 127.0.0.1. No new paid tools or product dependencies. No live model invocation through HTTP. Source records stay truthful. Same-origin protected, allowlisted API actions and file access. No external sending or receipt invention.

## Review focus

Reject task completion lacking evidence or dependencies; reject stale writes. Keep simulation/draft creation out of real ledgers. Prevent arbitrary file access and cross-site writes. Show unknown amounts as unknown. Keep the dense graph and tables readable on narrow screens.

## Task 1: local workspace API

Files: scripts/ultra_ui.py, tests/test_ultra_ui.py.
Interfaces: create_server(root: Path, static_root: Path, port: int = 0) -> HTTPServer; Workspace.snapshot() -> dict; Workspace.update_task(task_id: str, body: dict) -> dict.
- [x] Write request-level tests against a temporary workspace for reading records, artifact containment, Host/Origin/token checks, allowlisted actions, dependency/evidence validation and stale writes.
- [x] Confirm missing implementation fails, then implement the server and run all helper/API tests.

## Task 2: reference-based usable interface

Files: web/index.html, web/styles.css, web/app.js, web/api.js, web/icons.js, web/graph.js, web/views.js.
Interfaces: API-backed state, selectable graph nodes, fit/zoom/pan, route navigation, filters, run preparation, artifact drawer, evidence-backed task editor.
- [x] Extract colors, type scale, rail widths, graph layout and allowed copy from the complete generated concept.
- [x] Implement modules and meaningful loading/error/empty states.
- [x] Validate the main rendered interactions, keyboard focus and mobile layout.

## Task 3: install and handoff

Files: README.md update, docs/ops/INTERFACE.md.
- [x] Review the actual code; install only the approved overlay files without overwriting unrelated work.
- [x] Run all tests in /home/adem/1ultra and start the loopback server.
- [x] Compare concept/reference with actual desktop and mobile renders; fix material mismatches. Keep temporary QA screenshots outside the repo.
- [x] Document the launch command and distinction between prepared drafts/fixtures and executed agents.

## Verification and scope

32 helper/API tests and 23 browser checks passed on 4 October 2026. Task editing and prepare actions were exercised in a disposable workspace. The six real data files stayed unchanged. No product dependencies were installed or live model calls made. Desktop is the priority following the owner’s clarification; no further mobile work is planned.
