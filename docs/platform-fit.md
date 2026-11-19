# Docker Cloud Sandboxes alongside E2B, Modal, Daytona and Lambda

Which workload goes on which platform, and how work passes between them.
Docker Cloud numbers are measured (see [cloud-sandboxes.md](cloud-sandboxes.md)
from PR #4, plus the SDK handoff probe below). E2B, Modal, Daytona and Lambda
figures are from their public docs and were **not** measured here; no API keys
for those platforms were available in this trial.

## Short answer

Docker Cloud Sandboxes is a good general-purpose **CPU** sandbox: 2–3 s create,
memory-and-process-preserving stop/resume, nested Docker, per-sandbox egress
policy and public HTTPS ports. It does not replace a GPU platform (no GPU) or a
residential-IP fetcher (YouTube bot-checks it), and it is not the cheapest place
for sub-second stateless calls. Use it as the default home for stateful agent
and runner work, keep E2B where you already depend on its ~sub-second create
and mature SDK, send GPU work to Modal, and keep Lambda/Workers as the thin
trigger layer that creates sandboxes and never runs the heavy job itself.

## Where each workload belongs

| Workload | Primary | Why | Fallback |
| --- | --- | --- | --- |
| Coding agent harnesses (Amp, Codex, Claude) | **Docker Cloud** | Kit v3 images, nested Docker for repo tests, stop/resume keeps the agent process (PID kept across resume), per-sandbox egress policy | E2B (existing templates) |
| Amp runner / orb daemon | **Docker Cloud** | Detached daemons survive exec disconnect and stop/resume; public HTTPS port for callbacks; auto-resume on exec | Daytona (persistent workspaces) |
| CPU video encoding (H.264/HEVC) | **Docker Cloud** large/xl | Large: 1080p60s H.264 in 16.7 s (3.6x realtime), HEVC 2.0x; billed per second, stop = no compute bill | Modal CPU for fan-out of many segments |
| GPU encoding (NVENC), Whisper large/medium | **Modal** | Docker Cloud has no GPU device; Modal offers GPU functions/sandboxes (documented) | Docker Cloud CPU with tiny/base model |
| Transcription, small models | **Docker Cloud** | faster-whisper tiny.en ran 17.6x realtime on CPU | Modal GPU for long backlogs |
| YouTube audio retrieval (yt-dlp) | **Not a cloud sandbox** | Docker Cloud IP got "Sign in to confirm you're not a bot"; expect the same on any datacenter IP (E2B/Modal/Daytona/Lambda were not tested) | Fetch with cookies or a residential/proxy egress, hand the audio file to the sandbox |
| Browser automation (agent-browser) | **Docker Cloud** or E2B | Chrome install 2.9 s, first open 0.64 s; CJK fonts needed | E2B if a template already exists |
| Webhook intake, scheduling, fan-out | **Lambda / Cloudflare Workers** | Stateless, ms-scale, cheap; they only call sandbox SDKs | Inngest steps |
| Long-lived dev environment a human opens | **Daytona** | Built around persistent workspaces with IDE/preview (documented) | Docker Cloud with TTL extension (max 24 h from creation) |

## Platform roles

| | Docker Cloud Sandboxes | E2B | Modal | Daytona | Lambda / Workers |
| --- | --- | --- | --- | --- | --- |
| Isolation | microVM per sandbox, nested Docker inside | Firecracker microVM | gVisor containers | containers (docs) | function runtime |
| Create (this trial vs docs) | **2.0–3.5 s measured**; 5 parallel in 3.2 s | sub-second (docs) | ~1 s cold (docs) | sub-second (docs) | ms (warm) |
| Max lifetime | TTL, extensions up to 24 h from creation; stop/resume | session limit by plan (docs) | per-function timeout (docs) | persistent until stopped/archived | Lambda 15 min; Workers CPU-time limited |
| State | stop/resume keeps memory and PIDs; disk templates | pause/resume (docs) | volumes, memory snapshots (docs) | persistent disk | none |
| GPU | **none** | none | yes | not relied on here | none |
| Nested Docker | **yes**, with a documented exec/Compose caveat | via template | not by default (docs) | not checked | no |
| Egress control | per-sandbox deny/allow domain policy, logged | template/network settings | per-function | per-sandbox | VPC/none |
| Inbound | public HTTPS port per sandbox | host URL per port | web endpoints/tunnels | preview URLs | function URL |
| Client | `sbx` CLI, REST, TS SDK `@docker/sandboxes` | Python/JS SDK | Python-first SDK | Python/TS SDK | n/a |

## Handoff patterns

1. **Trigger → sandbox (fire and forget).** A Lambda/Worker/Inngest step creates
   a sandbox, uploads inputs, starts the job detached, stores the sandbox name and
   returns. Measured with the TS SDK from Node: create 2.5 s, first exec 0.5 s,
   1 MiB upload 0.39 s, download 0.18 s, delete 0.5 s. A **fresh** Node process
   reconnected by name in 0.28 s and read the detached job's result, so the
   caller never has to outlive the job.
2. **Sandbox → callback.** The job ends by POSTing to the orchestrator (Inngest
   event, Worker URL), or publishes a port that the orchestrator polls. Allow the
   callback domain in the sandbox egress policy; ports are public, so
   authenticate them.
3. **Fetch outside, process inside.** For YouTube, a step with cookies or proxy
   egress downloads the audio, puts it in object storage (presigned URL), and the
   Docker Cloud sandbox transcribes it. This keeps cookies out of sandbox images
   and templates.
4. **CPU vs GPU split.** Docker Cloud does decode, cut, remux and CPU encodes;
   segments that need NVENC or a large Whisper model go to a Modal GPU function
   through object storage, and results return the same way.
5. **Burst vs stateful.** Many short independent jobs: fan out to fresh micro
   sandboxes (5 in 3.2 s, no 429s at that scale; documented default is 10
   concurrent / 50 stored) or keep them on E2B. Agent sessions that pause for
   human input: stop the Docker sandbox (no compute bill while stopped) and let
   the next exec auto-resume it (~1.2–1.3 s).

Pass data between platforms through object storage or HTTPS, never through a
shared volume: Docker Cloud volumes are experimental and snapshot only on exit.

## Calling from Lambda and Cloudflare Workers

- `@docker/sandboxes` 0.53.0 bundles for Node (Lambda) and, with the `worker`
  export condition, for Workers-style runtimes: `esbuild --platform=neutral
  --conditions=worker` produced a 357 KB bundle, while a plain neutral bundle
  failed on `node:net`, `node:crypto`, `node:fs`. Neither bundle was run inside
  Lambda or workerd.
- `sandbox.run()` returns collected output; for live logs use
  `processes.start()` + `connect()` (first chunk after 133 ms). In a time-limited
  function, start detached and return instead of streaming.
- Authenticate with `pat({username, personalAccessToken})` from a secret store;
  the SDK keeps tokens in memory.
- `npm audit` flags the SDK's pinned `undici@6.28.1` (1 moderate, 1 high);
  track SDK updates before production.

## Not measured

- Any E2B, Modal, Daytona, Lambda or Workers run; their figures above are documented claims.
- Real orchestrator callbacks, xl size, `--capture-mode all` templates, volumes,
  authenticated Amp model runs, and cost per job (no published per-size rate seen).
