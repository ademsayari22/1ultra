# Tunisia lead hunt implementation plan

**Goal:** Expand 1Ultra into an actionable Tunisia B2B lead hunt, from discovery to convincing outreach.

**Architecture:** Keep the local Python server and native JavaScript UI. A bounded prospecting script handles country filtering, Apollo CSV previews, deduplication and pitch templates; the owner chooses and confirms real outcomes. Keep the dungeon as a companion to the lead workspace.

**Constraints:** No paid API, scheduler, external sending or inferred buyer interest. Preserve current owner edits, historical records and exclusions. Archive the removed consulting payment without marking it paid. Imports require explicit company country Tunisia; contact location alone is insufficient.

- [x] Add failing tests for country scope, CSV duplicate/exclusion handling, safe exports, draft persistence and optimistic concurrency.
- [x] Implement `scripts/prospecting.py` and bounded API actions for shortlist, pitch, import preview/commit and export. Reuse record validation/history.
- [x] Add a larger lead hunt workspace with pipeline filters, useful lead cards, guided mission actions and a native Apollo/Swokei popup. Keep details and record history accessible.
- [x] Refocus rooms and quests on finding leads, preparing persuasive pitches and recording actual replies. Preserve owner confirmation and dependency checks for XP.
- [x] Verify and add public Tunisian prospects in batches of at most five, with dated source observations and unconfirmed need hypotheses.
- [x] Archive the removed payment and inactive billing/job/remote tasks and leads; update current state, plan and mission.
- [x] Run the full Python suite, JavaScript checks, and desktop/mobile browser interactions in disposable data fixtures. Inspect screenshots and fix relevant regressions.

Review focus: Apollo company versus contact country; duplicate companies across files; malformed URLs and CSV formulas; stale concurrent edits; drafts and shortlisted leads never becoming sent messages or earned XP automatically.
