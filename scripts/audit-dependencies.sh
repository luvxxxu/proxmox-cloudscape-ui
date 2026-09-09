#!/usr/bin/env bash
set -euo pipefail
# Retry only unavailable audit transport, never ignore discovered vulnerabilities.
report=$(mktemp)
trap 'rm -f "$report"' EXIT
for attempt in 1 2 3; do
  if bun audit >"$report" 2>&1; then cat "$report"; exit 0; fi
  cat "$report" >&2
  if ! grep -Eq 'audit request failed|ConnectionRefused|ECONNRESET|ETIMEDOUT|ENOTFOUND' "$report"; then exit 1; fi
  [[ $attempt != 3 ]] || exit 1
  sleep "$((attempt * 5))"
done
