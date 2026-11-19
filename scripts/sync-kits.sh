#!/usr/bin/env bash
# Root scripts are authoritative; the Git-source Kit vendors its build inputs.
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-}"
if [[ $# -gt 1 || ( -n "$mode" && "$mode" != --check ) ]]; then
  echo "usage: sync-kits.sh [--check]" >&2
  exit 2
fi
status=0
shopt -s nullglob
kits=(kits/v3/*/)
if [[ ${#kits[@]} -eq 0 ]]; then
  echo "No v3 kits found" >&2
  exit 1
fi
for kit in "${kits[@]}"; do
  [[ "${kit%/}" == kits/v3/browser ]] && continue
  destination="${kit}scripts"
  if [[ "$mode" != --check ]]; then
    mkdir -p "$destination"
  fi
  for name in install-toolchains.sh refresh-node-lts.sh verify-runtime.sh; do
    if [[ "$mode" == --check ]]; then
      if ! cmp -s "scripts/$name" "$destination/$name"; then
        echo "Drift: $destination/$name (run bash scripts/sync-kits.sh)" >&2
        status=1
      fi
    else
      cp "scripts/$name" "$destination/$name"
      chmod 0755 "$destination/$name"
    fi
  done
done
exit "$status"
