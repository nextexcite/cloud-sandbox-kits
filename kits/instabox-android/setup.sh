#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mise_version="2026.11.12"
mise_bin="$HOME/.local/share/instabox-android/bin/mise"
mkdir -p "$(dirname "$mise_bin")"
if [[ ! -x "$mise_bin" ]] || ! "$mise_bin" --version | grep -Fq "$mise_version"; then
  temp="$(mktemp -d)"
  trap 'rm -rf "$temp"' EXIT
  base="https://github.com/jdx/mise/releases/download/v${mise_version}"
  asset="mise-v${mise_version}-linux-x64"
  curl -fsSL "$base/$asset" -o "$temp/mise"
  echo "9c12c24f5eac6b6357e5265e2629166cc3005459037f5d747680a99e375ff2ab  $temp/mise" | sha256sum -c -
  chmod +x "$temp/mise"
  install -m 755 "$temp/mise" "$mise_bin"
fi
cd "$root"
export PATH="$(dirname "$mise_bin"):$PATH"
"$mise_bin" trust "$root/mise.toml"
"$mise_bin" install --yes
"$mise_bin" exec -- just verify
