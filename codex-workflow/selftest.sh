#!/usr/bin/env bash
# selftest.sh — exercises every cw command end to end in a throwaway git repository, with DRY_RUN=1 so no Codex
# call is made and no usage is spent. Prints "selftest passed" or stops at the first failure.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap '[ "${KEEP:-0}" = 1 ] || rm -rf "$T"' EXIT
export DRY_RUN=1 WAIT_POLL=1 CW_CONFIG="$T/test-config.sh"
fail() { echo "selftest FAILED: $*" >&2; exit 1; }

cd "$T" && git init -q -b main repo && cd repo
git config user.email selftest@example.invalid && git config user.name selftest
cp -r "$HERE" ./codex-workflow
cat > plan.md <<'EOF'
# Example plan

## Global Constraints

- Never touch records.

### Task 1: Add a greeting

Create hello.txt containing "hello".

### Task 2: Add a farewell

Create bye.txt containing "bye".

## Done
EOF
echo "{}" > records.json
cat > "$CW_CONFIG" <<'EOF'
LINKS=()
RECORDS=(records.json)
VERIFY=("test -f hello.txt" "true")
EOF
git add -A && git commit -qm "start"
CW=./codex-workflow/cw

$CW init plan.md | grep "task 1	Add a greeting" > /dev/null || fail "init lists tasks"
grep -q "Never touch records" runs/codex-workflow/plan/global-constraints.md || fail "constraints extracted"
$CW brief 1 > /dev/null; grep -q 'Create hello.txt' runs/codex-workflow/plan/task-1-brief.md || fail "brief"
grep -q 'bye.txt' runs/codex-workflow/plan/task-1-brief.md && fail "brief leaks task 2"

echo '- The greeting is lowercase.' > ctx.md
$CW run 1 ctx.md > /dev/null
$CW wait 1 | grep '^exit 0' > /dev/null || fail "run job"
grep -q 'The greeting is lowercase' runs/codex-workflow/plan/task-1-prompt.md || fail "context in prompt"
grep -q 'DRY RUN: codex exec' runs/codex-workflow/plan/task-1.log || fail "codex command recorded"
WT=.worktrees/plan-t1; [ -d "$WT" ] || fail "worktree created"

$CW verify 1 > /dev/null 2>&1 && fail "verify should fail before hello.txt exists"
echo hello > "$WT/hello.txt"
$CW verify 1 | grep 'PASS  records unchanged' > /dev/null || fail "verify passes"
$CW commit 1 "add hello" | grep committed > /dev/null || fail "commit"

$CW review 1 > /dev/null; $CW wait 1 review | grep '^exit 0' > /dev/null || fail "review job"
grep -q 'hello.txt' runs/codex-workflow/plan/task-1-review.diff || fail "review diff"
grep -q -- '-s read-only' runs/codex-workflow/plan/task-1-review.log || fail "review is read-only"

echo "1. Important: say hello louder." > fix.md
$CW fix 1 fix.md > /dev/null; $CW wait 1 fix | grep '^exit 0' > /dev/null || fail "fix job"
grep -q 'resume dry-run-session' runs/codex-workflow/plan/task-1-fix1.log || fail "fix resumes the implementer session"
echo HELLO > "$WT/hello.txt"; $CW commit 1 "louder" > /dev/null
$CW rereview 1 > /dev/null; $CW wait 1 rereview | grep '^exit 0' > /dev/null || fail "rereview job"
grep -q 'say hello louder' runs/codex-workflow/plan/task-1-rereview-prompt.md || fail "rereview carries the findings"
grep -q '+HELLO' runs/codex-workflow/plan/task-1-rereview.diff || fail "rereview sees only the fix"
grep -q '+hello' runs/codex-workflow/plan/task-1-rereview.diff && fail "rereview diff includes the original change"

$CW merge 1 --clean > /dev/null; [ -f hello.txt ] || fail "merge"; [ -d "$WT" ] && fail "clean removes the worktree"
$CW status | grep merged > /dev/null || fail "status shows merged"
$CW log "Ruling: keep it simple" > /dev/null; grep -q 'Ruling: keep it simple' runs/codex-workflow/plan/ledger.md || fail "log"
$CW final > /dev/null; $CW wait final | grep '^exit 0' > /dev/null || fail "final review job"
grep -q 'hello.txt' runs/codex-workflow/plan/final-review.diff || fail "final diff"
$CW help | grep 'cw run' > /dev/null || fail "help"
echo "selftest passed"
