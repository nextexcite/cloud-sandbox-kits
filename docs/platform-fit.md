# Docker Cloud Sandboxes alongside E2B, Modal, Daytona and Lambda

Which workload goes on which platform, and how work passes between them.

Evidence rules for this page:

- **Measured** means run in this trial on Docker Cloud only: the CLI trial in
  [PR #4](https://github.com/nextexcite/sbx-agent-kits/pull/4)
  (`docs/cloud-sandboxes.md` there) and the `@docker/sandboxes` 0.53.0 Node
  probes below. Each measured claim states its scope.
- **Docs** means taken from the linked vendor page and not run here. Nothing on
  E2B, Modal, Daytona, Lambda, Workers or Inngest was run (no keys / no
  deployment).
- No cross-platform performance comparison was made.

## Short answer

Keep the jobs that already run on E2B there. That is a no-migration choice,
not a measured E2B advantage. For **new** jobs neither platform is the default:
Docker Cloud passed the smoke tests listed below for CPU work, and what it adds
for this repo is Kit v3 images and per-sandbox egress policy logs (both measured; egress on plain Ubuntu).
Move an existing E2B job only after a like-for-like test shows a win.

Hardware **video encoding** (NVENC) needs a GPU: none was found in Docker Cloud
(measured) and [E2B is CPU-only](https://docs.e2b.dev/faq/gpu-support) (docs);
[Modal](https://modal.com/docs/guide/gpu.md) and
[Daytona](https://www.daytona.io/docs/en/gpu-sandboxes.md) offer GPUs (docs).
The orchestrator (Inngest or a queue consumer) owns dispatch and completion;
using Lambda/Workers only as triggers is a design choice of this page.

## Where each workload belongs

| Workload | Existing jobs | Docker Cloud (measured, scope stated) | Other options (docs only) |
| --- | --- | --- | --- |
| Coding agent harnesses | Stay on E2B | Amp Kit/runtime smoke-tested: full cold launch 505 s (local build 5m8s + upload/prep ~2m56s + create 15s); `amp` and `sbx-agent-kits-verify` ran and the Docker daemon was reachable. No agent, model or nested-container run; Codex/Claude Kits not run | not assessed |
| Amp runner / orb daemon | Stay on E2B | Proxy only: a detached dummy process kept its PID across stop/resume. No orb run | [Daytona VM pause/resume](https://www.daytona.io/docs/en/persistence.md) keeps memory; container sandboxes do not |
| CPU video encoding (H.264/HEVC) | Stay on E2B | One 60 s 1080p30 clip, large size: H.264 16.7 s (3.6x realtime), HEVC 29.4 s (2.0x) | [Lambda](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html) if a job fits in one standard 15 min invocation |
| GPU video encoding (NVENC) | n/a ([E2B CPU-only](https://docs.e2b.dev/faq/gpu-support)) | No GPU found | [Modal GPUs](https://modal.com/docs/guide/gpu.md) incl. L4, which [NVIDIA lists with NVENC](https://developer.nvidia.com/video-encode-and-decode-gpu-support-matrix-new); [Daytona GPU sandboxes](https://www.daytona.io/docs/en/gpu-sandboxes.md) (deleted on stop). GPU encode not tested |
| Transcription, `tiny.en` | Stay on E2B | One 11 s sample, CPU int8: 17.6x realtime, model load excluded, accuracy not checked | n/a |
| Transcription, larger Whisper models | Stay on E2B | Not benchmarked. [faster-whisper documents](https://github.com/SYSTRAN/faster-whisper#usage) `large-v3` on CPU with int8 | Modal or Daytona GPU when throughput demands it |
| YouTube audio retrieval | Authorized fetch outside the processing sandbox | Unauthenticated `yt-dlp` failed the bot check from the tested Docker egress (one video) | not tested |
| Browser automation (agent-browser) | Stay on E2B | Smoke test passed: install 2.9 s, first open 0.64 s, snapshot/screenshot/download; CJK needs extra fonts | not assessed |
| Dispatch (webhook, schedule, fan-out) | Inngest / queue consumer | Node SDK smoke-tested from a plain Node process (below). No webhook, Inngest, Lambda or Worker run | n/a |

"Stay on E2B" means no migration without a like-for-like test, not that E2B
won one.

## Platform facts

Docker column: measured unless marked. Other columns: vendor docs only.

| | Docker Cloud Sandboxes | E2B | Modal Sandboxes | Daytona | Lambda / Workers |
| --- | --- | --- | --- | --- | --- |
| Isolation | not verified here | [Firecracker microVM](https://docs.e2b.dev/template/how-it-works) | [gVisor or VM runtime](https://modal.com/docs/guide/sandboxes.md) | [containers, Linux/Windows VMs, GPU](https://www.daytona.io/docs/en/isolation.md) | — |
| Startup (not comparable across columns) | amd64 Ubuntu micro/small/large 2.0–3.0 s, `shell-docker` small 3.5 s, arm64 small 4.3 s (CLI); SDK batch of 5 micro creates+exec 3.2 s; full cold custom Amp Kit launch 505 s | ~80 ms to [load a prepared snapshot](https://docs.e2b.dev/template/how-it-works) | no Sandbox readiness benchmark; vendor reports [sub-second VM cold starts](https://modal.com/blog/vm-sandboxes-agent-computers) | vendor reports [<90 ms](https://www.daytona.io/docs/en/sandboxes.md) | — |
| Lifetime | resume started a new TTL; default 1 h TTL and 24 h-from-creation extension cap per Docker docs (PR #4) | [24 h (Pro) continuous, reset by pause/resume](https://docs.e2b.dev/faq/sandbox-lifetime) | [5 min default, 24 h max](https://modal.com/docs/guide/sandboxes.md) | [kept until deleted; auto-stop/pause/delete intervals](https://www.daytona.io/docs/en/persistence.md) | [Lambda 15 min per standard invocation](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html); [Workers `waitUntil` up to 30 s of post-response work](https://developers.cloudflare.com/workers/platform/limits/) |
| Memory/process state | stop/resume kept a dummy process and its PID | [pause keeps memory and processes](https://docs.e2b.dev/sandbox/persistence), [auto-resume](https://docs.e2b.dev/sandbox/auto-resume) | [experimental memory snapshots](https://modal.com/docs/guide/sandbox-snapshots#memory-snapshots): restore into a new sandbox, not live pause/resume, snapshot ends the original, 7-day expiry | [VM pause/resume keeps memory; containers keep disk only](https://www.daytona.io/docs/en/persistence.md); [GPU deleted on stop](https://www.daytona.io/docs/en/gpu-sandboxes.md) | — |
| GPU | none found | [none](https://docs.e2b.dev/faq/gpu-support) | [yes](https://modal.com/docs/guide/gpu.md), [gVisor runtime only](https://modal.com/docs/guide/sandboxes.md) | [NVIDIA/AMD](https://www.daytona.io/docs/en/gpu-sandboxes.md) | — |
| Nested Docker | `docker run hello-world` passed on `sbx/shell-docker-image`; nested exec/Compose caveat (PR #4) | [official template](https://docs.e2b.dev/template/examples/docker) | [VM runtime](https://modal.com/docs/guide/sandboxes.md) | [Docker-in-Docker snapshot](https://www.daytona.io/docs/en/snapshots.md#run-docker-in-a-sandbox) | — |
| Egress control | on plain Ubuntu (no Kit rules), per-sandbox deny-all blocked all 4 test domains with policy logs; Kit allow rules still apply under deny-all | [domain allowlist](https://docs.e2b.dev/sandbox/networking#domain-based-filtering) | [egress policy](https://modal.com/docs/guide/sandbox-networking.md) | [block all / CIDR / domain allow list](https://www.daytona.io/docs/en/isolation.md) | — |

Cloudflare's own [Sandboxes](https://developers.cloudflare.com/sandbox/) product
was not evaluated.

## Retry-safe handoff (design; only same-key replay tested)

A design, not a tested pipeline. The orchestrator, not the sandbox, owns the job:

1. Persist a stable job ID before provisioning.
2. Create the sandbox with an idempotency key derived from the job ID, and start
   the job process with a second, separate key
   ([Docker cookbook](https://docs.docker.com/ai/sandboxes-api/cookbook/retry-without-creating-duplicates/)).
   After an ambiguous response, retry with the same key, then reconcile the
   sandbox and process names before doing anything else.
3. Run this inside an Inngest step or queue consumer. Inngest steps
   [can repeat a side effect](https://www.inngest.com/docs/durable-execution/guides-and-advanced/idempotency),
   which is why the keys matter.
4. The job writes results to object storage, then signals completion through a
   callback (allow its domain in egress policy) or the orchestrator polls.
   Completion handling must be idempotent.
5. Clean up the sandbox on success or on a timeout the orchestrator owns.

Measured from a plain Node process (same-key replay with identical payloads):

| Call | First | Same-key replay | Result |
| --- | --- | --- | --- |
| `client.create(payload, { idempotencyKey })` | 2.15 s | 0.11 s | same sandbox name |
| `sandbox.processes.start(cmd, { idempotencyKey })` | 0.35 s | 0.06 s | same process name; command ran once |

Limits: no crash, lost response or end-to-end recovery was induced, and this is
not exactly-once. For recovery keep the same keys **and identical payloads**,
store the returned resource names, and replay only within the window Docker
keeps accepted results (at least 24 h,
[errors](https://docs.docker.com/ai/sandboxes-api/errors/)); outside it,
reconcile the job record against the provider before retrying or using a new key.

Also measured: exec during `stopping` failed (`ResourceWaitError`) and delete
during `stopping` returned 409 `failedPrecondition`; wait for `stopped`.
Detachment probe (no failure paths, one small `ubuntu:24.04`): create 2.5 s, first exec 0.5 s, 1 MiB
upload 0.39 s / download 0.18 s, delete 0.5 s; a fresh Node process reconnected
by name in 0.28 s and read a detached job's output. `sandbox.run()` returned
collected output; `processes.start()` + `connect()` streamed it.

## Other handoffs (design)

- **Fetch outside, process inside.** An authorized step fetches media within
  the source's [terms](https://www.youtube.com/t/terms) and writes it to a
  short-lived object URL; the sandbox reads that URL. Source credentials stay
  out of the processing sandbox. Cookies or other egress were not tested.
- **CPU → GPU.** Segments needing NVENC or a larger Whisper model go to a GPU
  platform through object storage. Untested: verify the codec with a real
  encode and compare end-to-end time including transfer before splitting jobs.
- **Pausing agent sessions on Docker Cloud.** Set an explicit `on_timeout` and
  [auto-resume](https://docs.docker.com/ai/sandboxes-api/cookbook/let-a-stopped-sandbox-resume-on-demand/)
  (docs); wait for `stopped` before exec (measured). Per Docker docs cited in
  PR #4 (untested), volumes are experimental, snapshot only on exit, and
  volume-backed sandboxes cannot stop, so pass data through object storage or
  HTTPS and checkpoint state outside the sandbox.

## Calling from Lambda and Cloudflare Workers

- `@docker/sandboxes` 0.53.0 documents [Node ≥20](https://docs.docker.com/ai/sandboxes-api/install/)
  and [Lambda offers Node runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html)
  (docs). No Lambda deployment was tested.
- Workers: a `--conditions=worker` esbuild bundle builds (357 KB; plain neutral
  failed on `node:*` builtins), but SDK 0.53.0's PAT sign-in **fails as-is in
  local workerd** (`wrangler dev`, no `nodejs_compat`): its auth request is built
  with `redirect: "error"` (`dist/internal/docker-auth.js`), which workerd
  rejects (`Invalid redirect value, must be one of "follow" or "manual"`), so
  the token fetch is never attempted. Found and reproduced in the
  [PR #8 review](https://github.com/nextexcite/sbx-agent-kits/pull/8); a deployed
  Worker, other auth paths and workarounds are untested. Use Workers → Queue →
  Node for SDK calls.
- `npm audit` on the SDK install reported its `undici` dependency (1 moderate,
  1 high).

## Not measured

- Any E2B, Modal, Daytona, Lambda, deployed Workers or Inngest run (local
  workerd ran only the failing PAT sign-in above).
- Fan-out beyond one batch of 5 parallel micro creates (documented defaults: 10 concurrent /
  50 stored), real callbacks, xl size, volumes, GPU encoding, agent/model runs,
  an actual orb, cost per job.
