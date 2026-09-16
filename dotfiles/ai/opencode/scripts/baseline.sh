#!/usr/bin/env bash
# baseline.sh — week-0 calibration. Answers: would a 500-line threshold ever fire here?
# Route: ~/.config/opencode/scripts/baseline.sh
# Usage: ./baseline.sh [repo-path] [threshold]
set -euo pipefail

REPO="${1:-.}"
THRESHOLD="${2:-${DESVIO_MIN_LINES_GO:-${DESVIO_MIN_LINES:-200}}}"
cd "$REPO"

echo
echo "desvio baseline — $(pwd)  threshold=${THRESHOLD}"
echo

if command -v fd >/dev/null 2>&1; then
  FIND_GO=(fd -e go -E vendor -E 'node_modules' -E '*_gen.go' -E '*.pb.go' -E 'mock_*.go')
else
  # rg --files respects .gitignore and is available wherever ripgrep is
  FIND_GO=(rg --files -g '*.go' -g '!vendor/**' -g '!node_modules/**' -g '!**/*_gen.go' -g '!**/*.pb.go' -g '!**/mock_*.go')
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
"${FIND_GO[@]}" | xargs -r wc -l 2>/dev/null | awk '$2 != "total" {print $1}' | sort -n > "$TMP"

N=$(wc -l < "$TMP" | tr -d ' ')
if [ "$N" -eq 0 ]; then echo "No hand-written Go files found."; exit 0; fi

pct() { awk -v n="$N" -v p="$1" 'NR == int(n*p/100)+0 {print $1; exit}' "$TMP"; }
OVER=$(awk -v t="$THRESHOLD" '$1 > t {c++} END {print c+0}' "$TMP")
TOTAL_LINES=$(awk '{s+=$1} END {print s}' "$TMP")

printf "files                 %s\n" "$N"
printf "total lines           %s\n" "$TOTAL_LINES"
printf "p50 / p90 / p99       %s / %s / %s\n" "$(pct 50)" "$(pct 90)" "$(pct 99)"
printf "max                   %s\n" "$(tail -1 "$TMP")"
printf "over threshold        %s  (%.1f%%)\n" "$OVER" "$(awk -v o="$OVER" -v n="$N" 'BEGIN{print 100*o/n}')"
echo

awk -v o="$OVER" -v n="$N" 'BEGIN {
  share = 100*o/n
  if (share < 5)       print "VERDICT: low coverage. Consider ~p90 if real tasks seldom encounter the guard."
  else if (share < 15) print "VERDICT: workable. Expect the block a few times a day."
  else                 print "VERDICT: plenty of candidates. Watch latency complaints more than savings."
}'
echo
echo "Next: record your week-0 spend from https://opencode.ai/auth before enabling desvio,"
echo "      and compare matching tasks with DESVIO_ENABLED=0 and 1; logging stays active."
echo
