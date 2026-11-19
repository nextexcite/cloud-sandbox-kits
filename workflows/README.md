# Cloud Sandbox workflows

Reference implementation for Node 24 + npm. No deployed Worker is required in this step.

```sh
cd workflows
npm ci
# Export DOCKER_ID and DOCKER_CLOUD_SANDBOX_TOKEN securely in this shell.
# Neither value is passed to sandbox commands or saved by this application.
npm run check
npm test
SBX_BIN=/absolute/path/to/sbx CLOUDFLARED_BIN=/absolute/path/to/cloudflared npm run e2e
```

`sbx` must be on PATH and separately logged in for the harness's final CLI listing.
Alternatively set `SBX_BIN` to its absolute path. `SANDBOX_IMAGE` optionally overrides
`ubuntu:24.04` (a digest reference is supported). Download cloudflared from the
official GitHub release (`cloudflared-linux-amd64` for this VM); no Cloudflare
account is required. The harness refuses occupied ports, starts Express on :3000,
Inngest dev on :8288, Wrangler/workerd on :8787, and a cloudflared quick tunnel.
It submits browser, six-second H.264+HEVC encode, 2m41s Gettysburg Address audio
transcription, and YouTube transcription jobs through the public Worker URL.
It polls that same Worker's status API and reads final outputs from Inngest's
GraphQL API. It stops its child process groups and deletes only owned sandbox
names on completion/error. Logs, PNGs, MP4s and JSON results are gitignored in
`out/`. Only the authenticated Worker is tunneled; never expose the unauthenticated
Inngest/Express dev services themselves.

On this VM, the system DNS resolver initially cached NXDOMAIN for new quick-tunnel
names. `TUNNEL_DNS_SERVER=1.1.1.1` optionally resolves only tunnel hosts using that
resolver in the harness, caching the first successful answer. TLS hostname and
certificate verification remain enabled. This does not alter system DNS.

To run manually, use `INNGEST_DEV=1 npm run dev` and the Inngest command above in
separate terminals. POST `{"name":"browser/capture","data":{"url":"https://example.com"}}`
to `http://localhost:8288/e/test`.

## Design

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
expiry; Wrangler emulates and persists it locally. The placeholder namespace ID
in the config is for local use, not an actual Cloudflare resource. Provision KV
before a real deployment. Set `INNGEST_EVENT_URL=https://inn.gs` and
`INNGEST_EVENT_KEY` for cloud event ingestion, and the appropriate API URL/signing
key for status access. Event ingestion requires no code change. Cloud status API
behavior and a real deployment have not been tested.

Media functions have durable create/install, detached launch, wait, read-artifact,
and delete steps. The callback wait is scheduled in parallel with launch so an
early callback is not lost between sequential steps. The remote Python process
runs under `nohup` with detached stdio. Inngest releases the request while waiting
up to 25 minutes for `sandbox/job.finished`, matched on `data.jobId`.

The sandbox gets a per-job HMAC key derived from the shared startup secret, never
the shared secret itself. It signs exact callback JSON bytes with SHA-256 in
`x-sandbox-signature`. The Worker verifies with Web Crypto, enqueues a deterministic
callback event ID, and marks the callback accepted. Retries are idempotent within
Inngest's event-deduplication window; KV is not an atomic exactly-once lock.
Callbacks retry with bounded exponential backoff. The sandbox egress policy
explicitly includes `*.trycloudflare.com` alongside the reference's allow-all.

Remote result JSON and encode SHA-256 values are read after the callback. Small
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
