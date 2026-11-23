# Sandbox development kits

Reusable development environments for cloud sandboxes. Choose a provider and
workload below; each kit documents what the provider supplies, what the kit
adds, and what has been tested. Kits are not interchangeable VM images.

## Choose a provider

| Provider | Kit | Status |
| --- | --- | --- |
| Docker Sandboxes | [`docker/amp`](docs/docker-sandboxes.md#run-from-github), [`docker/codex`](docs/docker-sandboxes.md#run-from-github) | v3 Git-source kits with build and smoke checks in CI; legacy v2 Amp runtime and descriptor also available. |
| Docker Sandboxes | [`docker/browser`](docs/docker-sandboxes.md#browser-automation-amd64), [`docker/media`](docs/docker-sandboxes.md#cpu-media-kit-v3) | v3 Git-source kits with build and smoke checks in CI. Live Cloud evidence is linked from the provider guide. |
| Instabox | [`instabox/android`](kits/instabox-android/README.md) | Tested on the Android template with Gradle, ADB, instrumentation, and an ObtainX Flutter UI change. The OCI bundle carries setup files; it does not boot Android. |
| E2B, Daytona | — | Roadmap only; no kits or support claims yet. |

## Repository layout

- `docs/` — provider guides, validation evidence, and [release policy](docs/releases.md).
- `kits/v2/` and `kits/v3/` — Docker Kit entry points. The directory names are
  Docker specification versions and remain valid in existing `sbx --kit` URLs.
- `kits/instabox-android/` — Android overlay and its instrumentation sample.
- `workflows/` — [Docker Cloud workflow reference](workflows/README.md), not a
  shared provider API.
- `.github/workflows/` — repository checks and a manual Instabox instrumentation
  job that uses a pre-existing sandbox and uploads JUnit results.
- `scripts/` and `tests/` — build, staging, diagnostics, and repository checks.

Add new providers under `kits/<provider>/` when a working kit and provider smoke
test are ready. Catalog IDs identify kits independently of their source paths.
Share code only when two kits actually have the same contract.

Run `bash scripts/check.sh` for local checks; it requires Bash and Python 3.11+
and does not need sandbox credentials. Never put credentials in source, build
arguments, container layers, or logs.

## License

Copyright 2026 NextExcite. Project-owned source, recipes, and documentation
are licensed under [Apache-2.0](LICENSE). Third-party components retain their
own licenses and terms, including tools downloaded by the kits and components
in upstream images. See the [release policy](docs/releases.md) for distribution
requirements.
