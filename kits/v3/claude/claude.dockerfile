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
    SBX_AGENT_BINARY=claude \
    DISABLE_TELEMETRY=1 \
    DISABLE_ERROR_REPORTING=1
USER agent
RUN /opt/sbx-agent-kits/install-toolchains.sh user
ARG CLAUDE_VERSION=2.1.316
ARG TARGETARCH
# Fetch the native release directly, avoiding the installer's QEMU-hostile wiring step.
RUN case "$TARGETARCH" in \
      amd64) platform=linux-x64 ;; \
      arm64) platform=linux-arm64 ;; \
      *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && mkdir -p /home/agent/.local/share/claude/versions /home/agent/.local/bin \
 && curl -fsSL "https://downloads.claude.ai/claude-code-releases/${CLAUDE_VERSION}/${platform}/claude" \
      -o "/home/agent/.local/share/claude/versions/${CLAUDE_VERSION}" \
 && chmod 0755 "/home/agent/.local/share/claude/versions/${CLAUDE_VERSION}" \
 && ln -sfn "/home/agent/.local/share/claude/versions/${CLAUDE_VERSION}" /home/agent/.local/bin/claude \
 && claude --version | grep -F "${CLAUDE_VERSION}" \
 && sbx-agent-kits-verify
WORKDIR /home/agent/workspace
LABEL com.docker.sandboxes.flavor="claude"
LABEL com.docker.sandboxes.start-docker="true"
LABEL org.opencontainers.image.source="https://github.com/nextexcite/sbx-agent-kits"
ENTRYPOINT ["claude"]
CMD []
