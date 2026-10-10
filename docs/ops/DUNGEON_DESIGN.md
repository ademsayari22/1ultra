# 1Ultra dungeon and script-first design

The owner requested a desktop dungeon game with tasks and levels, more executable automation, replacement of routine agents with scripts, and a mandatory script-first rule. The app remains a local income workspace with truthful business records and zero new dependencies or purchases.

## Game

One native HTML/CSS/ES-module interface uses a pixel-art dungeon map, player HUD, quest journal, script workshop, leads, treasury and chronicle. Five rooms represent finding Tunisian B2B leads, preparing specific pitches, actual conversations, checked delivery and repeat work. Clicking rooms and native keyboard navigation reveal quests and boss evidence. Movement is cosmetic and grants no XP. The lead hunt and company board provide the primary actions; guided quest completion uses owner-confirmed evidence.

Each distinct real task earns 25 XP only when it is done, has nonblank evidence, has owner confirmation and its dependency chain remains complete. Level is 1 + floor(XP / 100). Derive totals on every snapshot; never store an incrementable XP counter. SIM01 and any simulation-mode tasks are training and award no business XP. Reopening a prerequisite removes downstream effective eligibility without rewriting historical task records. Unknown IDs, cycles and duplicate task IDs fail visibly.

Room clearance is separate from levels and cash. Gates require specific quest prerequisites plus explicit owner-confirmed references for actual phase evidence. Reviews live in data/game.json, with a separate version hash and atomic writes. Phase 0 requires F01/S01/S02/Q00 plus payment next action, checked example and bounded offer references. Phase 1 requires C02/F04 plus scope/start-condition references. Phase 2 requires D01/Q02/D02/F05 plus checks/acceptance/payment/time-cost references. Phase 3 requires P01/P02 plus recurring need/follow-on scope references. Phase 4 requires Q00/R03 plus owner decision and review references; it supports a pivot without requiring a prior sale. All rooms can be inspected while locked. A gate changes game clearance, not the payment ledger or recorded STATE phase.

## Automation

scripts/automation.py offers nine bounded local services: daily-pack, next-quests, validate-records, finance-pack, lead-audit, outreach-drafts, scope-check, csv-workbench and rehearsal. Each returns a unique run folder with engine=script, status, report and structured result. Only run artifacts are written; no automation marks real tasks done, contacts sent or money received.

Ops, routine finance and fixed customer rehearsals become script services. Research uses scripts for exclusions, deduplication and freshness; sales for stock drafts; delivery for specified CSV normalization; QA for structural checks. Retain Research/Sales/Delivery/QA model roles only for residual judgment. The helper defaults every role to its script; a judgment request must name why the script is insufficient. Script-only roles reject model execution. The interface prepares judgment prompts but has no live model endpoint.

CSV input is bounded text supplied explicitly. Preserve the original, row count, source hash and conflicting duplicates. Normalize surrounding whitespace only; flag missing keys, invalid decimals, duplicate conflicts and formula-like spreadsheet cells. Never infer unreadable amounts or silently drop records. Scope checks report missing agreement fields; they do not establish client acceptance. Lead audits check stored facts, not live buyer interest. Outreach remains unsent and excludes blocked/unknown companies.

## Boundaries

Preserve loopback Host, same Origin, token, JSON/size checks, optimistic versions, atomic replacement, artifact containment and literal text rendering. New static assets allow PNG/WebP. Scripts use no subprocess/model/network calls. A daily pack composes useful artifacts in one bounded pass; no scheduler or endless loop. Six existing data files remain unchanged during installation; game.json is the only new game record. Tasks acquire owner_confirmed only on a real owner edit.

## Verification

Tests cover derived XP idempotence, simulation exclusion, cycles, reopened prerequisites, honest gates, script dispatch/no-model execution, finance unknowns, alias exclusions, CSV source preservation/conflicts/formulas, scope gaps, same-origin API actions and stale game/task writes. Browser checks cover desktop navigation, dungeon room inspection/movement, quest completion, XP recalculation, workshop execution/artifacts, judgment reason validation, treasury unknowns and conflict recovery in a disposable fixture. Compare the generated concept and final desktop render directly; no further mobile work.
