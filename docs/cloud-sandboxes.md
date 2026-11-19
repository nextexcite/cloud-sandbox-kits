# Docker Cloud Sandboxes: general-purpose workload trial

Measured 2026-11-19 with `sbx v0.54.0` from an Ubuntu 22.04 amd64 client.
These are short, single-run smoke/performance trials, not production SLAs or
a controlled E2B comparison. Commands use `sbx --cloud`, not local sandboxes.
Cloud execution does not require host KVM or Docker; building a Git-source Kit
did use the client's Docker Buildx. Official client support starts at Ubuntu 24.04.

## Fit verdicts

| Workload | Actual result | Verdict |
| --- | --- | --- |
| CPU video encoding | 60s, 1920x1080, 30fps (1,800 frames): small H.264 43.94s / 41.0fps / 1.37x; large 16.66s / 108.0fps / 3.60x. HEVC: small 73.33s / 24.5fps / 0.82x; large 29.36s / 61.3fps / 2.04x. | Good CPU batch fit. Large was 2.64x/2.50x faster, not 4x despite 4x vCPU. No GPU devices found. |
| YouTube audio retrieval | yt-dlp 2026.10.26 rejected `jNQXAC9IVRw`: “Sign in to confirm you're not a bot”, 1.10s; adding Node JS runtime still failed, 1.29s. | Not reliable unauthenticated from this cloud IP. HTTP 200 on youtube.com is not download success. |
| CPU transcription | Separate public JFK sample, **not YouTube output**: 11.0s audio, tiny.en/int8/8 threads, 0.624s decode+transcription (17.6x realtime), 0.493s cached model load, 1.117s total. | Good CPU fit for available audio. Cold download not timed; tiny.en accuracy not evaluated. Latest PyAV needed a decode workaround. |
| Browser automation | agent-browser 0.43.0 + Chrome 158: npm install 1.28s, browser download/install 2.90s, first successful open 0.64s; snapshot, screenshot and file download passed. | Good headless fit; install shared libraries and fonts. Screenshot showed missing CJK glyphs. No anti-bot-site compatibility claim. |
| Amp runner / orb | Repo v3 Amp Kit created in 504.72s including cold local build + upload/preparation; amp 0.0.1795075234-g7a71f0 and sbx-agent-kits-verify passed inside; Docker server 29.10.0 available. | Good install/runtime viability; cold custom Kit provisioning is much slower than a public image. No model execution: no AMP_API_KEY. Orb itself was not supplied or tested. |

Video fps/speed above are 1,800 frames / wall time and 60s / wall time,
including ffmpeg process overhead. Encoders/presets differ; this is not an
equal-quality H.264/HEVC comparison. Small and large ran in separate VMs;
some package installation overlapped the large run.

## Authentication and installation

Official Linux archive installed successfully here:

```sh
curl -fL https://github.com/docker/sbx-releases/releases/latest/download/DockerSandboxes-linux-amd64.tar.gz -o sbx.tar.gz
tar -xzf sbx.tar.gz docker-sbx/sbx
export PATH="$PWD/docker-sbx:$PATH"
sbx version
# sbx version v0.54.0 4bec4a5ce093466e54b034146965b143d065dc09
sbx login
sbx --cloud diagnose
```

The live trial signed in headlessly with a Docker ID and a PAT that has
**Allow Cloud Sandboxes access** (`sandbox:use`):

```sh
printf '%s' "$DOCKER_CLOUD_SANDBOX_TOKEN" | sbx login --username "$DOCKER_ID" --password-stdin
```

`DOCKER_CLOUD_SANDBOX_TOKEN` is our secret's variable name, not an automatically
recognized CLI authentication variable. `login --password-stdin` without
`--username` fails. Never echo a PAT into logs or put it in an image. On headless
Linux CLI login can store credentials on disk; prefer an OS keychain where possible.
Docker platform login and model-provider credentials are separate.

There is also REST at `https://connect.docker.com/sandboxes` and a TypeScript SDK,
`@docker/sandboxes`. SDK PAT auth accepts `pat({username, personalAccessToken})`
and keeps credentials in memory. Direct REST exchanges Docker ID+PAT at
`https://hub.docker.com/v2/auth/token`; send the returned access token, **not the
PAT**, as management bearer auth. Exec/file endpoints need sandbox-scoped tokens;
the SDK handles these. SDK `kits.launchAndWait('shell')` needs no model key.

