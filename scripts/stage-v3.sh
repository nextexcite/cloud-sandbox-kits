#!/usr/bin/env bash
# Stages the committed, self-contained v3 build context.
# Kit v3 frontend uses the descriptor's directory as the build context root.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="${1:-dist/v3}"
mkdir -p "$DEST"
cp -R kits/v3/amp/. "$DEST/"
echo "Staged OCI Kit v3 build context in $DEST"
