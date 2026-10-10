# 1Ultra interface design

User request: make an interface like the Instagram post Dd7XBExRZQy for the existing 1Ultra project. The public preview was recovered from the supplied page; only the preview has been inspected, not the full video. It shows a near-black green-outlined ecosystem map with dense side rails. Build an adaptation of that visible structure, retaining truthful business records.

Surface: one local app with Ecosystem, Phases, Tasks, Leads, Finance and Runs views. Ecosystem has a pannable/zoomable SVG dependency map, role rail, selected-node inspector, activity strip and prepare-day/draft/rehearsal actions. Tasks filter/search and require evidence plus owner confirmation for completion. Leads and finance display the existing records without inventing contacts or cash. Artifacts open as plain text in a drawer. Responsive layout uses a scrollable nav, central graph and collapsible inspector.

Architecture: existing Python stdlib helper plus a loopback-only stdlib HTTP API and native HTML/CSS/ES-module components. This follows the owner's existing-tools/scripts preference without installing a product framework. Keep API, graph, views, state, icons and styling separate. No live model endpoint, background company loop, email sender, payment connector or publishing step.

API: GET /api/workspace; GET /api/artifact?path=...; POST /api/prepare; POST /api/draft with allowlisted role; POST /api/simulate with fixture scenario; POST /api/tasks/<id> with owner-provided evidence and stale-version protection. The existing agent helper runs with execute=False. POST requests require same Origin, valid loopback Host, JSON and a per-server anti-forgery token. Artifact and static-file access stay inside allowlisted project paths. Shared writes are serialized and atomic.

Data invariants: unknown amount remains unknown; real and fictional records stay distinct; only evidenced currency-separated cash counts; dependencies marked done without evidence do not unlock work. Existing real data is unchanged by interface setup and browser QA. Task editing tests use temporary fixtures.

The generated complete-screen concept supplies the implemented visual spec. The reference motivates the black/emerald map-and-rail design; this is an adaptation, not a claim of copying unseen video screens. All functional labels, graph nodes and controls stay code-native. The owner subsequently clarified that a mobile version is unnecessary; desktop is the priority for further work.

## Concept comparison

The concept and the actual 1584 × 992 desktop render were inspected side by side.

| Element | Concept | Rendered result / intentional adaptation |
|---|---|---|
| Color and typography | Near-black canvas, emerald lines, restrained glow, monospace labels | Retained throughout the map, panels and controls. |
| Frame and spacing | Full-width header, narrow left rail, central map, right inspector, activity footer | Retained with a 60 px header, 208 px rail, 352 px inspector and 100 px footer. |
| Map hierarchy | Sales pipeline, agent team, simulation and delivery clusters | Retained; seven actual project roles, task IDs and evidence-based status replace invented concept labels and dots. |
| Inspector | Selected agent, record counts, next actions and prepare button | Retained with actual 22 tasks, eight discoveries and zero receipts at verification; workflow guidance replaces the decorative inspector minimap. |
| Controls and interaction | Search, filters, zoom/fit, selectable nodes and preparation actions | Implemented as native controls; task completion opens an evidence form, and preparation creates inspectable drafts or fixtures. |