## Creation, sizes and concurrency

```sh
sbx --cloud create --name trial --image-ref ubuntu:24.04 --cpus 2 --memory 4g --ttl 2h
sbx --cloud exec trial sh -lc 'id; uname -a; nproc; free -h; df -h / /tmp'
sbx --cloud inspect trial --format json
sbx --cloud ls
```

| Configuration | Create wall time | Observed resources |
| --- | --- | --- |
| Ubuntu small amd64 | 2.07s (another 3.00s) | nproc=2; RAM 3.8Gi; root overlay 20G; /tmp tmpfs 2.0G |
| Ubuntu large amd64 | 3.01s | nproc=8; RAM 15Gi; root overlay 30G |
| Ubuntu small arm64 (`--platform linux/arm64`) | 4.28s | aarch64; nproc=2; RAM 3.9Gi; root 20G |
| Ubuntu micro amd64 | 2.04s | RAM 1.9Gi; root 9.9G; /tmp tmpfs 996M |
| `sbx/shell-docker-image:latest`, small | 3.51s | agent UID 1000; passwordless sudo; Docker client/server 29.10.0 |

Five Ubuntu sandboxes were simultaneously `running` (micro, three small including
arm64, and large). This tests simultaneous residency and parallel creation,
not five saturated production workloads. No quota changes were needed.

Supported CPU/RAM pairs: micro 1/2GiB, small 2/4GiB (default), medium 4/8GiB,
large 8/16GiB, xl 16/32GiB. xl was not tested. Disk sizes above are measured
filesystem capacities, not a documented storage guarantee; there is no create
disk-size flag. `/tmp` consumes memory. No swap, `nvidia-smi`, `/dev/nvidia*` or
`/dev/dri` appeared in the Ubuntu probes; no cloud GPU size is documented.

`ubuntu:24.04` executed as root. apt worked; sudo worked once installed. It has
no Docker binary by default. The shell-docker image supplies both Docker and
passwordless sudo; nested `docker run --rm hello-world` pulled and printed
`Hello from Docker!`. Prefer direct `sbx exec` for trial commands: Docker documents
a cloud bug where nested `docker exec`/Compose exec/healthchecks can address the
VM filesystem rather than the intended container. A running Docker daemon is
not evidence that those paths are correct.

### Shell Kit and Git Kit gotchas

`sbx --cloud create ... shell` failed **before creation**:

```text
shell — now ships as a kit; resolving docker.io/sbx/shell:latest
... auth.docker.io/token?scope=repository%3Asbx%2Fshell%3Apull ... 401: Unauthorized
```

Cause of that registry authorization failure was not established. Public Ubuntu
and direct `--image-ref docker.io/sbx/shell-docker-image:latest` worked; the
latter is an image fallback, not proof of named Shell Kit conformance.

The requested Amp Git source was initially refused by the client source allowlist.
Use a scoped process override rather than allowing all publishers globally:

```sh
DOCKER_SANDBOXES_KIT_ALLOWED_SOURCES='["docker.io/","dhi.io/","github.com/nextexcite/"]' \
  sbx --cloud create --name amp-trial --cpus 8 --memory 16g --ttl 2h \
  'git+https://github.com/nextexcite/sbx-agent-kits.git#dir=kits/v3/amp'
# create accepts the workload as positional argument; --kit adds mixins.
```

This fetched the repo and built it with local Docker Buildx. `sbx settings get`
attempted to start the local daemon and failed on this archive-only client with
`no plugins registered for io.containerd.transfer.v1`; cloud operations were
unaffected. The environment override avoided changing shared settings.

The cold Amp Kit took **504.72s total**: build reported **5m8s**, cloud
upload/preparation approximately **2m56s**, sandbox create **15s**, kit apply **1s**.
The client warned that it could not retain the built image in the local sandbox
daemon cache, but successfully uploaded it as a cloud template and launched it.
Inside: UID 1000, 8 CPUs, ~15Gi RAM, 30G root, Amp version
`0.0.1795075234-g7a71f0`; `sbx-agent-kits-verify` printed
`PASS: all requested executables present, agent UID=1000, Node >=24 with an LTS release marker (installed via fnm)`.
The check covers presence/UID/Node, not authenticated agent or browser behavior.

