# Docker Sandboxes agent kits

Development environments for Amp and Codex, plus a CPU media workload:

- **v2 (Amp):** a descriptor referring to a separately built OCI runtime image.
- **v3 (both):** self-contained workload directories using the pinned Kit frontend.

The v2 descriptor is not a runnable container image. The runtime Dockerfile
and v3 workload image are ordinary OCI images, but Docker Sandboxes lifecycle,
network policy and credential injection require the corresponding runtime.

## Scope and safety

This reference includes templates, a shared toolchain installer, context staging
and offline structural tests. CI also builds and smoke-tests the public-base
v3 images in an Amp/Codex matrix. It includes no deployment, registry publishing,
account configuration, cloud resource management or credential-provisioning workflows.
Neither the tests nor GitHub Actions create a sandbox or publish an image.
Agent permission bypass is not enabled by these examples.

The default base is public: `docker.io/sbx/shell-docker-image:latest`.
No registry login or `dhi.io` access is needed. The private
`dhi.io/sbx-templates:shell-docker` remains an optional base override;
its access and compatibility must be checked separately. CI never logs in
to a registry or pushes an image.
Do not put credentials in source, build arguments, image layers or build logs.

## Offline checks and staging

Requires Python 3.11+ and Bash. No service credentials or container daemon needed:

    python3 -m unittest discover -s tests -v
    bash scripts/check.sh
    bash scripts/stage-v3.sh
    bash scripts/stage-v3.sh codex dist/v3-codex
    IMAGE_REFERENCE=example.invalid/agent/runtime:local bash scripts/render-v2.sh

The image reference above is deliberately nonresolving. Replace it privately
with your runtime image reference before using a v2 descriptor. Generated
contexts live in `dist/` and are not committed.

## Run from GitHub

With a Kit v3-capable `sbx`, choose one self-contained workload:

```sh
sbx run --kit "git+https://github.com/nextexcite/sbx-agent-kits.git#dir=kits/v3/amp" .
sbx run --kit "git+https://github.com/nextexcite/sbx-agent-kits.git#dir=kits/v3/codex" .
```

| Kit | Entrypoint | Pinned agent version | Credential service / API-key name |
|---|---|---|---|
| Amp | `amp` | Floats | `amp` / `AMP_API_KEY` |
| Codex | `codex` | `0.166.0` | `openai` / `OPENAI_API_KEY` |

All credential declarations are optional: a missing binding does not block
Kit resolution. Codex also accepts host-managed subscription OAuth
under the same service name. Codex's upstream
README describes binding `OPENAI_API_KEY` or a ChatGPT login to the host's
`openai` credential; use your installed `sbx` credential workflow. These
variable names declare the credential contract, not automatic host-env
injection. Do not bake secrets into builds or Kit arguments.

