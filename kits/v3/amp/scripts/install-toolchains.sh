#!/usr/bin/env bash
# Shared implementation for the v2 runtime image and v3 OCI workload image.
set -euo pipefail
mode="${1:?usage: install-toolchains.sh system|user}"
case "$mode" in
  system)
    [[ "$(id -u)" -eq 0 ]] || { echo "system mode requires root" >&2; exit 1; }
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    . /etc/os-release
    browser_packages=()
    # Ubuntu's Chromium package is a Snap launcher, not a container browser.
    if [[ "$ID" != ubuntu ]]; then
      browser_packages+=(chromium)
    fi
    apt-get install -y --no-install-recommends \
      bash ca-certificates curl git gh jq openssh-client \
      build-essential make pkg-config python3 python3-venv \
      unzip zip xz-utils tar sudo "${browser_packages[@]}"
    rm -rf /var/lib/apt/lists/*
    ;;
  user)
    [[ "$(id -u)" -eq 1000 ]] || { echo "user mode must run as agent uid=1000" >&2; exit 1; }
    mkdir -p "$HOME/.local/bin" "$HOME/.local/npm/bin" "$HOME/.config"
    export FNM_DIR="${FNM_DIR:-$HOME/.local/share/fnm}"
    export PATH="$HOME/.local/bin:$HOME/.local/share/fnm/current-bin:$HOME/.local/npm/bin:$PATH"
    # The standard fnm installer includes --install-dir and --skip-shell.
    curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir "$HOME/.local/bin" --skip-shell
    /usr/local/bin/refresh-node-lts
    # Shared user-owned npm prefix, independent of a particular fnm Node version.
    npm config set prefix "$HOME/.local/npm" --location=user
    npm install --global --no-fund --no-audit \
      pnpm @mariozechner/pi-coding-agent agent-browser skills
    . /etc/os-release
    if [[ "$ID" == ubuntu ]]; then
      npx --yes playwright install --with-deps chromium
      browser="$(find "$HOME/.cache/ms-playwright" -path '*/chrome-linux*/chrome' -type f | sort | tail -n 1)"
      test -n "$browser" && test -x "$browser"
      sudo ln -sfn "$browser" /usr/bin/chromium
    fi
    curl -fsSL https://mise.run | env MISE_INSTALL_PATH="$HOME/.local/bin/mise" sh
    curl -LsSf https://astral.sh/uv/install.sh | env UV_UNMANAGED_INSTALL="$HOME/.local/bin" sh
    export BUN_INSTALL="$HOME/.bun"
    curl -fsSL https://bun.sh/install | bash
    export DENO_INSTALL="$HOME/.deno"
    curl -fsSL https://deno.land/install.sh | sh
    curl -fsSL https://ampcode.com/install.sh | bash
    # Agent and interactive bash shells can select project Node versions via fnm.
    if ! grep -Fq 'fnm env --shell bash --use-on-cd' "$HOME/.bashrc" 2>/dev/null; then
      printf '\n# sbx-agent-kits: fnm managed Node versions\neval "$(fnm env --shell bash --use-on-cd)"\n' >> "$HOME/.bashrc"
    fi
    /usr/local/bin/sbx-agent-kits-verify
    ;;
  *) echo "Unknown install mode: $mode" >&2; exit 2 ;;
esac
