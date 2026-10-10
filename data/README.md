# Real records

These JSON files are editable by the coordinator after checking actual evidence. Worker/CLI
outputs are drafts and do not update them.

- leads.json: discovered prospects/contracts/jobs, dated sources, need/contact/exclusion status.
- tasks.json: todo, in_progress, blocked, blocked_on_owner or done; real completion needs
  nonblank evidence, owner confirmation and a confirmed real dependency chain. Seeded blocked
  tasks become available when their prerequisites finish; an explicitly owner-blocked task stays blocked.
- game.json: separate owner-confirmed boss reviews, bound to prerequisite evidence versions.
  Derived XP/room clearance never establishes income, buyer acceptance or the business phase.
- payments.json: owed amounts and receipt records. Null means unknown. Amounts use integer
  minor units: 300 TND is 300000; 15 USD is 1500. Evidence references may point to private
  receipt files; merely typing a path does not independently verify the receipt. Adem checks it.
- budget.json: planning limit and timeout. A limit does not authorize purchases or guarantee
  model-usage cost enforcement.
- exclusions.json: historical company-wide user exclusions; not verified application receipts.

For payments, give each real receipt a unique ID and avoid counting the same transfer again.
Use status deposit_received for an advance with delivery/refund obligations; received for
another actual receipt; owed for the remaining receivable. Link records to the invoice/obligation
and update the outstanding amount. Earned amounts require work/acceptance evidence separately.
Keep actual costs and tax treatment distinct; the helper reports cash, not automatic profit.
Mode must be real. Fictional examples belong under simulations/ and never in this ledger.

The cash helper rejects a repeated receipt reference within the same currency. Record one actual transfer once; put its allocation across obligations in notes rather than duplicating received rows. Daily briefs put only dependency-ready tasks under next actions; a dependency marked done without completion evidence does not unlock follow-on work.

The local interface now supports versioned lead/payment/planning edits and record creation.
Lead outcomes use status_evidence, contacted_on, owner_confirmed and optional next_action /
next_action_on. Public source URLs or warm-contact source_reference values stay attributable.
Actual receipts require owner confirmation and receipt_evidence; deposits add obligation_reference.
Unknown billing fields remain null. Forms do not send anything or automatically complete quests.

Task, lead, payment and planning edits keep a history list of dated before/after snapshots in
the same atomic JSON write. Reopening a task retains historical evidence while revoking active
completion. Restoring loads previous values into a form and requires review before saving a new
revision. History does not independently authenticate owner assertions.

budget.json may include daily_minutes, daily_minutes_on and defer_billing. The daily budget
expires after its recorded Africa/Tunis date; unknown estimates are surfaced separately when
capacity is capped. defer_billing excludes F01/F02/F03 preparation from the daily queue without
changing their statuses, the payment ledger or the business phase. Adem requested this preference
on 5 October 2026. Spending authorization fields are not editable through the planning endpoint.
