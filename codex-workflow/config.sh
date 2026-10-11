# codex-workflow settings. Every value can be overridden for one command, e.g. `EFFORT=high cw run 3`.

# Model and reasoning effort. Spend xhigh where judgment matters; use less where the work is mechanical.
MODEL="${MODEL:-gpt-6.1-sol}"
EFFORT="${EFFORT:-xhigh}"                 # implementers (cw run, cw fix)
REVIEW_EFFORT="${REVIEW_EFFORT:-xhigh}"   # task reviews and the final whole-branch review
REREVIEW_EFFORT="${REREVIEW_EFFORT:-high}" # scoped re-reviews of a small fix diff

# Branches and folders (relative to the repository root).
BASE_BRANCH="${BASE_BRANCH:-}"            # empty = the branch checked out when you ran `cw init`
WORKTREE_ROOT="${WORKTREE_ROOT:-.worktrees}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-runs/codex-workflow}"   # runs/ is git-ignored in 1Ultra

# Paths symlinked from the main checkout into every worktree (large or untracked things a task needs).
LINKS=(station/node_modules)

# Files that must never change while tests run (checked by `cw verify`). Live use of the station may change them
# between runs; `cw verify` compares a snapshot taken right before and right after its own checks.
RECORDS=(data/budget.json data/campaign.json data/campaign-workbench.json data/exclusions.json data/game.json
         data/leads.json data/payments.json data/tasks.json STATE.md)

# What `cw verify` runs inside a task's worktree, in order. One shell command per entry.
PW=/home/adem/.npm/_npx/86170c4cd1c5da32/node_modules/playwright
BR=/home/adem/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome
VERIFY=(
  "node --test tests/station-*.test.cjs tests/station-ui-smoke.cjs"
  "python3 -m unittest discover -s tests"
  "python3 scripts/check_station.py"
  "python3 scripts/station_smoke.py"
  "python3 scripts/station_browser_smoke.py --starnet --playwright-module $PW --browser $BR --output runs/codex-workflow-browser"
  "python3 scripts/station_browser_smoke.py --playwright-module $PW --browser $BR --output runs/codex-workflow-browser"
  "python3 scripts/station_browser_smoke.py --agents --playwright-module $PW --browser $BR --output runs/codex-workflow-browser"
)

# Added to every commit message made by `cw commit` (leave empty for none).
COMMIT_TRAILER="${COMMIT_TRAILER:-}"
