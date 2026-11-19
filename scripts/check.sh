#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for script in scripts/*.sh; do bash -n "$script"; done
python3 -c "import ast; from pathlib import Path; ast.parse(Path('kits/v3/media/scripts/media.py').read_text())"
python3 -m unittest discover -s tests -v
