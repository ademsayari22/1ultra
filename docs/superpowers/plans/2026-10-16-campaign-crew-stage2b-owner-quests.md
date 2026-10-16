# Campaign crew Stage 2b: owner actions through quests

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Approving a reviewed draft in LEADS creates a "Send pitch to <company>" quest in the station's quest log.
- When Adem reports that quest done with evidence, the campaign worker records the real contact once.
- Nothing an agent does can record it.

**Architecture:**
- **Quests.** Starnet's quest store already separates agent attestation (`quest.update` op `attest`) from owner completion (`POST /api/quests/report` and `/api/quests/confirm`, owner routes behind the API token).
- **The gate.** A 1Ultra gate patched into those two owner handlers runs before the store completes a quest whose contract key starts with `ultra:`. It sends the key and Adem's evidence to the Python worker through the in-process bridge, and the worker records the event idempotently, keyed by quest id.
- **Refusals.** If the worker refuses (the draft changed, suppression, evidence too short), the quest stays open and the owner sees why.
- **Minting.** LEADS mints the quest with the existing `POST /api/quests/mint`.

**Scope:** the send quest, the path to the first real outreach. Reply, agreed-pilot, deposit and payment quests follow the same pattern later: a new kind in `record_quest_event` and the same gate. They are not built here. Until then, Adem records replies with LEADS' existing evidence form.

