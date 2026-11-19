# CPU media Kit: usage and Cloud acceptance

Measured 2026-11-19 on Docker Cloud Sandboxes, Linux amd64, 4 vCPU / 8 GiB,
with `sbx version v0.54.0 4bec4a5ce093466e54b034146965b143d065dc09`.
This is a single functional trial, not a performance SLA or quality comparison.
The tested Git revision was `34ab126` on `devin/1795087529-media-kit`.

## Usage

Build and test locally (no credentials required):

```sh
docker build -t media-kit:local -f kits/v3/media/media.dockerfile kits/v3/media
docker run --rm --network none --entrypoint media-smoke media-kit:local
```

The image runs as agent UID 1000. Helpers are on PATH:

```sh
media-encode input.mov output.mp4 --codec h264
media-encode input.mov output-hevc.mp4 --codec hevc
media-fetch-audio 'https://raw.githubusercontent.com/openai/whisper/main/tests/jfk.flac' 'jfk.%(ext)s' --format wav
media-transcribe jfk.wav --format srt > jfk.srt
media-transcribe input.mp4 --model base.en --format json > transcript.json
media-smoke --url 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
```

CPU only; tiny.en and a public JFK sample are baked in for offline smoke.
Other models require network or a local directory. Transcription decodes via
ffmpeg into float32 numpy samples, not native PyAV decoding. Long inputs are
held in RAM; split long recordings. Encoding overwrites its output.
YouTube can bot-check cloud IPs even with Node. For authorized downloads,
provide runtime `--cookies FILE` / `YT_COOKIES_FILE` and optionally
`--proxy URL` / `YT_PROXY`; never bake cookies into builds. Proxy hosts and
non-allowlisted media sites require additional scoped policy rules. Uploaded
Kits do not route credentials, and this Kit declares no credential capability.

## Client setup and Git-source creation

Installed the official `DockerSandboxes-linux-amd64.tar.gz` archive from
`https://github.com/docker/sbx-releases/releases/latest/download/` into a
client-only working directory. Logged in using the provisioned Docker ID
and Cloud Sandboxes PAT with `login --username ... --password-stdin`.
No secrets were printed or added to the repository/image. The client warned
that no keychain was available and its login secret would be protected by
file permissions rather than a password.

The CLI help documents the correct Git fragment as `#ref=REF&dir=DIRECTORY`.
The branch was pushed before creation. Initial creation at `fdb8e6f` used the
default public `latest` base and succeeded in **116.03 seconds** (local build
19s, sandbox creation 11s, kit application 1s, remainder upload/preparation).
That run exposed Python 3.14 argparse rejecting an unescaped `%` in the fetch
helper's output-template help: `ERROR: badly formed help string`.
Commit `34ab126` fixes the help string and adds regression coverage.

The first attempt with the fixed revision was blocked by Docker Hub, before
any sandbox was created (2.28s):

```text
unexpected status from HEAD request to https://registry-1.docker.io/v2/sbx/shell-docker-image/manifests/latest: 429 Too Many Requests
```

Retried the same Git-source Kit with its public-base argument pinned to the
exact digest already used locally; no alternate launch method or image was
substituted. Successful command (timed externally with `/usr/bin/time`):

```sh
DOCKER_SANDBOXES_KIT_ALLOWED_SOURCES='["docker.io/","dhi.io/","github.com/nextexcite/"]' \
sbx --cloud create --name media-smoke --cpus 4 --memory 8g --ttl 2h \
  --kit-arg base_image=docker.io/sbx/shell-docker-image@sha256:9b301d7b1f0a573a2bbb8897c65252eacd6897a55dc7d07bea352a0baf944730 \
  'git+https://github.com/nextexcite/sbx-agent-kits.git#ref=devin/1795087529-media-kit&dir=kits/v3/media'
```

```text
Template: tmpl_001m7stj7qwpjhw0kd2n11nt47v
Sandbox: sbx_001m7stn2zt5zakv35cnm68gewz
CREATE_SECONDS=123.56
```

