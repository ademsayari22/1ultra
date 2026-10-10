# Dungeon verification — 4 October 2026

## Behavior checked

The staged implementation passes 72 Python helper/HTTP tests and 49 desktop browser checks. Request tests and completion/gate browser flows use disposable copies; no real task, lead or payment was completed by verification.

Checks cover recursive real/confirmed prerequisites, dependency cycles and duplicate IDs, blank evidence, repeat-save XP, training separation, gate version conflicts and prerequisite revision binding. Browser flows cover character movement/zoom, locked-room inspection, navigation, search/filtering, quest completion, level changes, gate reviews, stale-edit recovery, CSV upload/download, scope forms, each of the nine services and script-result handoff into a judgment prompt. The desktop sizes checked are 1584×992 and 1366×768. No unexpected console/page errors or external interaction requests were observed.

Native configuration and saved workflow syntax/path checks accompany the installed regression suite. The installed app passed 18 additional desktop checks, including a fresh daily pack and unchanged task/payment records. Its final screenshot is dungeon-desktop.png. Installed TOML, JSON and saved workflow header checks passed.

## Independent review and resolutions

Two reviewers examined the staged source read-only: automation boundaries and game workflow semantics. Their questions required interpretation of behavior and policy beyond the deterministic checks; they were not used to perform routine calculations or generate script artifacts.

| Finding | Resolution |
|---|---|
| Duplicate lead IDs could pass exclusions through another eligible record | Every collision is flagged; outreach pairs each input with its own audit result |
| Formula-like CSV headers stayed executable | Header and cell exports are escaped and reported; original input remains unchanged |
| Unconfirmed or fictional ancestors could unlock real children | Real readiness, completion, XP and gates require a fully confirmed real chain |
| Gate evidence could become active again after changed prerequisites | Gate review records a fingerprint of its whole prerequisite evidence/revision chain |
| CSV below 60 KB could exceed the encoded JSON request limit | Only the automation route allows a bounded 400 KB request; CSV itself remains limited to 60 KB |
| Floor guide counted raw stale/training status | Guide uses the dungeon’s effective real counts and separates the recorded business phase |
| Judgment prompts lost supplied scope or CSV inputs | A selected allowlisted script run carries its report and scope/source/cleaned data into the prompt |
| Hero navigation selected a different room from its position | Inspected room and movement room are tracked separately and restored consistently |
| Record validator crashed on malformed rows | Malformed record shapes return explicit errors instead of dereferencing them |

A rendered CSP error was reproduced, then fixed by moving fixed map coordinates into CSS. The browser check confirms native overlays and no security-policy errors. A CSV-source browser assertion initially read before the asynchronous preview finished; the check now waits for the requested artifact.

## Concept and actual render

The generated complete desktop concept and the actual desktop were viewed together after the final fixes. The artwork is a dedicated dungeon asset, while text, controls, labels and counts are native UI.

| Design element | Actual implementation |
|---|---|
| Layout | Left navigation, central dungeon/camp board, right quest inspector, top HUD and bottom activity strip |
| Color | Charcoal/slate surfaces, brass/gold controls, violet cave mist and green readiness |
| Typography | Serif headings/body with small monospace IDs and script details |
| Dungeon hierarchy | Three upper and two lower rooms, native locks/labels, generated character sprite |
| Functional details | Actual task counts, evidence status and keyboard/zoom controls replace illustrative concept numbers |

## Practical limits

XP represents owner-confirmed recorded work, not money or an intelligence score. Scope/gate/payment references remain owner assertions; scripts do not authenticate bank transfers, buyer acceptance or source truth. Stored lead checks are offline and require fresh research when appropriate. Routine scripts write artifacts only and have no external sending or scheduler.

The website prepares judgment prompts only. Live Codex execution, account authentication and account-wide cost controls were not exercised. File locking coordinates one server process; use one local server and coordinate direct file edits through the owner. Record versions reject stale UI writes, but simultaneous independent filesystem writers are outside that coordination.

CSV originals, every row and ambiguous amount strings are retained. Large reports can exceed the interface’s 300 KB preview cap and remain available as local run files. No mobile version was requested or tested.

## Final fidelity ledger

Final comparison used the accepted full-desktop concept and the latest installed 1584×992 screenshot together.

| Comparison point | Concept evidence | Installed render evidence | Difference / decision |
|---|---|---|---|
| Layout and density | Full-height left rail, large central map, right inspector | Same three columns and top/bottom bands | Central map width follows native container; retained desktop density |
| Copy and truth | Illustrative “0 / 1 quests” room labels | Actual “0 / 6”, “0 / 7”, “0 / 4”, “0 / 2”, “0 / 1” counts | Intentional: real records drive labels; added movement/zoom hints explain controls |
| Typography | Serif title/body, small utility labels | Georgia serif and monospace IDs/scripts throughout | Native readable text replaces raster lettering; no image-baked controls |
| Palette | Dark slate/charcoal, gold frames/buttons, violet mist | Same surface/accent hierarchy and generated cave palette | Native status tags add green/red semantic feedback |
| Assets and icons | Dungeon rooms, pixel character, locks and stone navigation icons | Dedicated matching room art, transparent character/lock sprites, native SVG navigation | Separate native SVG controls preserve keyboard operation and legibility; sprite pose differs from the illustrative concept |
| Spacing and frames | Squared framed panels and broad gold quest buttons | Squared double borders, corner marks, full-width primary inspector button | Simplified frame texture keeps the UI readable; decorative raster edges are not used as controls |

The final map and workshop screens were inspected for hierarchy, copy visibility, native control alignment, typography and clipping. Functional checks and direct visual comparison are recorded separately.