**Credential limitation:** CLI warned `kit credentials for amp are not routed
when launching an uploaded or imported kit image; the sandbox starts without
them`. There was no AMP_API_KEY for this trial, so authenticated Amp use remains
unverified; do not assume this Kit's proxyManaged declaration alone binds a key.
The uploaded Kit auto-created a cloud template, which must also be cleaned up.

```sh
sbx --cloud exec amp-trial sh -lc 'amp --version; sbx-agent-kits-verify; docker version'
sbx --cloud exec amp-trial sh -lc 'nohup bash -c "while true; do date +%s >>/home/agent/runner-heartbeat; sleep 2; done" >/home/agent/runner.log 2>&1 </dev/null & echo $! >/home/agent/runner.pid'
sbx --cloud stop amp-trial
# Wait for stopped, then exec auto-resumes:
sbx --cloud exec amp-trial sh -lc 'ps -p $(cat /home/agent/runner.pid) -o pid,args; tail /home/agent/runner-heartbeat'
```

Amp Kit dummy runner survived exec disconnect and stop/resume with identical
PID **762**, and the heartbeat file resumed advancing after the pause. Resume
exec took **1.31s**. Stop request returned in 0.39s but actual checkpoint completion
took over a minute (last `stopping` observation ~70s after request; confirmed
stopped at a later check). Do not treat the stop-request latency as stop completion.

## Egress and inbound HTTP

Account policy initially listed `Default: deny-all`, no rules, yet an early
apt/TCP attempt succeeded; the reason was not isolated. Do not infer enforcement
from the listing alone. An explicit per-sandbox deny-all followed by
curl reliably blocked all four test domains with DNS failure/HTTP 000; policy logs
recorded `No matching allow rule (default deny)` for each. Allow-all then permitted:

| URL | HTTP | curl wall seconds |
| --- | --- | --- |
| https://google.com (redirects followed) | 200 | 0.135 |
| https://youtube.com | 200 | 0.315 |
| https://pypi.org | 200 | 0.061 |
| https://github.com | 200 | 0.069 |

Only trial sandbox policies were changed; account defaults were left untouched.
`balanced` was inspected on a disposable sandbox: deny-all plus development
allowlist (PyPI, npm, GitHub, Ubuntu, model endpoints, browser CDNs, etc.), not
unrestricted web/YouTube access. No HTTP-method/path filtering in cloud. Matching
deny rules override allows. Allow required domains, including redirects/CDNs:

```sh
sbx --cloud policy init balanced --sandbox trial
sbx --cloud policy allow network example.com:443 --sandbox trial
sbx --cloud policy ls trial
sbx --cloud policy log trial
# For an intentionally unrestricted disposable workload trial only:
sbx --cloud policy init allow-all --sandbox trial
```

File round trip passed byte-for-byte (`cmp`, `COPY_ROUNDTRIP_IDENTICAL`):

```sh
sbx --cloud cp ./input.txt trial:/root/input.txt
sbx --cloud cp trial:/root/input.txt ./roundtrip.txt
cmp input.txt roundtrip.txt
```

Python's HTTP server was launched with nohup, exec disconnected, then port 8080
published. Curling the assigned public HTTPS URL returned `durable`. The same
server PID and endpoint worked after stop/resume. Initial 502 was a setup race
(Python was not yet installed), not a successful endpoint check.

```sh
sbx --cloud exec trial sh -lc 'nohup python3 -m http.server 8080 --directory /root >/root/http.log 2>&1 </dev/null & echo $! >/root/http.pid'
sbx --cloud port publish trial 8080
# curl the HTTPS URL printed by publish; wait for the server to be ready first.
sbx --cloud port unpublish trial 8080
```

Published URLs are public endpoints. Bind a harmless test server only briefly;
use service authentication for real data. No host port/IP bindings or UDP.
Cloud cp is a transfer, not a host mount or live sync; permissions, timestamps,
empty directories and symlink semantics differ from a normal filesystem copy.

## Lifecycle and persistence

```sh
sbx --cloud ttl +30m trial
sbx --cloud stop trial
sbx --cloud inspect trial --format json
# Wait until state is stopped, not stopping, before resuming:
sbx --cloud exec trial sh -lc 'cat /root/input.txt; ps -p $(cat /root/http.pid) -o pid,args'
sbx --cloud ttl trial
sbx --cloud rm --force trial
```