The successful retry reported sandbox creation 10s and kit application 1s.
The local build used the existing machine cache; these are not cold-build
measurements. The client also warned that it could not keep the built image
in its absent local sandbox-daemon cache; upload and Cloud execution succeeded.

## Raw Cloud smoke output

Command (exit 0):

```sh
sbx --cloud exec media-smoke sh -lc 'id; nproc; media-smoke --url "https://www.youtube.com/watch?v=jNQXAC9IVRw"'
```

```text
uid=1000(agent) gid=1000(agent) groups=1000(agent),27(sudo),1001(docker)
4
PASS: lavfi source
PASS: h264
x265 [info]: HEVC encoder version 4.1+1-1d117be
x265 [info]: build info [Linux][GCC 15.2.0][64 bit] 8bit+10bit+12bit
x265 [info]: using cpu capabilities: MMX2 SSE2Fast LZCNT SSSE3 SSE4.2 AVX FMA3 BMI2 AVX2
x265 [info]: Main profile, Level-2 (Main tier)
x265 [info]: Thread pool created using 4 threads
x265 [info]: Slices                              : 1
x265 [info]: frame threads / pool features       : 2 / wpp(3 rows)
x265 [warning]: Source height < 720p; disabling lookahead-slices
x265 [info]: Coding QT: max CU size, min CU size : 64 / 8
x265 [info]: Residual QT: max TU size, max depth : 32 / 1 inter / 1 intra
x265 [info]: ME / range / subpel / merge         : hex / 57 / 2 / 2
x265 [info]: Keyframe min / max / scenecut / bias  : 24 / 250 / 40 / 5.00
x265 [info]: Lookahead / bframes / badapt        : 15 / 4 / 0
x265 [info]: b-pyramid / weightp / weightb       : 1 / 1 / 0
x265 [info]: References / ref-limit  cu / depth  : 3 / on / on
x265 [info]: AQ: mode / str / qg-size / cu-tree  : 2 / 1.0 / 32 / 1
x265 [info]: Rate Control / qCompress            : CRF-28.0 / 0.60
x265 [info]: tools: rd=2 psy-rd=2.00 rskip mode=1 signhide tmvp fast-intra
x265 [info]: tools: strong-intra-smoothing deblock sao
x265 [info]: frame I:      1, Avg QP:27.92  kb/s: 595.01
x265 [info]: frame P:      5, Avg QP:29.68  kb/s: 304.78
x265 [info]: frame B:     18, Avg QP:34.84  kb/s: 92.35
x265 [info]: Weighted P-Frames: Y:0.0% UV:0.0%

encoded 24 frames in 0.10s (232.59 fps), 157.55 kb/s, Avg QP:33.48
PASS: hevc
And so, my fellow Americans ask not what your country can do for you ask what you can do for your country.
PASS: offline tiny.en transcription
2026.10.26
PASS: yt-dlp version
[youtube] Extracting URL: https://www.youtube.com/watch?v=jNQXAC9IVRw
[youtube] jNQXAC9IVRw: Downloading webpage
[youtube] jNQXAC9IVRw: Downloading tv samsung player API JSON
[youtube] jNQXAC9IVRw: Downloading visionos player API JSON
WARNING: [youtube] No title found in player responses; falling back to title from initial data. Other metadata may also be missing
ERROR: [youtube] jNQXAC9IVRw: Sign in to confirm you’re not a bot. This helps protect our community. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies. Also see  https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies  for tips on effectively exporting YouTube cookies
Audio retrieval failed. YouTube often bot-checks cloud IPs; supply an authorized cookies file with --cookies / YT_COOKIES_FILE and optionally --proxy / YT_PROXY. A JS runtime alone does not resolve bot checks.
WARN: optional download failed (including possible cloud-IP bot check)
```

