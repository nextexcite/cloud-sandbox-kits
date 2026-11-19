# Docker Cloud Sandboxes alongside E2B, Modal, Daytona and Lambda

Which workload goes on which platform, and how work passes between them.
Docker Cloud numbers are measured: the CLI trial in
[PR #4](https://github.com/nextexcite/sbx-agent-kits/pull/4)
(`docs/cloud-sandboxes.md` there) and the SDK probes below. E2B, Modal, Daytona,
Lambda and Workers facts come from the linked vendor docs and were **not**
measured here (no keys for those platforms).

## Short answer

E2B stays the baseline for the workloads that already run there: it documents
pause/resume with memory and running processes, auto-resume, a nested-Docker
template and idempotent creation, which covers most of what Docker Cloud offered
in the trial. Use Docker Cloud as an opt-in where its own features matter:
Kit v3 images built from this repo, per-sandbox domain egress policy with
logs, or Docker-native workflows. Move an existing E2B job only after a
like-for-like test shows a win. GPU jobs go to an NVENC-capable GPU on Modal
(or a Daytona GPU sandbox). The orchestrator (Inngest, a queue consumer)
owns dispatch and completion; Lambda/Workers are the trigger layer in this
architecture by choice, not because they cannot run bounded jobs.

## Where each workload belongs

| Workload | Default | Docker Cloud role | Other options |
| --- | --- | --- | --- |
| Coding agent harnesses (Amp, Codex, Claude) | E2B (existing) | Opt-in for Kit v3 images and audited domain egress; Amp Kit ran with nested Docker in the trial (no model run) | Daytona VM sandboxes |
| Amp runner / orb daemon | E2B (pause keeps processes) | Opt-in; a detached dummy process kept its PID across stop/resume. This is a proxy, not an orb test | Daytona **VM** pause/resume (container sandboxes clear memory on stop) |
| CPU video encoding (H.264/HEVC) | Docker Cloud large or E2B | 60 s of 1080p30, large size: H.264 16.7 s (3.6x realtime), HEVC 29.4 s (2.0x) | Lambda for bounded jobs under 15 min |
| GPU encoding (NVENC) | Modal with an NVENC GPU, e.g. L4 | None (no GPU in Docker Cloud) | Daytona GPU sandboxes (deleted on stop) |
| Whisper beyond tiny/base | Modal GPU | None | Daytona GPU sandboxes |
| Transcription, tiny/base models | Any CPU sandbox | One 11 s `tiny.en` sample ran 17.6x realtime, model load excluded | GPU when accuracy needs a larger model |
| YouTube audio retrieval | Authorized fetch outside the processing sandbox | Unauthenticated yt-dlp failed the bot check from the tested Docker egress | Other platforms not tested |
| Browser automation (agent-browser) | E2B (existing) | Works: Chrome install 2.9 s, first open 0.64 s; add CJK fonts | Daytona |
| Webhook intake, scheduling, fan-out | Inngest / queue consumer, triggered by Lambda or Workers | Called through the SDK | n/a |

Changes from the first draft: agents, the runner and the browser default to E2B
(not Docker Cloud); the orb fallback is Daytona VM pause/resume; GPU options
include Daytona; Lambda is allowed for bounded CPU jobs.

## Platform facts

| | Docker Cloud Sandboxes | E2B | Modal Sandboxes | Daytona | Lambda / Workers |
| --- | --- | --- | --- | --- | --- |
| Isolation | microVM, nested Docker inside | [Firecracker microVM](https://docs.e2b.dev/template/how-it-works) | [gVisor or VM runtime](https://modal.com/docs/guide/sandboxes.md) | [containers, Linux/Windows VMs, GPU containers](https://www.daytona.io/docs/en/isolation/) | function runtime / isolate |
| Ready to exec | **2.0–3.5 s measured** (plain image); 5 parallel in 3.2 s; cold custom Kit 505 s | ~80 ms is [loading a prepared snapshot](https://docs.e2b.dev/template/how-it-works), not the same metric | ~1 s container boot ([cold start](https://modal.com/docs/guide/cold-start.md)) | sub-second for eligible snapshot configurations | warm invoke in ms |
| Lifetime | TTL, CLI extensions up to 24 h from creation; resume starts a new TTL | 24 h (Pro) continuous, reset by pause/resume ([lifetime](https://docs.e2b.dev/faq/sandbox-lifetime)) | 5 min default, 24 h max ([sandboxes](https://modal.com/docs/guide/sandboxes.md)) | depends on stop/archive/delete config | [Lambda 15 min](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html); [Workers](https://developers.cloudflare.com/workers/platform/limits/) CPU-limited, `waitUntil` ≤30 s |
| Memory/process state | stop/resume keeps memory and PIDs (measured) | [pause keeps memory and processes, kept indefinitely](https://docs.e2b.dev/sandbox/persistence) | filesystem snapshots | [VM pause/resume keeps memory; containers keep disk only; GPU deleted on stop](https://www.daytona.io/docs/en/persistence/) | no retained in-process job state |
| GPU | none | none | yes ([GPU guide](https://modal.com/docs/guide/gpu.md); gVisor runtime only) | [NVIDIA/AMD GPU sandboxes](https://www.daytona.io/docs/en/gpu-sandboxes/) | none |
| Nested Docker | yes, with a documented nested exec/Compose caveat | [official template](https://docs.e2b.dev/template/examples/docker) | VM runtime | VM sandboxes | no |
| Egress control | per-sandbox domain allow/deny, logged | network settings | [per-sandbox egress policy](https://modal.com/docs/guide/sandbox-networking.md) | [CIDR allow list / block all](https://www.daytona.io/docs/en/isolation/) | VPC / none |
| Client | `sbx` CLI, REST, TS SDK | Python/JS SDK | Python, [JS and Go SDKs](https://modal.com/docs/guide/sdk-javascript-go.md) | Python/TS/Ruby/Go/Java SDKs | n/a |

Cloudflare's own [Sandboxes](https://developers.cloudflare.com/sandbox/) product
was not evaluated.

## Retry-safe handoff

The orchestrator, not the sandbox, owns the job:

1. Persist a stable job ID before provisioning.
2. Create the sandbox with an idempotency key derived from the job ID, and start
   the job process with a second, separate key
   ([Docker cookbook](https://docs.docker.com/ai/sandboxes-api/cookbook/retry-without-creating-duplicates/)).
   After an ambiguous response, retry with the same key, then reconcile the
   sandbox and process names before doing anything else.
3. Run this inside an Inngest step or queue consumer and await the durable
   enqueue before the trigger returns. Inngest steps
   [can repeat a side effect](https://www.inngest.com/docs/durable-execution/guides-and-advanced/idempotency),
   which is why the keys matter.
4. The job writes results to object storage, then marks completion through a
   signed callback (allow the callback domain in egress policy) or the
   orchestrator polls. Completion handling must be idempotent.
5. Clean up the sandbox on success or on a timeout the orchestrator owns.

Measured with the SDK (a same-key replay, not an induced network loss):

| Call | First | Same-key replay | Result |
| --- | --- | --- | --- |
| `client.create(payload, { idempotencyKey })` | 2.15 s | 0.11 s | same sandbox name |
| `sandbox.processes.start(cmd, { idempotencyKey })` | 0.35 s | 0.06 s | same process name; command ran once |

Exec during `stopping` failed with `ResourceWaitError: The endpoint is not ready`,
and delete during `stopping` returned 409 `failedPrecondition`: wait for
`stopped` before either.

Earlier probe (detachment only, no failure paths): from Node, create 2.5 s,
first exec 0.5 s, 1 MiB upload 0.39 s / download 0.18 s, delete 0.5 s; a fresh
Node process reconnected by name in 0.28 s and read a detached job's output.
`sandbox.run()` collects output; `processes.start()` + `connect()` streams it.

## Other handoffs

- **Fetch outside, process inside.** An authorized source step fetches media
  within the source's [terms](https://www.youtube.com/t/terms) and writes it to
  a short-lived object URL; the sandbox reads that URL. Source credentials never
  enter the processing sandbox or its templates. Cookies or other egress were
  not validated as a fix.
- **CPU → GPU.** CPU sandbox cuts and remuxes; segments needing NVENC or a larger
  Whisper model go to the GPU platform through object storage. Verify the codec
  with a real encode first; compare end-to-end time including transfer before
  splitting short jobs. CPU encoding stays the video fallback.
- **Pausing agent sessions.** On Docker Cloud set an explicit `on_timeout` and
  enable [auto-resume](https://docs.docker.com/ai/sandboxes-api/cookbook/let-a-stopped-sandbox-resume-on-demand/);
  wait for `stopped` before exec (an exec during `stopping` failed in the trial).
  Volume-backed sandboxes cannot stop, so checkpoint important state outside the
  sandbox. The 24 h ceiling is per CLI TTL extension window, not a guarantee of a
  single uninterrupted run.

Share data through object storage or HTTPS, not volumes: Docker Cloud volumes
are experimental and snapshot only on exit.

## Calling from Lambda and Cloudflare Workers

- `@docker/sandboxes` 0.53.0 documents [Node ≥20](https://docs.docker.com/ai/sandboxes-api/install/),
  so Lambda (Node) is the supported caller.
- Direct Workers → SDK is **experimental**: a `--conditions=worker` esbuild bundle
  built (357 KB; plain neutral fails on `node:*` builtins) but auth, create and
  detached start were not run in workerd. Until they are, use Workers → Queue →
  Node dispatcher.
- `npm audit` flags the SDK's pinned `undici@6.28.1` (1 moderate, 1 high).

## Not measured

- Any E2B, Modal, Daytona, Lambda or Workers run.
- Production fan-out (default 10 concurrent / 50 stored; only 5 parallel creates
  tested), real orchestrator callbacks, xl size, `--capture-mode all` templates,
  volumes, GPU encode paths, authenticated Amp model runs, an actual orb, cost per job.