Reference: [Codex credentials](https://github.com/docker/sbx-kits-contrib/tree/main/codex#prerequisites).
Inside the sandbox, auth files may contain proxy sentinels instead of real
tokens. With no host binding, Codex retains its own login flow.
Managed Codex modes force API login to preserve the runtime's auth seed.

Unlike the upstream examples, these kits keep each agent's default approval
behavior and filesystem sandbox. Workspace trust seeds do not
disable approval prompts. Desktop-app integrations and session-list helpers
are intentionally omitted.
Codex uses `AGENTS.md` and `.agents/skills` at its home discovery locations.

To override the base, add `--kit-arg base_image=<image-reference>`.
For example, users with private registry access can select
`--kit-arg base_image=dhi.io/sbx-templates:shell-docker`.
The `base_image` Kit argument maps to the Dockerfile's `BASE_IMAGE` build
argument. Overrides must provide an apt-based environment with an `agent`
user at UID 1000, home `/home/agent`, and passwordless sudo on Ubuntu.
Codex exposes `--kit-arg version=<release>` for the agent pin.

## Local image builds

Build directly from the committed directory, without staging:

```sh
docker buildx build -f kits/v3/amp/amp.yaml kits/v3/amp -t sbx-agent-kits/amp:local --load
docker run --rm --entrypoint sbx-agent-kits-verify sbx-agent-kits/amp:local
docker run --rm --entrypoint amp sbx-agent-kits/amp:local --version
```

For Codex, replace `amp` in those commands with `codex`, including the
descriptor, directory, image tag and agent entrypoint.
The complete, checksum-verified Codex release package is installed as
`agent`; it does not use a private agent base image.

For a frontend base override, use `--build-arg base_image=<image-reference>`
(the Kit argument name). For the plain v2 Dockerfile, use
`--build-arg BASE_IMAGE=<image-reference>`:

```sh
docker buildx build -f kits/v2/Dockerfile . -t sbx-agent-kits/amp:v2-local --load
docker run --rm --entrypoint sbx-agent-kits-verify sbx-agent-kits/amp:v2-local
```

These commands only load local images; they never publish them. The v3
Kit requests Docker Engine optionally and retains the legacy startup label
for older runtimes. A runtime may skip the optional capability.

### Synchronizing build inputs

`scripts/` at the repository root is the source of truth for agent toolchains. The three build
scripts are vendored into the Amp and Codex `scripts/` directories so Git-source builds need
nothing outside their Kit directory. After editing a root script, run:

```sh
bash scripts/sync-kits.sh
bash scripts/sync-kits.sh --check
```

Unit tests fail on missing or drifted copies. `stage-v3.sh [kit] [destination]`
copies a self-contained directory (default `amp` to `dist/v3`); it does not
silently repair drift. Use separate destinations when staging different kits.

## Toolchains and limitations

The shared installer includes mise, uv, fnm-managed Node LTS, pnpm, Pi,
Bun, Deno, agent-browser, Chromium, skills and GitHub CLI. Debian uses distro
Chromium; Ubuntu uses Playwright's browser download rather than a Snap launcher.
Each image adds its selected agent. `sbx-agent-kits-verify` checks that image's
agent via `SBX_AGENT_BINARY` (default `amp`); installation can check just the
shared toolchains before installing Codex.
The runtime is the `agent` user with UID 1000. The templates target Linux
amd64/arm64; the CI image build and smoke test cover amd64 only.

The Kit frontend is digest-pinned. The base image tag, upstream installers and
several packages float. Builds are not reproducible or supply-chain verified;
review and pin these dependencies before production use. The installer runs
upstream scripts during image builds, including the public CI build job.

Public CI checks shell syntax, deterministic staging and structural safety on
a standard GitHub-hosted runner, then builds both v3 Kits and runs their smoke tests.
The smoke test checks executable discovery, UID and Node LTS; it does not
exercise authenticated agent calls or every installed tool. Passing CI does not
constitute full Kit conformance, sandbox lifecycle or cloud acceptance testing.

Specifications: [Kit v3](https://github.com/docker/sandbox-kit-spec) and
[Kit v2](https://github.com/docker/sbx-kits-contrib/blob/main/spec/SPEC-v2.md).

## CPU media Kit v3

`kits/v3/media` is a self-contained, non-root media workload, without agent
credentials or GPU dependencies. It installs ffmpeg with libx264/libx265,
Node for yt-dlp, and a Python venv with yt-dlp 2026.10.26,
its compatible yt-dlp-ejs 0.8.0 challenge solver, faster-whisper
1.2.1, PyAV 16.0.1 and numpy 2.3.5. The tiny.en model and public Whisper
JFK test sample are baked in for offline use. This is separate from the
Amp/Codex toolchain images and their CI build matrix.

```sh
bash scripts/stage-v3.sh media /tmp/media-stage
docker build -t media-kit:local -f kits/v3/media/media.dockerfile kits/v3/media
docker run --rm --network none --entrypoint media-smoke media-kit:local
sbx --cloud create --name media-trial --cpus 2 --memory 4g \
  'git+https://github.com/nextexcite/sbx-agent-kits.git#dir=kits/v3/media'
```

If Git sources are refused, use a process-scoped
`DOCKER_SANDBOXES_KIT_ALLOWED_SOURCES='["docker.io/","dhi.io/","github.com/nextexcite/"]'`
override. Uploading a Git Kit builds locally and can take several minutes.

Inside the workspace:

```sh
media-encode input.mov output.mp4 --codec h264
media-encode input.mov output-hevc.mp4 --codec hevc
media-transcribe input.mp4 --format srt > subtitles.srt
media-transcribe input.wav --model base.en --format json > transcript.json
media-fetch-audio 'https://www.youtube.com/watch?v=VIDEO_ID' 'audio.%(ext)s' --format wav
media-smoke # optional: --url URL (download errors are WARN)
```

Transcription always decodes through ffmpeg to float32 numpy samples, avoiding
native PyAV decode compatibility issues. Only tiny.en is preloaded; other models
require network or a local directory. YouTube bot-checks cloud IPs even with JS:
use an authorized cookies file via `--cookies` / `YT_COOKIES_FILE`, optionally
`--proxy` / `YT_PROXY`. Never bake cookies into an image. Uploaded Kits do not
route credentials; media deliberately declares no credential capability.
Its runtime allowlist includes Hugging Face, PyPI, GitHub and YouTube/CDNs;
other sites, redirects or proxies may need additional scoped allowances.
See `kits/v3/media/media-context.md` for helper details and memory caveats.

## Registry diagnostics and Cloud acceptance

The optional `scripts/diagnose-kit-registry.sh` accepts an explicit image
reference, or `--compare PRIVATE_REFERENCE PUBLIC_CONTROL`. It checks existing
Docker and sbx resolver access without login or credential changes. Run it
only on an authorized, already authenticated client with Python 3, Docker
Buildx and sbx installed. It prints status labels rather than references or
raw CLI output. Each probe defaults to 15 seconds plus one-second cleanup
grace. The diagnostic's CI tests use fake CLIs and never contact a registry;
the separate image-build jobs pull public images and download toolchains.
Process-group cleanup covers ordinary child processes, not children that
explicitly escape into a different session. Registry success is not Kit
conformance or Cloud execution evidence.

See [custom toolchain and durability acceptance](docs/TOOLCHAIN-E2E.md) for
initialization, time-to-ready and stop/resume checks using the custom Kit.
The final template must contain the requested tools; an official default
shell image is only a possible control. Provider selection and credentials
are each user's responsibility. No actual Amp/Pi model task is needed to
validate toolchain availability and durable workspace state.
