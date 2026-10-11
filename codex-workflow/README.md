# Codex workflow

`cw` runs Codex (`gpt-6.1-sol`) through a written plan the way a lead runs a small team:
- one task at a time, each in its own git worktree;
- you check every result yourself before it is committed;
- a separate read-only Codex reviews each task;
- fixes go back to the same Codex session that wrote the code;
- one final review covers the whole branch.

The objective is efficiency: more finished, correct work from each Codex run and each hour of your ChatGPT allowance. Codex spends its effort on the code, while plain scripts and your own checks do everything that needs no model.

This is the workflow that built 1Ultra's Stage 1a, 1b, 2 and 2c.

## Why it makes Codex efficient

1. **A brief, not the whole plan.** Codex reads only its task's section and the plan's global constraints, never the full plan or the session history. Less to read means fewer tokens and less drift.
2. **Exact values in the plan.** When the plan already contains the code, texts and tests, Codex transcribes and tests instead of designing. That takes fewer turns and makes fewer mistakes.
3. **A short context note per task.** Three to six lines of what earlier tasks produced: a function name, an anchor that occurs once, a decision already made. They stop Codex from re-exploring the repository.
4. **Codex never waits on things a script can do.** Its sandbox has no network or sockets. It runs the fast unit tests; `cw verify` runs the slow ones on your machine (smoke, browsers, record checks) at no Codex cost.
5. **Fixes resume the same session.** `cw fix` continues the implementer's own Codex session. It already knows the code it wrote, so the fix is short.
6. **The reviewer reads the change in one file.** Commits, file list and full diff are packaged once, so the reviewer reads instead of exploring git.
7. **Re-reviews are scoped and cheaper.** `cw rereview` sends only the fix diff and the list of findings, at a lower effort (`high`) than the first review (`xhigh`).
8. **Effort where it matters.** Use `xhigh` for design-heavy tasks, task reviews and the final review. Use `EFFORT=high cw run 3` or `EFFORT=medium cw run 3` for mechanical tasks, such as renames, data files or small UI text.
9. **Never lose a run.** Jobs run detached: closing the terminal or a crashed shell does not kill Codex. When the plan's usage limit stops a run, `cw` reads the reset time from the error, waits until a minute after it and reruns the same step. It never buys credits.
10. **Decisions are written down once.** `cw log "Ruling: …"` keeps every decision in the ledger, so nobody (you, Codex or another assistant) re-litigates it later.

## Requirements

- The Codex CLI, signed in with your ChatGPT account (`codex --version`).
- `git` 2.31+ and Python 3.
- A plan in markdown with `### Task N: title` sections and, ideally, a `## Global Constraints` section (see "Writing a plan" below).

## Quick start

From anywhere inside the 1Ultra repository:

```bash
alias cw=/home/adem/1ultra/codex-workflow/cw     # or add codex-workflow/ to your PATH

cw init docs/superpowers/plans/my-plan.md        # pick the plan; the current branch becomes the base branch
cw run 1                                         # Codex implements task 1 in .worktrees/<plan>-t1 (background)
cw wait 1                                        # wait, then print Codex's short status
cw verify 1                                      # you run every check (tests, smoke, browsers, records)
cw commit 1 "t1: what the task delivers"
cw review 1 && cw wait 1 review                  # read-only Codex review of the task
# Findings? Write fix.md (one ruling per finding), then:
cw fix 1 fix.md && cw wait 1 fix
cw verify 1 && cw commit 1 "t1: fix review findings"
cw rereview 1 && cw wait 1 rereview              # checks only the fix, against your rulings
cw merge 1 --push --clean                        # fast-forward into the base branch, push, remove the worktree
cw run 2                                         # next task starts from the merged code
# … all tasks done:
cw final && cw wait final                        # whole-branch review
```

## Commands

```
cw init <plan.md>              choose the plan; record the base branch; extract its global constraints
cw status                      every task with its last job states, and whether it is merged
cw brief <N>                   write task N's brief (its plan section) and print the path
cw run <N> [context.md]        start the implementer for task N in its own worktree (background job);
                               without a context file it uses <workspace>/task-N-context.md when present
cw wait <N|final> [kind]       wait for a job and print its result; kind = run (default), review, fix, rereview
cw verify <N>                  run config.sh's VERIFY checks in the task's worktree and confirm records are unchanged
cw commit <N> "message"        commit everything in the task's worktree
cw review <N>                  read-only Codex review of the task's commits (whole task)
cw fix <N> <fix.md>            resume the implementer's session with your fix instructions
cw rereview <N> [findings.md]  read-only check of the fix commits against the findings (default: the last fix file)
cw merge <N> [--push] [--clean]  fast-forward the base branch to the task; optionally push and remove the worktree
cw final                       read-only whole-branch review from the plan's start to the base branch head
cw log "text"                  append a line (a ruling, a note) to the plan's ledger
cw help                        this list
```

## The loop, step by step

