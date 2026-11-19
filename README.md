# Docker Sandboxes agent kits

Reference source for an Amp development environment in two OCI formats:

- **v2:** a Kit descriptor referring to a separately built OCI runtime image.
- **v3:** a self-contained workload build context using the pinned Kit frontend.

The v2 descriptor is not a runnable container image. The runtime Dockerfile
and v3 workload image are ordinary OCI images, but Docker Sandboxes lifecycle,
network policy and credential injection require the corresponding runtime.

## Scope and safety

This reference includes templates, a shared toolchain installer, context staging
and offline structural tests. CI also builds and smoke-tests the public-base
v3 image. It includes no deployment, registry publishing,
account configuration, cloud resource management or credential workflows.
Neither the tests nor GitHub Actions create a sandbox or publish an image.
Agent permission bypass is not enabled by these examples.

The default base is public: `docker.io/sbx/shell-docker-image:latest`.
No registry login or `dhi.io` access is needed. The private
`dhi.io/sbx-templates:shell-docker` remains an optional base override;
its access and compatibility must be checked separately. CI never logs in
to a registry or pushes an image.
Do not put credentials in source, build arguments, image layers or build logs.

## Offline checks and staging

Requires Python 3 and Bash. No service credentials or container daemon needed:

    python3 -m unittest discover -s tests -v
    bash scripts/check.sh
    bash scripts/stage-v3.sh
    IMAGE_REFERENCE=example.invalid/agent/runtime:local bash scripts/render-v2.sh

The image reference above is deliberately nonresolving. Replace it privately
with your runtime image reference before using a v2 descriptor. Generated
contexts live in `dist/` and are not committed.

## Run from GitHub

With a Kit v3-capable `sbx`, use the committed self-contained Kit directory:

```sh
sbx run --kit "git+https://github.com/nextexcite/sbx-agent-kits.git#dir=kits/v3/amp" .
```

To override the base, add `--kit-arg base_image=<image-reference>`.
For example, users with private registry access can select
`--kit-arg base_image=dhi.io/sbx-templates:shell-docker`.
The `base_image` Kit argument maps to the Dockerfile's `BASE_IMAGE` build
argument. Overrides must provide an apt-based environment with an `agent`
user at UID 1000, home `/home/agent`, and passwordless sudo on Ubuntu.

## Local image builds

Build directly from the committed directory, without staging:

```sh
docker buildx build -f kits/v3/amp/amp.yaml kits/v3/amp -t sbx-agent-kits/amp:local --load
docker run --rm --entrypoint sbx-agent-kits-verify sbx-agent-kits/amp:local
docker run --rm --entrypoint amp sbx-agent-kits/amp:local --version
```

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

`scripts/` at the repository root is the source of truth. The three build
scripts are vendored into `kits/v3/amp/scripts/` so Git-source builds need
nothing outside that directory. After editing a root script, run:

```sh
bash scripts/sync-kits.sh
bash scripts/sync-kits.sh --check
```

Unit tests fail on missing or drifted copies. `stage-v3.sh` copies this
self-contained directory to `dist/v3`; it does not silently repair drift.

## Toolchains and limitations

The shared installer includes Amp, mise, uv, fnm-managed Node LTS, pnpm, Pi,
Bun, Deno, agent-browser, Chromium, skills and GitHub CLI. Debian uses distro
Chromium; Ubuntu uses Playwright's browser download rather than a Snap launcher.
The runtime is the `agent` user with UID 1000. The templates target Linux
amd64/arm64; the CI image build and smoke test cover amd64 only.

The Kit frontend is digest-pinned. The base image tag, upstream installers and
several packages float. Builds are not reproducible or supply-chain verified;
review and pin these dependencies before production use. The installer runs
upstream scripts during image builds, including the public CI build job.

Public CI checks shell syntax, deterministic staging and structural safety on
a standard GitHub-hosted runner, then builds the v3 Kit and runs its smoke test.
The smoke test checks executable discovery, UID and Node LTS; it does not
exercise authenticated Amp calls or every installed tool. Passing CI does not
constitute full Kit conformance, sandbox lifecycle or cloud acceptance testing.

Specifications: [Kit v3](https://github.com/docker/sandbox-kit-spec) and
[Kit v2](https://github.com/docker/sbx-kits-contrib/blob/main/spec/SPEC-v2.md).
