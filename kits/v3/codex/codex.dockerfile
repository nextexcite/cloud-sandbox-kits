# syntax=docker/dockerfile:1
ARG BASE_IMAGE=docker.io/sbx/shell-docker-image:latest
FROM ${BASE_IMAGE}
USER root
COPY scripts/install-toolchains.sh /opt/sbx-agent-kits/install-toolchains.sh
COPY scripts/refresh-node-lts.sh /usr/local/bin/refresh-node-lts
COPY scripts/verify-runtime.sh /usr/local/bin/sbx-agent-kits-verify
RUN chmod 0755 /opt/sbx-agent-kits/install-toolchains.sh /usr/local/bin/refresh-node-lts /usr/local/bin/sbx-agent-kits-verify \
 && /opt/sbx-agent-kits/install-toolchains.sh system
ENV FNM_DIR=/home/agent/.local/share/fnm \
    PATH=/home/agent/.local/bin:/home/agent/.local/share/fnm/current-bin:/home/agent/.local/npm/bin:/home/agent/.bun/bin:/home/agent/.deno/bin:${PATH} \
    AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
    SBX_AGENT_BINARY=codex \
    CODEX_HOME=/home/agent/.codex \
    GIT_TERMINAL_PROMPT=0
USER agent
RUN /opt/sbx-agent-kits/install-toolchains.sh user
ARG CODEX_VERSION=0.166.0
ARG TARGETARCH
# The complete package is required for Codex's background server, not just bin/codex.
RUN case "$TARGETARCH" in \
      amd64) target=x86_64-unknown-linux-musl ;; \
      arm64) target=aarch64-unknown-linux-musl ;; \
      *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && release="https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}" \
 && asset="codex-package-${target}.tar.gz" \
 && scratch=$(mktemp -d) \
 && cd "$scratch" \
 && curl -fsSLO "${release}/${asset}" \
 && curl -fsSLO "${release}/codex-package_SHA256SUMS" \
 && grep "  ${asset}\$" codex-package_SHA256SUMS | sha256sum -c - \
 && mkdir -p /home/agent/.local/share/codex /home/agent/.local/bin /home/agent/.codex "$scratch/state" \
 && tar -xzf "${asset}" -C /home/agent/.local/share/codex \
 && ln -sfn /home/agent/.local/share/codex/bin/codex /home/agent/.local/bin/codex \
 && cd /home/agent \
 && grep -q "\"version\": \"${CODEX_VERSION}\"" /home/agent/.local/share/codex/codex-package.json \
 && CODEX_HOME="$scratch/state" codex --version | grep -F "${CODEX_VERSION}" \
 && rm -rf "$scratch" \
 && sbx-agent-kits-verify
WORKDIR /home/agent/workspace
LABEL com.docker.sandboxes.flavor="codex"
LABEL com.docker.sandboxes.start-docker="true"
LABEL org.opencontainers.image.source="https://github.com/nextexcite/sbx-agent-kits"
ENTRYPOINT ["codex"]
CMD []
