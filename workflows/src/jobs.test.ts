import { test } from "node:test";
import assert from "node:assert/strict";
import { validateJob } from "./jobs.js";
import worker from "../worker/index.js";
import { createHmac } from "node:crypto";

test("job validation accepts browser and both media sources", () => {
  assert.equal(validateJob("browser", { url: "https://example.com" }).url, "https://example.com/");
  assert.deepEqual(validateJob("encode", {}).codecs, ["h264", "hevc"]);
  assert.equal(validateJob("transcribe", { audioUrl: "https://example.com/speech.mp3" }).model, "tiny.en");
  assert.ok(validateJob("transcribe", { youtubeUrl: "https://youtube.com/watch?v=x" }).youtubeUrl);
});
test("empty, ambiguous and invalid requests fail validation", () => {
  for (const value of [null, [], "", {}]) assert.throws(() => validateJob("browser", value));
  for (const value of [{}, { audioUrl: "https://x", youtubeUrl: "https://y" }, { audioUrl: "file:///etc/passwd" }]) assert.throws(() => validateJob("transcribe", value));
  for (const value of [{ durationSec: 0 }, { durationSec: 121 }, { codecs: [] }, { size: "huge" }]) assert.throws(() => validateJob("encode", value));
});
test("transcription models must be strings and invalid types return 400", async () => {
  const env = { INNGEST_EVENT_URL: "http://localhost", INNGEST_API_URL: "http://localhost", FRONTDOOR_TOKEN: "test-only", CALLBACK_SECRET: "test-only", JOBS: { get: async () => null, put: async () => {} } };
  for (const model of [["tiny"], {}, 42, true, null]) {
    const body = { audioUrl: "https://example.com/speech.mp3", model };
    assert.throws(() => validateJob("transcribe", body), /Unsupported model/);
    const response = await worker.fetch(new Request("https://worker/jobs/transcribe", {
      method: "POST", headers: { Authorization: "Bearer test-only" }, body: JSON.stringify(body),
    }), env);
    assert.equal(response.status, 400);
  }
  for (const model of ["tiny", "tiny.en", "base", "base.en"]) {
    assert.equal(validateJob("transcribe", { audioUrl: "https://example.com/speech.mp3", model }).model, model);
  }
});
test("Worker rejects unauthorized jobs and unsigned callbacks", async () => {
  const env = { INNGEST_EVENT_URL: "http://localhost", INNGEST_API_URL: "http://localhost", FRONTDOOR_TOKEN: "test-only", CALLBACK_SECRET: "test-only", JOBS: { get: async () => null, put: async () => {} } };
  assert.equal((await worker.fetch(new Request("https://worker/jobs/encode", { method: "POST" }), env)).status, 401);
  assert.equal((await worker.fetch(new Request("https://worker/callbacks/sandbox", { method: "POST", body: JSON.stringify({ jobId: "x", status: "completed", result: {} }) }), env)).status, 401);
});
test("Worker caps streamed bodies without trusting Content-Length", async () => {
  const env = { INNGEST_EVENT_URL: "http://localhost", INNGEST_API_URL: "http://localhost", FRONTDOOR_TOKEN: "test-only", CALLBACK_SECRET: "test-only", JOBS: { get: async () => null, put: async () => {} } };
  for (const path of ["/callbacks/sandbox", "/jobs/encode"]) {
    let chunks = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunks++ < 10) controller.enqueue(new Uint8Array(16384));
        else controller.close();
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const request = new Request(`https://worker${path}`, { method: "POST", body, headers: { Authorization: "Bearer test-only" }, duplex: "half" } as RequestInit);
    assert.equal((await worker.fetch(request, env)).status, 413);
    assert.equal(cancelled, true);
    assert.equal(chunks, 5);
  }
  const body = JSON.stringify({ jobId: "x", status: "completed", result: { text: "中".repeat(23000) } });
  assert.equal((await worker.fetch(new Request("https://worker/callbacks/sandbox", { method: "POST", body, headers: { "Content-Length": "1" } }), env)).status, 413);
});
test("Worker enqueues jobs, authenticates callbacks, deduplicates and proxies status", async () => {
  const values = new Map<string, string>();
  const env = { INNGEST_EVENT_URL: "http://localhost", INNGEST_API_URL: "http://localhost", FRONTDOOR_TOKEN: "test-only", CALLBACK_SECRET: "test-only",
    JOBS: { get: async (id: string) => values.get(id) ?? null, put: async (id: string, value: string) => { values.set(id, value); } } };
  const oldFetch = globalThis.fetch;
  const events: unknown[] = [];
  globalThis.fetch = async (_url, init) => {
    if (init?.body) events.push(JSON.parse(String(init.body)));
    return Response.json(init?.body ? { ids: ["event-1"] } : { data: [{ status: "Completed" }] });
  };
  try {
    const response = await worker.fetch(new Request("https://worker/jobs/encode", { method: "POST", headers: { Authorization: "Bearer test-only" }, body: "{}" }), env);
    assert.equal(response.status, 202);
    const { jobId } = await response.json() as { jobId: string };
    assert.equal(values.size, 1);
    const body = JSON.stringify({ jobId, status: "completed", result: { outputs: [] } });
    const perJobKey = createHmac("sha256", env.CALLBACK_SECRET).update(jobId).digest("hex");
    const signature = createHmac("sha256", perJobKey).update(body).digest("hex");
    const callback = (payload = body) => worker.fetch(new Request("https://worker/callbacks/sandbox", { method: "POST", headers: { "x-sandbox-signature": signature }, body: payload }), env);
    assert.equal((await callback(body + " ")).status, 401);
    assert.equal((await callback()).status, 200);
    assert.equal((await callback()).status, 200);
    assert.equal(events.length, 2);
    const status = await worker.fetch(new Request(`https://worker/jobs/${jobId}`, { headers: { Authorization: "Bearer test-only" } }), env);
    assert.deepEqual(await status.json(), { data: [{ status: "Completed" }] });
  } finally { globalThis.fetch = oldFetch; }
});
