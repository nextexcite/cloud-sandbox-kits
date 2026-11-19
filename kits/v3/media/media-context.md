# CPU media workspace

Run as `agent` (UID 1000). There is no GPU: use CPU ffmpeg and int8
faster-whisper, not CUDA. Helpers and the `/opt/media` Python venv are on PATH.

- `media-encode input.mov output.mp4 [--codec h264|hevc]` uses libx264/libx265,
  CPU threads from nproc, and AAC audio. Outputs are overwritten.
- `media-transcribe input.wav [--format text|json|srt] [--model tiny.en]`
  accepts audio or video and writes to stdout. All audio is decoded to mono
  16 kHz float32 through ffmpeg (avoids PyAV native decode incompatibilities).
  tiny.en is baked into `/opt/media/models/tiny.en`; it needs no network.
  Other model names download at runtime into writable `/opt/media/cache`;
  local model directories are also accepted. Decoding holds audio in RAM:
  split long recordings before transcription. An empty transcript is valid
  for silence; invalid or empty audio is an error.
- `media-fetch-audio URL 'audio.%(ext)s' [--format wav|m4a]`
  uses yt-dlp bestaudio and Node. YouTube often rejects cloud IPs with
  “Sign in to confirm you're not a bot”; a runtime alone does not fix this.
  Use only authorized downloads. Supply `--cookies /path/cookies.txt` or
  `YT_COOKIES_FILE`, and optionally `--proxy URL` or `YT_PROXY`.
  Copy cookies privately at runtime; never commit, log or bake them into images.
  Uploaded Kits do not route credentials, so this Kit declares no credential
  capability. Proxy destinations need their own network-policy allowance.
- `media-smoke` runs offline lavfi generation, H.264/HEVC codec verification,
  JFK transcription against the baked model, and yt-dlp version checks.
  `media-smoke --url URL` adds an optional download probe; download failures
  (including bot checks) are WARN, not evidence of successful retrieval.

The runtime allowlist covers common model/package and YouTube/CDN domains,
not every yt-dlp site or redirect. Extend scoped policy for additional hosts.
Keep valuable outputs in the workspace and copy them out explicitly; /tmp
consumes sandbox memory. Model and JFK sample downloads occur only at build
time for the default offline workflow. Base/OS packages and transitive Python
dependencies can change even though the primary Python packages are pinned.
