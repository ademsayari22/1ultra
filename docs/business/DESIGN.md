# Service studio design

## Intent and scope

Create a project Adem can open in Codex to coordinate an income plan, public research, sales drafts, bounded delivery and cash tracking. Support a fictional startup rehearsal to test handoffs. This is a planning/operations workspace with a small local helper, not a registered company, a deployed product or proof of market demand.

## Approach choice

1. **Services first, then repeat work:** fastest route to test a buying need with the existing portfolio and little new spend. Human sales and checking remain necessary. Selected starting approach.
2. **Agency subcontracting:** use existing agencies' customers and sell narrow data preparation/support. Test alongside the direct route after an explainable sample; agency budgets and payment terms remain unknown.
3. **Standalone SaaS product:** broader potential distribution, with more development and acquisition uncertainty. Revisit only when at least three paid jobs reveal the same repeated workflow and buyers confirm a reason to pay for a product.

## Architecture

Markdown supplies founder context, phase plan, role workflows and templates. JSON stores real leads, tasks, budget and payments. Codex project configuration supplies native role definitions; repo skills route repeatable tasks. A Python standard-library helper reads status, prepares briefs/rehearsal inputs and optionally invokes one read-only Codex task.

Only the primary coordinator integrates real records. Workers return artifacts. Simulations write to their own run directories and never update real ledgers. Optional live results stay drafts with an owner-action list. No connector performs outbound communication or payments in the local helper.

## Helper contract

- Runtime: Python 3.10+; no required third-party Python packages.
- `status`: show counts and received-cash totals by currency; preserve unknown receivable amounts.
- `prepare`: create a unique run folder with a dated brief of priorities and blocked tasks.
- `simulate`: create a fictional scenario and role prompts; no model call, no changes to real records.
- `agent ROLE`: prepare a role prompt and command; dry by default. `--execute` uses the installed Codex CLI, one invocation with a 180-second limit, read-only sandbox, no inherited user configuration and nested agents disabled. It returns only `draft` or `simulation` results. Authentication, model availability and live network behavior require a separate live run.
- Never sum different currencies. TND monetary units use 1,000 per dinar; USD/EUR use 100. Received cash needs a real record with a receipt evidence reference. Unknown amounts are null, not zero.
- Failed, missing or malformed live output must create a failed-run record and return a failing exit status; no retry or ledger update follows it.

## Acceptance

The workspace opens with native instructions/roles/skills, clear next owner actions, phase exits and source dates. Local helper tests cover cash/simulation separation, unknowns, fractional TND, evidence requirements, dry-run behavior and failed live results. Official documentation supports the Codex conventions; live account access remains explicitly untested.

## Business decision rules

Advance phases only on evidence. A drafted proposal does not complete a sales stage; a deposit does not prove completed earnings. Repeated profitable delivery and actual demand justify a recurring offer. A synthetic buyer's approval cannot justify expansion. Use one short simulation pass to improve the real offer; stop once it produces owner questions and a checked draft.
