#!/usr/bin/env bash
# Root scripts are authoritative; the Git-source Kit vendors its build inputs.
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-}"
if [[ $# -gt 1 || ( -n "$mode" && "$mode" != --check ) ]]; then
  echo "usage: sync-kits.sh [--check]" >&2
  exit 2
fi
destination=kits/v3/amp/scripts
if [[ "$mode" != --check ]]; then
  mkdir -p "$destination"
fi
status=0
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
exit "$status"
