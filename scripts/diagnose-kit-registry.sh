#!/usr/bin/env bash
# Read-only resolution checks. No login, build, publish or sandbox operations.
# Usage: diagnose-kit-registry.sh REFERENCE
#        diagnose-kit-registry.sh --compare PRIVATE_REFERENCE PUBLIC_CONTROL
# Labels describe caller-selected roles, not independently verified visibility.
# Each probe gets 15 seconds + 1 second kill grace by default; four probes in
# comparison mode. Override REGISTRY_PROBE_TIMEOUT_SECONDS with 1..60 seconds.
# Raw CLI output is discarded, never printed or retained. Exit statuses alone
# cannot distinguish authentication failures from absent tags/network failures.
set +x
set -euo pipefail

for cli in docker sbx python3; do
  command -v "$cli" >/dev/null || { echo "Required diagnostic CLI unavailable: $cli" >&2; exit 2; }
done
seconds="${REGISTRY_PROBE_TIMEOUT_SECONDS:-15}"
if [[ ! "$seconds" =~ ^([1-9]|[1-5][0-9]|60)$ ]]; then
  echo "REGISTRY_PROBE_TIMEOUT_SECONDS must be an integer from 1 to 60." >&2
  exit 2
fi
roles=(target)
refs=("${1:-}")
if [[ "${1:-}" == --compare && "$#" == 3 ]]; then
  roles=(private public)
  refs=("$2" "$3")
elif [[ "$#" != 1 || "${1:-}" == --* ]]; then
  echo "Usage: diagnose-kit-registry.sh REFERENCE or --compare PRIVATE_REFERENCE PUBLIC_CONTROL" >&2
  exit 2
fi
for ref in "${refs[@]}"; do
  if [[ ! "$ref" =~ ^[A-Za-z0-9][A-Za-z0-9._/:@-]*$ ]]; then
    echo "Invalid image reference; diagnostic not run." >&2
    exit 2
  fi
done

wrapper="${BASH_SOURCE[0]%/*}/probe-with-timeout.py"
status=0
cancel_probe() {
  cancellation_signal="$1"
  cancellation_code="$2"
  [[ -n "$wrapper_pid" ]] || return 0
  trap '' INT TERM
  kill -s "$cancellation_signal" "$wrapper_pid" 2>/dev/null || true
  wait "$wrapper_pid" || true
  printf '%s %s INTERRUPTED\n' "$role" "$resolver"
  exit "$cancellation_code"
}
probe() {
  local role="$1" resolver="$2" code=0 wrapper_pid= cancellation_signal= cancellation_code=
  shift 2
  trap 'cancel_probe INT 130' INT
  trap 'cancel_probe TERM 143' TERM
  # Kill the process group even if its launcher exits before its helpers.
  python3 "$wrapper" "$seconds" "$@" >/dev/null 2>&1 &
  wrapper_pid=$!
  if [[ -n "$cancellation_signal" ]]; then
    cancel_probe "$cancellation_signal" "$cancellation_code"
  fi
  wait "$wrapper_pid" || code=$?
  trap - INT TERM
  case "$code" in
    0) printf '%s %s PASS\n' "$role" "$resolver" ;;
    130|143) printf '%s %s INTERRUPTED\n' "$role" "$resolver"; exit "$code" ;;
    124) printf '%s %s TIMEOUT\n' "$role" "$resolver"; status=1 ;;
    *) printf '%s %s FAIL exit=%s\n' "$role" "$resolver" "$code"; status=1 ;;
  esac
}
for index in "${!refs[@]}"; do
  probe "${roles[$index]}" docker docker buildx imagetools inspect "${refs[$index]}"
  probe "${roles[$index]}" sbx sbx kit inspect "${refs[$index]}"
done
echo "Read-only resolver checks finished; no build or sandbox lifecycle commands invoked."
exit "$status"
