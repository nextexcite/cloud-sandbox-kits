#!/usr/bin/env bash
# Stages the committed, self-contained v3 build context.
# Kit v3 frontend uses the descriptor's directory as the build context root.
set -euo pipefail
cd "$(dirname "$0")/.."
KIT="${1-amp}"
case "$KIT" in
  ''|*[!a-z0-9-]*) echo "Invalid kit name: $KIT" >&2; exit 2 ;;
esac
[[ -f "kits/v3/$KIT/$KIT.yaml" ]] || { echo "Unknown kit: $KIT" >&2; exit 2; }
DEST="${2:-dist/v3}"
mkdir -p "$DEST"
cp -R "kits/v3/$KIT/." "$DEST/"
echo "Staged OCI Kit v3 build context in $DEST"
