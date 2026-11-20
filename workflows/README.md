# Cloud Sandbox workflows

Reference implementation for Node 24 + npm. No deployed Worker is required in this step.

```sh
cd workflows
npm ci
# Export DOCKER_ID and DOCKER_CLOUD_SANDBOX_TOKEN securely in this shell.
# Neither value is passed to sandbox commands or saved by this application.
npm run check
npm test
python3 -m unittest discover -s src -p test_media_runner.py
SBX_BIN=/absolute/path/to/sbx CLOUDFLARED_BIN=/absolute/path/to/cloudflared npm run e2e
```

`sbx` must be on PATH and separately logged in for the harness's final CLI listing.
Alternatively set `SBX_BIN` to its absolute path. `SANDBOX_IMAGE` optionally overrides
`ubuntu:24.04` (a digest reference is supported). Download cloudflared from the
official GitHub release (`cloudflared-linux-amd64` for this VM); no Cloudflare
account is required. The harness refuses occupied ports, starts Express on :3000,
Inngest dev on :8288, Wrangler/workerd on :8787, and a cloudflared quick tunnel.
It submits browser, six-second H.264+HEVC encode, 2m41s Gettysburg Address audio
transcription, and YouTube transcription jobs through the public Worker URL,
plus a bad-source encode that must show `Failed` through `GET /jobs/:id`.
`YT_COOKIES` and `YT_PROXY` are explicitly removed from child environments for
this test, and the YouTube result must be exactly `needs_cookies`.
It polls that same Worker's status API and reads final outputs from Inngest's
GraphQL API. It prints and saves the sandbox listing **before** its fallback
cleanup sweep and fails if a workflow sandbox remains at that point. It compares
pre-existing sandbox IDs/statuses before and after, stops its child process groups,
and sweeps only names it created. Sanitized `out/e2e-results.json` includes the
commit, model, timing statistics, output SHA-256s and pre-sweep listing, not bearer
tokens, callback secrets, tunnel credentials, source URLs or full transcripts.
Logs, PNGs, MP4s and JSON results are gitignored in
`out/`. Only the authenticated Worker is tunneled; never expose the unauthenticated
Inngest/Express dev services themselves.

`npm run check` runs TypeScript's `tsc --noEmit`; it does not run tests. TypeScript
tests run with `npm test`; Python runner regressions use the unittest command above.

On this VM, the system DNS resolver initially cached NXDOMAIN for new quick-tunnel
names. `TUNNEL_DNS_SERVER=1.1.1.1` optionally resolves only tunnel hosts using that
resolver in the harness, caching the first successful answer. TLS hostname and
certificate verification remain enabled. This does not alter system DNS.

To run manually, use `INNGEST_DEV=1 npm run dev` and the Inngest command above in
separate terminals. POST `{"name":"browser/capture","data":{"url":"https://example.com"}}`
to `http://localhost:8288/e/test`.

## Deployed mode

Requires Node 24, npm, and Docker Cloud access on the deploying Linux machine.
Run commands from `workflows/`. Cloudflare/Inngest keys must belong to the same
accounts/environments throughout a deployment. Do not run two deploy/teardown
commands concurrently. This creates billable resources.

| Environment variable | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Wrangler deployment, Workers scripts/subdomain access, and KV namespace create/list/delete permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Target Cloudflare account |
| `INNGEST_EVENT_KEY` | Inngest Cloud event ingestion, injected as a Worker secret |
| `INNGEST_SIGNING_KEY` | Node request verification/app registration and Worker's Cloud REST status access; environment signing key, not event key |
| `DOCKER_ID`, `DOCKER_CLOUD_SANDBOX_TOKEN` | SDK PAT authentication on the deploy machine and in the hosted Node process |

Supply these through your secret manager/environment, not command-line literals.
In Devin exec, bind the Docker variables to `secret:personal:DOCKER_ID` and
`secret:personal:DOCKER_CLOUD_SANDBOX_TOKEN`; never print their values.

```sh
npm ci
npm run deploy
npm run e2e:deployed
# Delete only the recorded host; keep Worker, KV, local tokens and ownership record:
npm run deploy -- teardown
# Delete recorded host AND the deployment's unique Worker/KV, remove local tokens/state:
npm run deploy -- teardown --all
```

