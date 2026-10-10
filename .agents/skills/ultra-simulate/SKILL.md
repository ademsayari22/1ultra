---
name: ultra-simulate
description: "Run one fictional buyer/offer/delivery rehearsal for 1Ultra without touching real business records."
---

Choose an ID from simulations/scenarios.json; default messy-pilot.
Run `python3 scripts/ultra.py script rehearsal --params '{"scenario":"messy-pilot"}'`, using
the selected ID. The script produces fixed buyer questions and acceptance checks. Do not run
an agent for this deterministic rehearsal; the former customer agent is archived. Use the
scope-check script to examine a proposed scope. This is training and earns no business XP.
Record all output under simulations/results/ or the simulation run directory. Label fictional
buyers, approvals, payment and revenue. Compare data/ files before and after; do not change them.
Stop with buyer questions and one revised draft. A fictional sale is not phase exit evidence.
Read docs/ops/AGENT_WORKFLOW.md for the rehearsal acceptance criteria.
