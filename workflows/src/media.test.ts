import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NonRetriableError } from "inngest";
import { cancelledMediaCondition, cleanupCancelledMedia, mediaFunctions, requestedOutputs } from "./media.js";
import { inngest } from "./capture.js";
import { Sandboxes, type Sandbox } from "@docker/sandboxes";
import { SandboxClient } from "./sandbox.js";

test("cancellation trigger derives registered function IDs from the app ID", () => {
  assert.equal(cleanupCancelledMedia.opts.triggers?.[0].if, cancelledMediaCondition(inngest.id));
  assert.equal(cancelledMediaCondition("another-app"), 'event.data.function_id == "another-app-media-encode" || event.data.function_id == "another-app-media-transcribe"');
  assert.equal(cancelledMediaCondition(""), 'event.data.function_id == "media-encode" || event.data.function_id == "media-transcribe"');
  assert.equal(cancelledMediaCondition('app"quoted'), 'event.data.function_id == "app\\"quoted-media-encode" || event.data.function_id == "app\\"quoted-media-transcribe"');
});

test("artifact codec names come only from requested enums", () => {
  const output = { path: "/root/h264.mp4", codec: "../../x", bytes: 1, sha256: "hash" };
  assert.equal(requestedOutputs(["h264"], [output])[0].codec, "h264");
  assert.deepEqual(requestedOutputs(undefined, [output]), []);
  assert.throws(() => requestedOutputs(["../../x"], [output]), /Invalid requested codec/);
  assert.throws(() => requestedOutputs(["hevc"], [output]), /Requested output missing/);
});

test("media runner failures reject the function and always schedule cleanup", async () => {
  for (const status of ["completed", "needs_cookies", "timeout"]) {
    const steps: string[] = [];
    const result = { status, result: {} };
    const handler = Reflect.get(mediaFunctions[0], "fn") as (context: unknown) => Promise<unknown>;
    const run = handler({ event: { data: { jobId: "11111111-1111-1111-1111-111111111111" } }, step: {
      run: async (id: string) => {
        steps.push(id);
        if (id === "create-install-detach") return { name: "test", timings: {} };
        if (id === "read-artifacts") return result;
        return {};
      },
      waitForEvent: async () => status === "timeout" ? null : { data: { status } },
    } });
    if (status === "timeout") await assert.rejects(run, /timed out/);
    else assert.equal(await run, result);
    assert.equal(steps.filter((id) => id === "delete-sandbox").length, 1);
  }
});
test("real artifact step raises runner failure before demanding encode outputs", async () => {
  const previous = { DOCKER_ID: process.env.DOCKER_ID, DOCKER_CLOUD_SANDBOX_TOKEN: process.env.DOCKER_CLOUD_SANDBOX_TOKEN };
  process.env.DOCKER_ID = process.env.DOCKER_CLOUD_SANDBOX_TOKEN = "test-only";
  const jobId = "11111111-1111-1111-1111-111111111111";
  let deleted = false;
  mock.method(Sandboxes.prototype, "get", async () => ({} as Sandbox));
  mock.method(Sandboxes.prototype, "close", async () => {});
  mock.method(SandboxClient.prototype, "readFile", async () => Buffer.from(JSON.stringify({ jobId, status: "failed", result: { reason: "source_download_failed" } })));
  mock.method(SandboxClient.prototype, "exec", async () => { throw new Error("Must not inspect outputs"); });
  try {
    const handler = Reflect.get(mediaFunctions[0], "fn") as (context: unknown) => Promise<unknown>;
    await assert.rejects(handler({ event: { data: { jobId } }, step: {
      run: async (id: string, fn: () => Promise<unknown>) => {
        if (id === "create-install-detach") return { name: "test", timings: {} };
        if (id === "read-artifacts") return fn();
        if (id === "delete-sandbox") deleted = true;
        return {};
      },
      waitForEvent: async () => ({ data: { status: "failed" } }),
    } }), (error: unknown) => error instanceof NonRetriableError && error.message === "Sandbox media job failed: source_download_failed");
    assert.equal(deleted, true);
  } finally {
    mock.restoreAll();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("cancellation cleanup validates job IDs and deletes only the exact sandbox", async () => {
  const previous = { DOCKER_ID: process.env.DOCKER_ID, DOCKER_CLOUD_SANDBOX_TOKEN: process.env.DOCKER_CLOUD_SANDBOX_TOKEN };
  process.env.DOCKER_ID = process.env.DOCKER_CLOUD_SANDBOX_TOKEN = "test-only";
  const jobId = "11111111-1111-1111-1111-111111111111";
  const handler = Reflect.get(cleanupCancelledMedia, "fn") as (context: unknown) => Promise<unknown>;
  const deleted: string[] = [];
  let fail = false;
  mock.method(Sandboxes.prototype, "all", async function* () {
    for (const displayName of [`wf-${jobId}`, "wf-other", "unrelated"]) yield { displayName } as Sandbox;
  });
  mock.method(Sandboxes.prototype, "close", async () => {});
  mock.method(SandboxClient.prototype, "delete", async (sandbox: Sandbox) => {
    if (fail) throw new Error("Deletion failed");
    deleted.push(sandbox.displayName!);
  });
  const context = (data: unknown) => ({ event: { data: { event: { data } } }, step: { run: async (_id: string, fn: () => Promise<void>) => fn() } });
  try {
    await handler(context({ jobId }));
    assert.deepEqual(deleted, [`wf-${jobId}`]);
    await assert.rejects(handler(context({})), /Valid jobId/);
    await assert.rejects(handler(context({ jobId: "unrelated" })), /Valid jobId/);
    fail = true;
    await assert.rejects(handler(context({ jobId })), /Deletion failed/);
  } finally {
    mock.restoreAll();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
