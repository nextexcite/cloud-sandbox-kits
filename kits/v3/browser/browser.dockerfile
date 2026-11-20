# syntax=docker/dockerfile:1
ARG BASE_IMAGE=docker.io/library/node:24-bookworm-slim
FROM ${BASE_IMAGE}
USER root
RUN printf 'Acquire::Retries "3"; Acquire::http::Timeout "30"; Acquire::https::Timeout "30";\n' > /etc/apt/apt.conf.d/80-retries \
 && usermod -l agent -d /home/agent -m node \
 && groupmod -n agent node \
 && test "$(id -u agent)" = 1000 \
 && npm install -g agent-browser@0.43.0 \
 && agent-browser install --with-deps \
 && apt-get update \
 && apt-get install -y --no-install-recommends fonts-noto-cjk fonts-noto-color-emoji fonts-liberation \
 && chrome=$(find /root/.agent-browser/browsers -type f -name chrome -executable | head -n 1) \
 && test -n "$chrome" \
 && mkdir -p /opt/chrome \
 && cp -a "$(dirname "$chrome")/." /opt/chrome/ \
 && chmod -R a+rX /opt/chrome \
 && rm -rf /root/.agent-browser /root/.cache /root/.npm /var/lib/apt/lists/* \
 && mkdir -p /home/agent/workspace \
 && chown agent:agent /home/agent/workspace
ENV HOME=/home/agent \
    AGENT_BROWSER_EXECUTABLE_PATH=/opt/chrome/chrome \
    IS_SANDBOX=1
COPY scripts/browser-smoke.mjs /usr/local/bin/browser-smoke
RUN chmod 0755 /usr/local/bin/browser-smoke
USER agent
WORKDIR /home/agent/workspace
LABEL org.opencontainers.image.source="https://github.com/nextexcite/sbx-agent-kits"
ENTRYPOINT ["/bin/bash"]
CMD ["-l"]