TTL extension worked (+30m). Stop request returned in **0.40s**, but state remained
`stopping` for tens of seconds; an immediate exec failed with “is stopping; retry
once it stops”. After `stopped`, exec automatically resumed in **1.22s**.
File `durable` and the identical Python HTTP PID **2359** survived, demonstrating
memory/process retention, not just disk persistence. Detached processes also
survived ordinary exec disconnection. This supports runner-daemon viability,
but was not an actual orb service trial or host-failure recovery test.

Default TTL is 1h; this trial requested 2h. Inspect reported `on_timeout: stop`,
`auto_resume: true`. Resuming started a new 2h TTL (the earlier +30m did not carry
over). Documented actions are stop/restart/delete; zero TTL does not disable it.
Extensions are limited to 24h from creation. Stopped compute is not billed.
Stop/resume availability can depend on account features; this account supported it.

Prepared Python/filesystem template:

```sh
sbx --cloud template save trial prepared
sbx --cloud create --name restored --template prepared --ttl 2h
sbx --cloud template rm --force prepared
```

Save took **18.41s**, ~75MiB (listing: 79.2MB). Clone creation took **5.10s**,
versus 2–3s for bare Ubuntu: no bare-image launch speedup, but Python and the
marker file were present without reinstalling. This was a minimal prepared
snapshot, not the completed media/browser environment; no controlled installation
time-savings measurement. Default disk-only template did **not** retain the HTTP
process. `--capture-mode all` is documented to capture memory/checkpoint too,
but was not tested. Templates inherit their resource size.

Experimental cloud volumes are documented, not tested: data snapshots on sandbox
exit (not continuously), last exiting concurrent writer wins; volume-backed
sandboxes cannot stop and require timeout delete. Back up outputs explicitly.
Never snapshot filesystem-written provider credentials.

## Reproduce the workload probes

### ffmpeg

Installed Ubuntu ffmpeg 6.1.1 and `time`, then ran the same deterministic source
generation in each size. Generation is excluded from transcode wall times.

```sh
N=$(nproc)
ffmpeg -v error -y -f lavfi -i testsrc2=size=1920x1080:rate=30 -t 60 \
  -c:v libx264 -preset ultrafast -crf 18 -threads "$N" source.mp4
/usr/bin/time -f 'H264_SECONDS=%e' ffmpeg -hide_banner -nostats -y -i source.mp4 \
  -c:v libx264 -preset medium -crf 23 -threads "$N" h264.mp4
/usr/bin/time -f 'HEVC_SECONDS=%e' ffmpeg -hide_banner -nostats -y -i source.mp4 \
  -c:v libx265 -preset fast -crf 28 -x265-params "pools=$N:frame-threads=2" hevc.mp4
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,duration,nb_frames -of compact hevc.mp4
```

Both output codecs were verified as 1920x1080, 60.000000s, 1,800 frames.
HEVC was chosen as the requested AV1/HEVC alternative; AV1 was not tested.

### yt-dlp and faster-whisper

```sh
python3 -m venv /opt/media
/opt/media/bin/pip install yt-dlp faster-whisper
/opt/media/bin/yt-dlp --js-runtimes node:/opt/node/node-v22.16.0-linux-x64/bin/node \
  --no-playlist --socket-timeout 15 --retries 1 -f bestaudio -x --audio-format wav \
  -o /root/youtube.wav 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
# Failed bot check, including with JS. No cookies supplied or bypass attempted.
curl -fL https://raw.githubusercontent.com/openai/whisper/main/tests/jfk.flac -o /root/jfk.flac
```

faster-whisper 1.2.1 + PyAV 19.0.2 failed native file decoding:
`TypeError: open() got an unexpected keyword argument 'metadata_errors'`.
Decode through ffmpeg to a numpy array instead (model download cached by the
first failed attempt, so reported model-load time is warm):

```python
import subprocess, time
import numpy as np
from faster_whisper import WhisperModel
t = time.monotonic()
model = WhisperModel('tiny.en', device='cpu', compute_type='int8', cpu_threads=8)
loaded = time.monotonic()
pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', '/root/jfk.flac',
                               '-f', 's16le', '-ac', '1', '-ar', '16000', '-'])
audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
segments, info = model.transcribe(audio, beam_size=5)
print(' '.join(s.text for s in segments))
print('decode+transcribe seconds', time.monotonic() - loaded)
```

