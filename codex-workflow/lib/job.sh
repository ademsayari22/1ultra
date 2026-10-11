#!/usr/bin/env bash
# job.sh STATUS LOG CMD... — run one Codex command as a background job that survives your terminal closing.
# Writes "started", then "session <id>" and "exit <code>" to STATUS when Codex finishes. With DRY_RUN=1 it only records
# the command it would have run (used by selftest.sh).
STATUS="$1"; LOG="$2"; shift 2
HERE="$(cd "$(dirname "$0")" && pwd)"
echo "started $(date '+%F %T')" > "$STATUS"
if [ "${DRY_RUN:-0}" = 1 ]; then
  { printf 'DRY RUN:'; printf ' %q' "$@"; printf '\nsession id: dry-run-session\n'; } > "$LOG"; rc=0
else
  "$HERE/retry.sh" "$LOG" "$@"; rc=$?
fi
sid=$(grep -m1 '^session id:' "$LOG" 2>/dev/null | awk '{print $3}')
[ -n "$sid" ] && echo "session $sid" >> "$STATUS"
echo "exit $rc $(date '+%F %T')" >> "$STATUS"
