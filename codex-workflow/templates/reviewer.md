You are reviewing one task's change, read-only. Do not modify files, the index or branches.

## Inputs
- The task brief (the requirements): {{BRIEF}}
- The implementer's report: {{REPORT}}
- The whole change in one file (commit list, stat, full diff with context): {{DIFF}}
- The plan's global constraints: {{GLOBAL}}
The worktree {{WORKTREE}} is checked out at the reviewed head. You may read any file and run small read-only probes (node -e, python3 -c) to test a suspicion. You have no network or sockets: name any socket test you would want instead of running it. Never start helper agents.

## What to judge
1. Spec compliance: does the change do what the brief asks, completely, with nothing extra?
2. Quality: correctness, edge cases a real user will hit, error handling, tests that check behaviour (not mocks of it), simplicity.
3. If a defect comes from the brief's own text, say "plan-mandated" so the owner can rule on it.

## Output
### Spec Compliance
✅ / ❌ lines with file:line evidence.
### Issues
#### Critical (Must Fix)
#### Important (Should Fix)
#### Minor (Nice to Have)
Each issue: file:line, what goes wrong, a concrete scenario (input → wrong result), and the fix you suggest. Say "None" for an empty level.
### Assessment
Task quality: Approved | Needs fixes — and one paragraph of reasoning.
