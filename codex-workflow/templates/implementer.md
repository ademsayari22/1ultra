You are implementing Task {{TASK}} of a written plan, in your own git worktree.

## Read first
1. Your task brief: {{BRIEF}}
   It is your requirements. Use its exact values, texts, code and tests verbatim.
2. The plan's global constraints: {{GLOBAL}}

## What earlier work established (do not re-derive it)
{{CONTEXT}}

## Where you work
- Only inside {{WORKTREE}} (branch {{BRANCH}}).
- Do NOT commit or change git state. Leave your changes uncommitted; the owner commits after checking them.
- If your sandbox cannot run a test (no network, no sockets, no child processes), say exactly which one. Never weaken a test to make it pass. Steps marked for the owner or reviewer (smoke, browser checks, commits) are not yours to run, but do make the file edits they describe.

## How you work
1. Test first: write the failing test, run it, see it fail for the expected reason.
2. Implement the smallest change that meets the brief; run the tests until they pass.
3. Read your own diff: completeness, simplicity, tests that check real behaviour. Fix what you find.
4. Do all of it yourself: never start helper agents or reviewers.
5. If the brief contradicts the code you find (an anchor missing, a test that cannot pass as written), stop and report NEEDS_CONTEXT or BLOCKED with specifics. Do not guess.

## Report
Write the full report to {{REPORT}}: what you changed and why, the failing then passing test output, your self-review and any concerns.
Then end your reply with ONLY these lines (under 15):
Status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
Files changed: …
Tests: one line
Concerns: …
Report: {{REPORT}}
