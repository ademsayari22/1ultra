#!/usr/bin/env bash
# retry.sh LOG CMD... — run one Codex command. If the ChatGPT plan's usage limit stops it ("try again at 3:58 PM"),
# wait until one minute after that time and run the same command again (at most 3 attempts). It never buys credits.
LOG="$1"; shift
rc=1
for attempt in 1 2 3; do
  "$@" < /dev/null > "$LOG" 2>&1; rc=$?
  grep -q "hit your usage limit" "$LOG" || exit $rc
  when=$(grep -o "try again at [0-9]\{1,2\}:[0-9]\{2\} \?[AP]M" "$LOG" | head -1 | sed 's/try again at //')
  { [ -n "$when" ] && [ "$attempt" != 3 ]; } || exit $rc
  target=$(date -d "today $when" +%s); now=$(date +%s)
  [ "$target" -le "$now" ] && target=$((target + 86400))
  echo "$(date '+%F %T') usage limit; waiting until $when, then retrying the same step" >> "$LOG.wait"
  while [ "$(date +%s)" -lt $((target + 60)) ]; do sleep 60; done
done
exit $rc