Actual transcript: “And so, my fellow Americans ask not what your country can do
for you ask what you can do for your country.” HF model download succeeded
without a token. Pin compatible library versions for a repeatable deployment.

### Browser

Used official Node 22.16.0 binary (SHA256 matched Node's SHASUMS256.txt), npm 10.9.2.
Bare Ubuntu lacked xz executable, so Python tarfile extracted the Node archive.
Latest agent-browser installed Chrome for Testing rather than distro Chromium.

```sh
export PATH=/opt/node/node-v22.16.0-linux-x64/bin:$PATH
npm i -g agent-browser
agent-browser install
# On this ffmpeg-prepared Ubuntu image these additional libraries were needed:
apt-get install -y --no-install-recommends libnspr4 libnss3
agent-browser open https://example.com
agent-browser snapshot
agent-browser screenshot /root/example.png
agent-browser close
# From client:
sbx --cloud cp trial:/root/example.png ./example.png
```

For a genuinely bare image use `agent-browser install --with-deps`. apt archive
downloads occasionally stalled; retry with bounded `Acquire::http::Timeout` and
`Acquire::Retries`. Wait for apt to finish before starting another apt operation.
Successful screenshot was copied out and visually inspected; evidence at
`/home/ubuntu/sbx-discovery/example.png` on the trial client (not committed).

## Limits, pricing and references

Documented defaults: 10 concurrent / 50 stored sandboxes, 100 volumes, 100 secrets,
3 images preparing simultaneously; actual account allowances can differ. Rate
limits are operation-dependent; honor server retry guidance. Compute is metered
per second by selected CPU/RAM, no recurring platform subscription fee; inference
is separate. Public pages reviewed did not publish numeric size rates. See
[account usage/pricing](https://agentic-platform.docker.com/usage) for actual rates
and credits. No cost or quota settings were changed in this trial.

Sources (documentation versus measured results distinguished above):

- [Install](https://docs.docker.com/ai/sandboxes/install/), [CLI releases](https://github.com/docker/sbx-releases)
- [Cloud overview](https://docs.docker.com/ai/sandboxes/cloud/), [usage/lifecycle/templates/known Docker limitations](https://docs.docker.com/ai/sandboxes/cloud/usage/)
- [Cloud network policy](https://docs.docker.com/ai/sandboxes/cloud/network-policy/)
- [API authentication](https://docs.docker.com/ai/sandboxes-api/authentication/), [SDK shell quickstart](https://docs.docker.com/ai/sandboxes-api/get-started/)
- [Compute sizes and limits](https://docs.docker.com/ai/sandboxes-api/limits/), [billing](https://docs.docker.com/subscription-billing/plans/docker-agentic-platform/)
- [Local/cloud differences](https://docs.docker.com/ai/sandboxes/cloud/local-vs-cloud/), [move snapshots](https://docs.docker.com/ai/sandboxes/cloud/move/)
- [Kit v3 spec](https://github.com/docker/sandbox-kit-spec), [contributed kits](https://github.com/docker/sbx-kits-contrib)

Raw probe logs/scripts are under `/home/ubuntu/sbx-discovery/` on the trial client.
They are not committed and are not a portable benchmark harness.

## Cleanup

All eight sandboxes created for this trial were removed (five initial Ubuntu,
one prepared-template clone, one shell-image fallback, one Amp Kit). The public
port was unpublished, and both generated cloud templates were removed. No
account-wide policy, quota, billing or credential settings were changed.

The account was **not empty before the trial**. Two pre-existing stopped
sandboxes were intentionally preserved rather than deleting unrelated state.
Final `sbx --cloud ls` therefore is not empty; neither remaining row is a trial
resource:

```text
SANDBOX                         AGENT   ID                                STATUS      PORTS   WORKSPACE   CREATED
shell/amp-factory               shell   sbx_001m4hg9m677jx1bpkeh39fdq5b   ○ stopped           -           1mo
sbx-builder-probe-41968811708           sbx_001m6mzwgmknrgme82415ce9btv   ○ stopped           -           2w
```

Final `sbx --cloud template ls`: `No cloud templates found`.
Client-side logs, screenshot, CLI archive and Docker build cache remain;
no repository changes except this document, and no commit was made.