**Tech Stack:** Node 20.3+, Python 3, `node:test`, `unittest`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-10-campaign-crew-design.md`, "Owner actions through quests" and Stage 2 ("Owner quests and the quest confirm hook"). Owner, 16 October 2026: "do these yourself". Claude implements inline (no Codex dispatch).

## Global Constraints

- Upstream Starnet files change only through `station/ultra-patches.json` (append at the end as raw text; never re-serialize) and `python3 scripts/update_starnet.py --repo /home/adem/1ultra/runs/upstream/starnet --revision 54899e5ff3f2b002b457757916b3977818db6fc1`.
- `data/` changes only through the Python worker. Tests use temporary roots; the smoke uses copied records. The records snapshot is compared before and after checks.
- Contract key format, exactly: `ultra:send:<lead id>:<draft version>`, where `<draft version>` is the first 16 hex characters of `campaign.fingerprint(lead, draft=True)`.
- Owner evidence is at least 10 characters (Starnet's `MIN_EVIDENCE`; the spec's "date, channel, recipient").
- Only the owner routes `/api/quests/report` and `/api/quests/confirm` (with `ok: true`) run the gate. Agent `attest` never records anything.
- Business XP is unchanged: the worker derives it from confirmed records exactly as before.
- Upstream fast tests: the same 150 recorded failures.

## Review Focus

1. **The draft changes after approval.** Reporting the old quest is refused ("the draft changed since you approved it"), and the event is not recorded. *Pinned by Task 1.*
2. **The same quest is reported twice** (double click, or a retry after a network error). There is one event, and the second call succeeds without a duplicate. *Pinned by Task 1.*
3. **Adem confirms an agent's attest with no note.** For an `ultra:` quest it is refused with "add what you did (date, channel, recipient)"; with a 10+ character note, the note is the evidence. *Pinned by Task 2.*
4. **A suppressed company.** Recording a send is refused by the worker's existing suppression rule, and the quest stays open. *Pinned by Task 1.*
5. **A non-`ultra:` quest.** Starnet behaviour is unchanged, with no worker call. *Pinned by Task 2.*

---

### Task 1: The worker records an owner-confirmed quest event

**Files:**
- Modify: `scripts/campaign.py` (`draft_version`, `record_quest_event`, `draft_versions` in the snapshot), `scripts/campaign_rpc.py` (`POST /api/hooks/quest-event`)
- Test: `tests/test_campaign_quests.py` (new)

**Interfaces:**
- Produces:
  - `campaign.draft_version(lead) -> str | None`: `fingerprint(lead, draft=True)[:16]` when the lead has a draft body, else `None`.
  - `Campaign.record_quest_event(body) -> {event, recorded: bool}`, where `body = {quest_id, key, evidence}`. It is idempotent by `quest_id` (the second call returns the stored event with `recorded: False`).
  - The worker route `POST /api/hooks/quest-event`. A `ValueError` becomes the worker's normal 400.
  - Snapshot field `draft_versions: {lead_id: version}`.

- [ ] **Step 1: Failing tests** (`tests/test_campaign_quests.py`, using the `tests/test_campaign.py` setup with a lead that has a reviewed draft `{'subject': 'Petit lot', 'body': 'Bonjour …', 'reviewed': True}`):
  - `test_send_quest_records_one_sent_event`:
    - `record_quest_event({'quest_id': 'q:1', 'key': 'ultra:send:tn:' + draft_version(lead), 'evidence': '2026-10-16 email to info@example.tn'})` gives `recorded is True` and `event['kind'] == 'sent'`.
    - The event's `evidence`, `quest_id == 'q:1'`, `confirmed is True`, `on == local today`, and `text == 'Petit lot'`.
    - A second identical call gives `recorded is False` with the same event id, and exactly one `sent` event is stored.
  - `test_changed_draft_is_refused`: a key with another version raises `ValueError` matching "draft changed since you approved it", and no event is stored.
  - `test_short_evidence_bad_key_unknown_lead_are_refused`: evidence "sent" (4 characters) and the keys `ultra:send:tn` (missing version), `ultra:pay:tn:x` (unsupported kind) and `ultra:send:missing:abc` each raise `ValueError`.
  - `test_suppressed_company_is_refused`: after a `do_not_contact` event for the lead (recorded through `action('event', …)`), the send quest raises `ValueError` matching "suppressed".
  - `test_snapshot_lists_draft_versions`: `snapshot()['draft_versions'] == {'tn': draft_version(lead)}`.
- [ ] **Step 2:** `python3 -m unittest tests.test_campaign_quests -v` → FAIL.
- [ ] **Step 3: Implement.** `record_quest_event` builds the existing `event` action body:
  - `{lead_id, kind: 'sent', on: local today, evidence, text: draft subject, confirmed: True, scope: 'company', quest_id}`.
  - `quest_id` is an allowed field of `event`, and the stored row keeps it.
  - It runs through the same lock, mutation and atomic write as `action`, but without the owner-version check, because the owner route is the authorization.
  - It first returns any existing event with that `quest_id`.
  - Key parsing: exactly four `:` parts, `ultra`, kind `send`, a known in-scope lead id and a 16-hex version.
  - `campaign_rpc.py`: route `POST /api/hooks/quest-event` → `store.record_quest_event(body)`.
- [ ] **Step 4:** run → PASS; `python3 -m unittest discover -s tests` → OK.
- [ ] **Step 5: Commit** `s2b t1: the worker records an owner-confirmed send quest once`.

### Task 2: The owner quest gate

**Files:**
- Modify: `station/ultra-host.js` (`questGate`, the 404 for `/api/ultra/hooks/`), `station/ultra-patches.json` (two entries on `sidecar/index.js`: report and confirm), regenerate `station/sidecar/index.js`, `station/UPSTREAM.json`
- Test: `tests/station-quest-gate.test.cjs` (new), `tests/test_ultra_patches.py`

**Interfaces:**
- Produces: `ultraHost.questGate(quest, evidence) -> Promise<{ok: true} | {ok: false, error}>`.
  - It returns `{ok: true}` without calling the worker for any quest whose `contract.key` does not start with `ultra:`.
  - For `ultra:` quests it refuses evidence under 10 characters with "add what you did (date, channel, recipient), at least 10 characters".
  - Otherwise it calls `call({route: '/api/hooks/quest-event', method: 'POST', body: {quest_id, key, evidence}, version: ''})`.
  - It refuses while the emergency stop is on.
- Patches:
  - In `handleQuestsReport`, before `questStore.reportCompletion`: `const gate = await ultraHost.questGate(questStore.get(body.id), body.evidence); if (!gate.ok) return json(400, gate);`.
  - In `handleQuestsConfirm`, when `ok` is true, before `confirmAttest`: the same gate with `body.note` as the evidence.

- [ ] **Step 1: Failing tests** (`tests/station-quest-gate.test.cjs`, a factory with a fake `call` and `isHalted`, exposed as `makeQuestGate({call, isHalted})` in a new `station/ultra-quest-gate.js` that the host uses):
  - A non-ultra quest returns `{ok: true}` with no call.
  - An ultra quest with 9 characters of evidence is refused with no call.
  - An ultra quest with valid evidence calls the hook route with exactly `{quest_id, key, evidence}`.
  - A worker error becomes `{ok: false, error: <message>}`.
  - With the stop on: refused, no call.
- [ ] **Step 2:** `node --test tests/station-quest-gate.test.cjs` → FAIL.
- [ ] **Step 3: Implement** the factory, the host wiring (`questGate` export; `/api/ultra/hooks/` refused with 404 like `/api/ultra/tools/`), and the two patch entries. Add source assertions to `tests/test_ultra_patches.py` (the gate comes before `reportCompletion` and before `confirmAttest`).
- [ ] **Step 4:** run the gate test, `python3 -m unittest tests.test_ultra_patches`, and every station suite → PASS.
- [ ] **Step 5: Commit** `s2b t2: owner quest completion records ultra quests through the worker first`.

### Task 3: LEADS approves a draft into a quest

**Files:**
- Modify: `station/frontend/ultra-leads.js`, `station/frontend/ultra-leads.css`
- Test: `tests/station-leads.test.cjs`, `tests/station-starnet-browser.cjs`

**Interfaces:**
- Consumes: `C.draft_versions` (Task 1), `GET /api/quests` and `POST /api/quests/mint` (Starnet; token header).
- Produces these view helpers:
  - `sendQuestKey(lead, version)`, which returns `'ultra:send:' + lead.id + ':' + version`.
  - `sendQuestFor(quests, lead, version)`, which returns the open or done quest with that key, or `null`.
  - `staleSendQuests(quests, lead, version)`, which returns open `ultra:send:<lead>:` quests whose version differs.

- [ ] **Step 1: Failing tests** (view):
  - The key format.
  - `sendQuestFor` finds an open quest by exact key and ignores another lead's quest.
  - `staleSendQuests` returns an open quest from an older version.
- [ ] **Step 2: Implement the card states.**
  - **Reviewed draft, no quest:** **Approve draft** mints `{title: 'Send pitch to ' + company, desc: subject + '\n\n' + body + '\n\nSend it yourself, then report this quest done with the date, channel and recipient.', contract: {type: 'attest', key}, kind: 'user', executionMode: 'commander', createdBy: 'commander'}`.
  - **Open quest for the current version:** "Send quest open — report it in Quests once you have sent it".
  - **Done:** "Sent — recorded".
  - **Stale open quests:** "An older approval exists; the draft changed since".
  - **Refusals:** a mint refusal shows its message.
- [ ] **Step 3: Browser test** (fixture with a reviewed draft): approve → the quest log contains "Send pitch to <company>".
- [ ] **Step 4:** all checks; commit `s2b t3: LEADS approves a reviewed draft into a Send pitch quest`.

### Task 4: Integration, docs, upstream and review

- [ ] **Smoke check**, "Owner quests":
  1. Mint an `ultra:send` quest over HTTP for a copied lead with a reviewed draft.
  2. `POST /api/quests/report` with 9 characters → 400, quest open.
  3. With valid evidence → 200, and the copied workbench has one `sent` event carrying the quest id.
  4. Report again → no second event.
  5. The original records are unchanged.
  6. `/api/ultra/hooks/quest-event` → 404 over HTTP.
- [ ] **Full verification:** suites, `check_station`, smoke, browsers ×3, records snapshot; the upstream fast suite on a frozen copy (the same 150).
- [ ] **Whole-branch review:** one fresh reviewer on the most capable model, then one fix pass.
- [ ] **Docs** (`docs/ops/STATION.md`): LEADS gains Approve draft → Send pitch quest → report with evidence → the contact is recorded once; agents can never complete it. Add a Stage 2b verification entry. `STATION_UPSTREAM_TESTS.md` gets the rerun line.
- [ ] **Live check, with Adem's go:** after he sends a real email himself, he reports its quest with the evidence, and the reviewer confirms one `sent` event in `data/campaign-workbench.json`.