Deploy prints only the Worker and host HTTPS URLs. It generates a unique Worker,
KV namespace and `wf-host-<timestamp>` host name, recording ownership in
`out/deployment.json`. Re-running reuses the recorded resources, redeploys source
and restarts Node. Ambiguous KV creates are reconciled by the deployment's unique
title; host creates use an idempotency key. Keep this record: teardown never
bulk-deletes or adopts arbitrary account resources. Back it up securely alongside
`out/deployment-secrets.json`; both are gitignored, mode 0600. The latter contains
the once-generated `FRONTDOOR_TOKEN` and `CALLBACK_SECRET`. Do not delete it to
rotate tokens while jobs are running. A missing file after deployment is an error.
Stop submitting jobs and let existing jobs finish before host teardown/redeploy.
Optional Worker/KV teardown also destroys job-status records. Teardown does not
remove unrelated job sandboxes or unregister the app in Inngest Cloud.

The generated `out/wrangler-deployed.json` binds real KV, enables workers.dev,
sets `INNGEST_EVENT_URL=https://inn.gs` and
`INNGEST_API_URL=https://api.inngest.com`. All four sensitive Worker settings
(`FRONTDOOR_TOKEN`, `CALLBACK_SECRET`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`)
are uploaded with Wrangler's `--secrets-file`, not stored in config. Its temporary
`out/worker-secrets-upload.json` has mode 0600 and is removed in `finally`;
remove it manually if the deploy process is forcibly killed. It contains Inngest
keys, never Docker credentials. Node subprocess stdin is a socket on Linux and
cannot be reopened as `/dev/stdin` by Wrangler's file reader.
The checked-in `worker/wrangler.jsonc` remains the local-only config used by
`npm run e2e`; never deploy its placeholder KV ID.

The host installs Node 24 and the locked app dependencies, copies only package
files and `src/`, then starts `tsx src/server.ts` using `nohup`/`setsid`.
Node binds `0.0.0.0`, honors `PORT` (3000 by default), and receives
`INNGEST_SIGNING_KEY`, `INNGEST_SERVE_ORIGIN` and `INNGEST_SERVE_PATH`;
`INNGEST_DEV` is explicitly unset. Its native published HTTPS port exposes only
the Express health/Inngest endpoints. Do not run the Inngest dev server there.
Docker credentials are injected through SDK exec environment **only when starting
the host process**, never written into the image, app, startup script or repo.
They live in the host sandbox's process environment, readable to privileged
processes in that sandbox. The same applies to its Inngest/callback secrets.
Protect host access; do not dump process environments or logs containing secrets.
Wrangler subprocesses do not inherit Docker credentials.

Deployment sets `CALLBACK_PUBLIC_URL` to the deployed Worker origin; the sandbox
egress policy explicitly includes that hostname (also supporting local tunnels).
The demonstration still permits arbitrary egress via `*`; this is not an SSRF-safe
public service. Keep the generated front-door bearer private.

After host health is ready, deploy sends `PUT https://<host>/api/inngest`.
In installed Inngest 4.26.2, `InngestCommHandler` handles this as an out-of-band
sync and registers with Inngest Cloud's `/fn/register` using the hashed signing
key. Unauthenticated PUT sync is enabled by default; this request cannot choose
the registration destination. `INNGEST_SERVE_ORIGIN` ensures the registered URL
uses the public native host URL. GET introspection does not prove registration.
Worker status already uses `GET https://api.inngest.com/v1/events/{id}/runs`
with the environment's signing key as Bearer, as documented in
[Inngest's status example](https://www.inngest.com/docs/examples/fetch-run-status-and-output).

The host requests a 24-hour delete TTL (the CLI enforces a maximum of 24 hours).
Inspect/extend it with `sbx --cloud ttl wf-host-<timestamp>` and
`sbx --cloud ttl +24h wf-host-<timestamp>` before expiry. This is a long-lived
reference host, not automatic renewal, process supervision or artifact backup:
`nohup` survives exec disconnects, not a host reboot/crash. Re-run deploy to
restart the app. Host `out/` contains screenshots/media and logs; copy needed
artifacts securely before teardown. Job sandboxes retain their one-hour delete
TTL as a final backstop.

The deployed test exercises browser, default testsrc2 encode, public-MP4 encode,
Gettysburg speech transcription and a bad-source encode. **No YouTube job is
submitted.** The MP4 fixture is
`https://media.w3.org/2010/05/sintel/trailer.mp4` (4,372,373 bytes; verified with
curl during preparation). `SPEECH_URL` may override speech with audio >=120 s.
Each case polls the Worker's authenticated status API and checks the result.
The cancellation case starts a 120-second HEVC job on micro, waits for detached
launch, cancels via `DELETE https://api.inngest.com/v1/runs/{runID}`, then asserts
Cancelled and sandbox absence **before** fallback cleanup. A separate
`inngest/function.cancelled` handler cleans up exact media job names; neither a
cancelled run's `finally` steps nor `onFailure` are assumed to execute. This follows
[Inngest's cancellation cleanup guidance](https://www.inngest.com/docs/examples/cleanup-after-function-cancellation).
TTL remains the backstop for cancellation races/host loss.

The test fails if any `wf-` job sandbox remains (excluding the recorded host),
including pre-existing workflow jobs; run in a quiescent account. It never deletes
pre-existing sandboxes. Evidence is written before fallback cleanup to
`out/e2e-deployed-results.json` with unrelated sandbox names/IDs masked, no bearer
tokens or full transcripts. SIGINT/SIGTERM trigger bounded cleanup after the
current request/poll. SIGKILL cannot run cleanup; TTL still applies.

Key-free host smoke test (also billable; teardown afterwards):

```sh
npm run deploy -- host-only
# Prints native host HTTPS URL; saves GET /api/inngest evidence to out/host-dry-run.json.
# No Docker/Inngest/Cloudflare secrets are injected into this host-only app.
# Inngest 4.26.2 returns HTTP 500 without a signing key; the smoke test also checks
# the remote server's explicit cloud-mode/missing-signing-key diagnostic.
npm run deploy -- teardown
```

Deployment verification record (fill after provisioning keys):

* Worker/KV deployment and secrets: **not yet tested**.
* Inngest Cloud sync and authenticated status: **not yet tested**.
* Deployed workload/cancellation tests: **not yet tested**.
* Host-only HTTPS introspection: **see preparation report / out/host-dry-run.json**.

## Design details

* The official SDK (`@docker/sandboxes` 0.53.0) covers image references, named compute
  sizes, TTL, policies, exec, binary files and deletion. No REST fallback is needed.
  PAT authentication performs the credential exchange in memory.
* SDK create options are `resources: "large"`, `lifecycle.timeoutMs` and
  `network.policies`; the lower-level API uses CPU/memory and protobuf durations.
  Network policies use `mode: "denyAll"` plus `allowNetworks: ["*"]` for this
  arbitrary-URL demonstration. Account-level restrictions still apply.
* `sandbox.run()` returns stdout, stderr, exitCode and incomplete; nonzero exit is
  not itself an SDK exception. Calls have client-side timeouts. Timeout is not a
  remote kill guarantee; deleting the sandbox terminates remaining work.
* Observed SDK gotcha: `waitUntilDeleted()` can throw `ResourceWaitError` caused by
  `NotFoundError` after successful deletion. The adapter treats only that absence
  as success; other wait errors remain failures.
* One Inngest durable step owns creation through capture and deletion in a
  `try/finally`. This avoids replaying cached create steps against already-deleted
  sandboxes. Function retries are disabled. A 30-minute server TTL with action
  `delete` is the backstop for host termination (which cannot execute JS finally).
  This is not a production cancellation/reconciliation design. Ambiguous create
  responses can still require TTL cleanup; requests use an idempotency key.
* Every name starts `wf-`; deletion refuses other names and uses only the handle
  it created. The harness checks for leftovers but never bulk-deletes by prefix.
* Cold installation includes Node 24, agent-browser 0.43.0, Chrome dependencies
  and Noto CJK. Setup time dominates capture; a prepared image is the next obvious
  optimization. Returned `screenshotBytes` is a byte count, not base64 in Inngest
  state; the actual binary is downloaded through SDK files and saved in `out/`.

## Cloudflare Workers finding

The package **has** Node-only dependencies (`ws`, `undici`, `formidable`), but its
conditional `worker`/`browser`/`edge-light` internal imports select web-compatible
platform and stream implementations. It is not accurate to reject it solely
from the dependency list.

Verified a browser-platform esbuild bundle with `--conditions=worker` and a local
Wrangler/workerd request **without nodejs_compat**: importing the package,
constructing a PAT-authenticated client and closing it returned `SDK_IMPORT_PASS`.
That original probe intentionally makes no authenticated cloud requests. Step 2's
authenticated probe is now isolated in `scripts/sdk-probe.ts`, not the front door.
Run it separately on localhost only, with Docker credentials in the environment:

```sh
npx wrangler dev --config scripts/sdk-probe.wrangler.jsonc --port 8788 --local
# In another terminal:
curl http://localhost:8788
```

The front-door Worker has no Docker SDK import or Docker secret bindings. The
standalone probe **fails before sending the PAT
exchange request** with `AuthenticationError`, code `unauthenticated`, and
`patFetchAttempted: false`. The SDK constructs requests using `redirect: "error"`;
workerd rejects this option. A separate synthetic request reproduced the precise
error, and changing only redirect to `manual` succeeds. Thus successful import
does not establish authenticated compatibility: SDK 0.53.0 is **not usable
unmodified for this authenticated flow in the tested Workers runtime**. The SDK
constructs its Request before invoking an injected fetch, so replacing fetch
alone does not avoid this constructor error. Node orchestration remains the
working control plane; the Worker uses ordinary fetch for Inngest and Web Crypto
for callbacks. No global Request patch or SDK fork was introduced.

Scoped WebSocket exec/file operations
and deployed Workers compatibility remain unverified. Browser platform code requires advertised
scoped WebSocket subprotocol credentials; multipart helpers, file-based OAuth
storage and Unix sockets explicitly require Node. Workers cannot execute the local
`sbx` CLI or write screenshots to this local filesystem.

```sh
npx esbuild src/worker-probe.ts --bundle --platform=browser --conditions=worker \
  --format=esm --outfile=out/worker-probe.js
npx wrangler dev src/worker-probe.ts --port 8787 --local \
  --compatibility-date 2026-11-19
curl http://localhost:8787 # import + Request-option compatibility diagnostics
```

Dependency caveat: npm currently reports upstream OpenTelemetry peer-range
conflicts through Inngest and nine audit findings (six moderate, three high).
These are not an unloaded shell environment; no repository environment setup is
needed. A trial pin/override did not resolve the upstream mixed-major tree and
was removed. No force audit upgrade is applied to this reference.

## Worker API and detached media jobs

`worker/wrangler.jsonc` runs locally with no account and no `nodejs_compat`.
Wrangler reads only `FRONTDOOR_TOKEN` and `CALLBACK_SECRET` from the child process
environment. Docker credentials are needed only by the Node app, not the Worker;
the harness removes them from Wrangler's environment. The harness generates fresh `FRONTDOOR_TOKEN` and
`CALLBACK_SECRET` in memory at startup and never logs them. For manual runs, set
those variables consistently in the Worker and Node app, and set the Node app's
`CALLBACK_PUBLIC_URL` to the quick tunnel origin.

* `POST /jobs/browser`: `{ "url": "https://example.com" }`
* `POST /jobs/encode`: `{ "durationSec": 6, "codecs": ["h264", "hevc"], "size": "large" }`
  (optional `sourceUrl`; default source is 720p24 testsrc2)
* `POST /jobs/transcribe`: exactly one of `audioUrl` or `youtubeUrl`, plus optional
  `model` (`tiny`, `tiny.en`, `base`, `base.en`).
* `GET /jobs/:jobId`: proxies the submitted event's Inngest runs.
* `POST /callbacks/sandbox`: HMAC-authenticated callback, not bearer authenticated.

Jobs/status require `Authorization: Bearer <FRONTDOOR_TOKEN>`. Job submission
returns `{jobId, inngestEventIds}`. The registry is in Workers KV with one-day
expiry; the pending record is written before event submission, and a failed send
is marked failed. Wrangler emulates and persists it locally. The placeholder namespace ID
in the config is for local use, not an actual Cloudflare resource. Provision KV
before a real deployment. Set `INNGEST_EVENT_URL=https://inn.gs` and
`INNGEST_EVENT_KEY` for cloud event ingestion, and the appropriate API URL/signing
key for status access. Event ingestion requires no code change. Cloud status API
behavior and a real deployment have not been tested.

The pending record, submission receipt/failure and callback receipt use separate
KV keys. Each is written once in the normal path, avoiding Workers KV's one-write
per second limit on a single key even when Inngest acknowledges immediately.

If Inngest accepts the event but the submission receipt write fails, the Worker
still returns 202 with the job ID, the Inngest event IDs and a `warning`, and
retries the write in the background three times. If all three retries fail,
`GET /jobs/:id` returns `{"data": []}` (404 after the 24 h record TTL) and never
shows the run, even
though the run proceeds. Use the returned event ID to query Inngest directly in
that case.

Media functions have durable create/install, detached launch, wait, read-artifact,
and delete steps. The callback wait is scheduled in parallel with launch so an
early callback is not lost between sequential steps. The remote Python process
runs under `nohup` with detached stdio. Inngest releases the request while waiting
up to 25 minutes for `sandbox/job.finished`, matched on `data.jobId`.

The sandbox gets a per-job HMAC key derived from the shared startup secret, never
the shared secret itself. It signs exact callback JSON bytes with SHA-256 in
`x-sandbox-signature`, with `x-sandbox-job-id` selecting the per-job key. The Worker
reads at most 64 KiB regardless of Content-Length, verifies the exact raw bytes
with Web Crypto before decoding JSON, then checks that the signed job ID matches
the header. It enqueues a deterministic
callback event ID, and marks the callback accepted. Retries are idempotent within
Inngest's event-deduplication window; KV is not an atomic exactly-once lock.
Callbacks retry with bounded exponential backoff. The sandbox egress policy
explicitly includes `*.trycloudflare.com` alongside the reference's allow-all.

Remote result JSON and encode SHA-256 values are read after the callback. Small
callbacks contain only job ID, status and allowlisted numeric timing/duration
stats; full transcripts, output records and failure details stay in the artifact.
Small
MP4 outputs are copied back and checksummed locally; outputs above 5 MB produce
a 256 KiB sample instead. SDK file reads default to only 1 MiB; the adapter now
explicitly allows up to 16 MiB per read. Success, workload failure and timeout run cleanup, with
`onFailure` reconciliation by exact job name and one-hour TTL action `delete` as
additional safeguards. Cancellation/host loss still relies on reconciliation or
TTL; this is a reference rather than a production cancellation service.

For YouTube, optional `YT_COOKIES` contains Netscape cookie-file **content**, not
a path. It is written at runtime inside the sandbox with mode 0600. Optional
`YT_PROXY` is passed to yt-dlp. Neither is baked into images or printed, and raw
yt-dlp stderr is never returned. Bot checks/403/429 produce `needs_cookies`;
unrelated download errors produce `failed`. CPU faster-whisper uses ffmpeg-decoded
float32 PCM to avoid PyAV compatibility issues observed in the initial trials.
The harness defaults to a public LibriVox Gettysburg Address MP3; `SPEECH_URL` may
override it with another speech recording at least two minutes long.

## Security scope

The bearer token is the only gate on an arbitrary-URL fetcher with `*` sandbox
egress. This is not a public multi-tenant service or an SSRF-safe URL gateway;
keep the token private and do not expose the unauthenticated local dev servers.
The front-door Worker has no Docker credentials.

The per-job HMAC key and any supplied YouTube cookies live in the sandbox until
deletion. `YT_PROXY` appears in yt-dlp's process argv and may contain proxy
credentials; it is not returned or intentionally logged. Only use trusted jobs
and sandbox code. `withSandbox` guarantees a **delete attempt**, not successful
deletion under every network/host failure. TTL deletion is the backstop, with
explicit cleanup/onFailure reconciliation providing the normal path.