YouTube retrieval failed as expected; no cookies or proxy were supplied.
This is not evidence of a successful YouTube download. The default model
check sets `HF_HUB_OFFLINE=1`; local image smoke additionally passed with
Docker `--network none` before this Cloud trial.

## Realistic workload

Generated 30 seconds of 1920×1080, 30 fps video plus a 440 Hz / 48 kHz sine
audio track, then encoded sequentially. A client-copied Python wrapper used
`time.monotonic()` around each subprocess. `/usr/bin/time` was absent in the
image, so an initial command failed before generation; no packages or image
changes were needed for timing. Smoke and generation were dispatched close
together, so their execution may have overlapped; this is not an isolated
benchmark. All workload commands below completed with exit 0:

```sh
ffmpeg -v error -nostdin -y -f lavfi -i testsrc2=size=1920x1080:rate=30 \
  -f lavfi -i sine=frequency=440:sample_rate=48000 -t 30 \
  -c:v libx264 -preset ultrafast -crf 18 -threads "$(nproc)" -c:a aac source.mp4
media-encode source.mp4 h264.mp4 --codec h264
media-encode source.mp4 hevc.mp4 --codec hevc
media-fetch-audio 'https://raw.githubusercontent.com/openai/whisper/main/tests/jfk.flac' 'jfk.%(ext)s' --format wav
media-transcribe jfk.wav --format srt
```

```text
GENERATE_SECONDS=3.126
H264_SECONDS=11.534
PROBE=h264.mp4
stream|codec_name=h264|width=1920|height=1080|duration=30.000000|nb_frames=900
stream|codec_name=aac|duration=30.016000|nb_frames=1408
HEVC_SECONDS=19.571
PROBE=hevc.mp4
stream|codec_name=hevc|width=1920|height=1080|duration=30.000000|nb_frames=900
stream|codec_name=aac|duration=30.016000|nb_frames=1408
FETCH_SECONDS=1.815
1
00:00:00,000 --> 00:00:08,000
And so, my fellow Americans ask not what your country can do for you

2
00:00:08,000 --> 00:00:11,000
ask what you can do for your country.

TRANSCRIBE_SECONDS=1.389
```

yt-dlp's generic extractor successfully downloaded the 1.10 MiB public
`jfk.flac` and ffmpeg converted it to `jfk.wav`; the transcript above came
from that downloaded WAV, not from YouTube or the baked sample. Both video
codecs retained 900 frames and AAC audio, verified with ffprobe. Helper
defaults use fast presets, H.264 CRF 23 and HEVC CRF 28; this is not an
equal-quality codec comparison.

## Policy and cleanup

`sbx --cloud policy ls media-smoke` showed default deny-all and the Kit's
declared Hugging Face, PyPI, GitHub and YouTube/CDN allows.
`sbx --cloud policy log media-smoke` returned:

```text
No policy log entries found
```

No blocked entries were reported; this alone does not establish enforcement
for every destination. No account-wide policy was changed.

Removed the initial failed-smoke sandbox and its auto-created template
`tmpl_001m7stczkzf3zf42f2r5xg8hhb` before retrying. After the successful trial:

```text
Removed sandbox media-smoke
Removed template kit3src-media-b497cc15e2d7-linux-amd64-4c8192m (tmpl_001m7stj7qwpjhw0kd2n11nt47v)
```

Final `sbx --cloud ls`:

```text
SANDBOX                         AGENT   ID                                STATUS      PORTS   WORKSPACE   CREATED
shell/amp-factory               shell   sbx_001m4hg9m677jx1bpkeh39fdq5b   ○ stopped           -           1mo
sbx-builder-probe-41968811708           sbx_001m6mzwgmknrgme82415ce9btv   ○ stopped           -           2w
```

Final `sbx --cloud template ls`:

```text
No cloud templates found
```

The two pre-existing stopped sandboxes were left untouched. No trial Cloud
resources remain. Client logs/scripts remain in `/home/ubuntu/media-live/`;
that directory is not committed and is not a portable test prerequisite.