| Step | Who | What happens | Files (in `runs/codex-workflow/<plan>/`) |
|---|---|---|---|
| `cw run N` | Codex (`workspace-write`) | Test first, implement, self-review. It never commits. | `task-N-prompt.md`, `task-N-report.md` (full), `task-N-final.md` (short status), `task-N.log`, `task-N.status` |
| Read the status | You | `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT` (answer it with `cw fix N answer.md`) or `BLOCKED` (the plan is wrong: change it) | |
| `cw verify N` | You (scripts) | Every check in `VERIFY`; record snapshot before and after | `task-N-verify.log` |
| `cw commit N` | You | Commit in the worktree | |
| `cw review N` | Codex (`read-only`) | Spec compliance and quality; Critical, Important and Minor findings | `task-N-review.diff`, `task-N-review.md` |
| Rule on findings | You | Decide each fix (or reject a finding with a reason); `cw log "Ruling: …"` | `ledger.md` |
| `cw fix N fix.md` | Codex (same session) | Fixes with tests | `task-N-fixK-final.md` |
| `cw rereview N` | Codex (`read-only`, `high`) | Each finding ADDRESSED or NOT, plus any new breakage | `task-N-rereview.md` |
| `cw merge N` | You | Fast-forward, push and clean | |

A finding that comes from the plan's own text is marked "plan-mandated". The plan was wrong there, so you decide the correction.

## Writing a plan Codex can execute cheaply

- One `### Task N: title` section per task. Each task ends with something testable and is small enough for one review.
- Put the exact values in the task: file paths, function names, texts, JSON and the tests to write (verbatim). Exact values are what make a run short.
- Name the anchors for any edit of code you do not own (`"the line X, which occurs once"`).
- Add an **Interfaces** block: what this task uses from earlier tasks and what it produces for later ones.
- Put project-wide rules in `## Global Constraints`: where Codex may work, what it must never touch, and how tests are run.
- Before `cw run N`, write `runs/codex-workflow/<plan>/task-N-context.md` with 3–6 lines of facts from earlier tasks.

## Rulings and the ledger

Write each decision as: `Ruling: <what you decided> — <why> — <what it costs if wrong>`, for example:

```bash
cw log "Ruling: crew contacts reach models as a channel label only — privacy — Sales sees the channel, not the address"
```

A fix file is just numbered findings with your ruling under each. `cw rereview` checks exactly those.

## Usage limits and long runs

- Every Codex job runs through `lib/retry.sh`. On "You've hit your usage limit … try again at 3:58 PM" it waits until 3:59 and reruns the same step, up to 3 attempts. The wait is logged in `<job>.log.wait`, and `cw wait` shows it.
- Jobs are detached (`setsid`), so you can close the terminal. `cw status` and `cw wait` pick them up again.
- Run one implementer at a time: two editing the same code conflict. A review can run while you verify another task.

## Settings

`config.sh`:
- **Model:** `MODEL` (`gpt-6.1-sol`).
- **Effort:** `EFFORT`, `REVIEW_EFFORT` and `REREVIEW_EFFORT` (`xhigh`, `xhigh`, `high`). Any of them can be overridden per command: `EFFORT=medium cw run 4`.
- **Branches and folders:** `BASE_BRANCH` (empty = the branch you were on at `cw init`), `WORKTREE_ROOT` (`.worktrees`), `WORKSPACE_ROOT` (`runs/codex-workflow`, git-ignored).
- **`LINKS`:** paths symlinked from the main checkout into each worktree (1Ultra: `station/node_modules`).
- **`RECORDS`:** files that must not change while checks run (1Ultra's `data/*.json` and `STATE.md`).
- **`VERIFY`:** the checks `cw verify` runs: 1Ultra's Node and Python suites, `check_station`, the smoke test and the three browser journeys.
- **`COMMIT_TRAILER`:** a line added to every commit message.

For another project, put overrides in a second file and point `CW_CONFIG` at it: `CW_CONFIG=~/other-project.cw.sh cw run 1`.

## Safety

- Codex never commits, pushes or merges; you do, after `cw verify`.
- Implementers can write only inside their worktree and the plan's workspace folder. Reviewers are read-only.
- Nothing here sends anything outside your machine except Codex itself (your ChatGPT account) and `cw merge --push` (your own git remote).
- `cw` never buys Codex credits. A usage limit means waiting for the reset.

## Troubleshooting

- **A job seems stuck:** run `cw status` or `tail runs/codex-workflow/<plan>/<job>.log`. A `.log.wait` file means it is waiting for a usage reset.
- **`cw fix` says no session:** the implementer never started properly. Check `task-N.log`, then run `cw run N` again; it reuses the worktree.
- **`cw merge` cannot fast-forward:** the base branch moved. Rebase the task branch (`git -C .worktrees/<plan>-tN rebase <base>`), re-verify, then merge.
- **Test it without spending usage:** `codex-workflow/selftest.sh` runs every command in a throwaway repository with `DRY_RUN=1`.
