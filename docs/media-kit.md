# CPU media Kit

## Launch

```sh
DOCKER_SANDBOXES_KIT_ALLOWED_SOURCES='["docker.io/","dhi.io/","github.com/nextexcite/"]' \
sbx --cloud create --name media-trial --cpus 4 --memory 8g --ttl 2h \
  --kit-arg base_image=docker.io/sbx/shell-docker-image@sha256:9b301d7b1f0a573a2bbb8897c65252eacd6897a55dc7d07bea352a0baf944730 \
  'git+https://github.com/nextexcite/sbx-agent-kits.git#ref=devin/1795087529-media-kit&dir=kits/v3/media'
sbx --cloud exec media-trial media-smoke
```

## Helpers

Run inside the sandbox as `agent` (UID 1000):

```sh
media-encode input.mov output.mp4 --codec h264
media-encode input.mov output-hevc.mp4 --codec hevc
media-fetch-audio 'https://raw.githubusercontent.com/openai/whisper/86098128c0b4f24f0e2aa2994de830614b474227/tests/jfk.flac' 'jfk.%(ext)s' --format wav
media-transcribe jfk.wav --format srt > jfk.srt
media-transcribe input.mp4 --model base.en --format json > transcript.json
media-smoke --url 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
```

tiny.en and a short JFK sample are baked in for offline smoke. Other models
require network or a local directory. Transcription decodes with ffmpeg;
split long recordings to limit RAM usage. Encoding overwrites its output.

For authorized YouTube downloads, supply `--cookies FILE` / `YT_COOKIES_FILE`
and optionally `--proxy URL` / `YT_PROXY`. Never bake cookies into images.
Node and the pinned EJS solver are installed, but cloud IPs can still trigger
YouTube's “Sign in to confirm you're not a bot” check. Optional smoke downloads
report failures as WARN, not PASS. Additional sites/proxies may need scoped
network-policy allowances.

## Platform gotchas

- Git sources use `#ref=REF&dir=DIRECTORY`; quote the URL to preserve `&`.
  The process-scoped allowed-sources override above permits this publisher.
- Docker Hub can return 429 for the floating base tag. The launch command pins
  the public base digest used in the live run to avoid that tag lookup.
- No GPU is available: encoding and int8 transcription use CPU only.
- Uploaded Kits do not route credentials; this Kit has no credential capability.
  Supply cookies privately at runtime, separately from Docker platform login.
- Git-source builds can create a Cloud template. After use, remove the sandbox
  and its template (record the template ID from create output; leave unrelated
  resources alone):

  ```sh
  sbx --cloud rm --force media-trial
  sbx --cloud template ls
  sbx --cloud template rm --force TEMPLATE_ID
  ```

**Live run (2026-11-19, sbx v0.54.0, 4 vCPU/8 GiB):** create 123.56s; smoke PASS (YouTube download WARN); 30s 1080p H.264 11.534s / HEVC 19.571s; direct audio fetch 1.815s / SRT transcription 1.389s; trial sandbox/templates removed.
