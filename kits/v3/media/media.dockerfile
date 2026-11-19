# syntax=docker/dockerfile:1
ARG BASE_IMAGE=docker.io/sbx/shell-docker-image:latest
FROM ${BASE_IMAGE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3-venv nodejs ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/media \
 && /opt/media/bin/pip install --no-cache-dir yt-dlp==2026.10.26 faster-whisper==1.2.1 av==16.0.1 numpy==2.3.5
ENV PATH=/opt/media/bin:${PATH} HF_HOME=/opt/media/cache IS_SANDBOX=1
RUN /opt/media/bin/python -c "from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-tiny.en', revision='0d3d19a32d3338f10357c0889762bd8d64bbdeba', local_dir='/opt/media/models/tiny.en', allow_patterns=['config.json','model.bin','tokenizer.json','vocabulary.txt'])" \
 && curl -fL --retry 3 https://raw.githubusercontent.com/openai/whisper/main/tests/jfk.flac -o /opt/media/jfk.flac \
 && mkdir -p /opt/media/cache && chown -R 1000:1000 /opt/media/cache \
 && chmod -R a+rX /opt/media/models /opt/media/jfk.flac
COPY scripts/media.py /opt/media/media.py
RUN chmod 0755 /opt/media/media.py \
 && for name in media-encode media-transcribe media-fetch-audio media-smoke; do ln -s /opt/media/media.py /usr/local/bin/$name; done
USER agent
WORKDIR /home/agent/workspace
LABEL org.opencontainers.image.source="https://github.com/nextexcite/sbx-agent-kits"
ENTRYPOINT ["/bin/bash"]
CMD []
