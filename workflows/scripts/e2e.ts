import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { open, mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { dockerClient } from "../src/sandbox.js";
import { Resolver } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { maskSandboxIds, withFallbackSweep } from "../src/e2e-evidence.js";

await mkdir("out", { recursive: true });
const children: ReturnType<typeof spawn>[] = [];
const ownedJobs = new Set<string>();
const inheritedEnv = { ...process.env };
delete inheritedEnv.YT_COOKIES;
delete inheritedEnv.YT_PROXY;
const env = { ...inheritedEnv, INNGEST_DEV: "1", CALLBACK_SECRET: randomBytes(32).toString("hex"), FRONTDOOR_TOKEN: randomBytes(32).toString("hex") };
const auth = { Authorization: `Bearer ${env.FRONTDOOR_TOKEN}` };
const resolvedHosts = new Map<string, string>();
async function start(command: string, args: string[], log: string, extra = {}) {
  const handle = await open(`out/${log}`, "w");
  const child = spawn(command, args, { detached: true, env: { ...env, ...extra }, stdio: ["ignore", handle.fd, handle.fd] });
  children.push(child);
  await handle.close();
}
async function request(url: string, init?: RequestInit): Promise<Response> {
  if (!process.env.TUNNEL_DNS_SERVER || !new URL(url).hostname.endsWith(".trycloudflare.com")) return fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  const resolver = new Resolver();
  resolver.setServers([process.env.TUNNEL_DNS_SERVER]);
  const hostname = new URL(url).hostname;
  const address = resolvedHosts.get(hostname) ?? (await resolver.resolve4(hostname))[0];
  resolvedHosts.set(hostname, address);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: init?.method, headers: Object.fromEntries(new Headers(init?.headers)),
      family: 4, lookup: (_host, _opts, cb) => cb(null, address, 4), signal: AbortSignal.timeout(30_000),
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (data) => chunks.push(data));
      res.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode })));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(init?.body);
  });
}
async function json(url: string, init?: RequestInit) {
  const response = await request(url, init);
  if (!response.ok) throw new Error(`${new URL(url).pathname}: ${response.status}`);
  return response.json();
}
async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs: number): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const result = await fn();
    if (result !== undefined) return result;
    await delay(1000);
  }
  throw new Error("Timed out");
}
const results: object[] = [];
const listing = () => execFileSync(process.env.SBX_BIN ?? "sbx", ["--cloud", "ls"], { encoding: "utf8" });
const rows = (text: string) => text.split("\n").flatMap((line) => {
  const parts = line.trim().split(/\s+/);
  const id = parts.findIndex((part) => part.startsWith("sbx_"));
  return id < 0 ? [] : [[parts[0], ...parts.slice(id, id + 3)].join(" ")];
}).sort();
const initialListing = listing();
console.log(`INITIAL_SANDBOX_LISTING:\n${maskSandboxIds(initialListing)}`);
let jobsPassed = false;
try {
  if (/\bwf-/.test(initialListing)) throw new Error("Pre-existing workflow sandboxes require separate reconciliation");
  for (const port of [3000, 8288, 8787]) {
    let occupied = false;
    try { await fetch(`http://localhost:${port}/health`); occupied = true; } catch {}
    if (occupied) throw new Error(`Port ${port} is occupied`);
  }
  await start("npx", ["inngest-cli@latest", "dev", "-u", "http://localhost:3000/api/inngest"], "inngest.log");
  await start("npx", ["wrangler", "dev", "--config", "worker/wrangler.jsonc", "--port", "8787", "--local"], "worker.log", { DOCKER_ID: undefined, DOCKER_CLOUD_SANDBOX_TOKEN: undefined });
  await start(process.env.CLOUDFLARED_BIN ?? "cloudflared", ["tunnel", "--url", "http://localhost:8787", "--no-autoupdate"], "tunnel.log");
  const publicUrl = await waitFor(async () => {
    const text = await readFile("out/tunnel.log", "utf8");
    return text.match(/https:\/\/[a-z0-9-]+\.trycloudflare.com/)?.[0];
  }, 120_000);
  await waitFor(async () => {
    try { await json(`${publicUrl}/health`); await json("http://localhost:8288/health"); return true; } catch { return undefined; }
  }, 120_000);
  console.log(`WORKER_PUBLIC_URL: ${publicUrl}`);
  await start("npm", ["run", "dev"], "app.log", { CALLBACK_PUBLIC_URL: publicUrl });
  await waitFor(async () => {
    try { await json("http://localhost:3000/health"); return true; } catch { return undefined; }
  }, 60_000);
  await json("http://localhost:3000/api/inngest", { method: "PUT" });
  const invalid = await request(`${publicUrl}/callbacks/sandbox`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: "unknown", status: "completed", result: {} }) });
  if (invalid.status !== 401) throw new Error("Unsigned callback was not rejected");
  const invalidJob = await request(`${publicUrl}/jobs/encode`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ durationSec: -1 }) });
  if (invalidJob.status !== 400) throw new Error("Invalid job accepted");
  console.log("VALIDATION_PASS: unsigned callback=401; invalid duration=400");
  const cases = [
    { kind: "browser", label: "browser", data: { url: "https://example.com" } },
    { kind: "encode", label: "encode", data: { durationSec: 6, codecs: ["h264", "hevc"], size: "large" } },
    { kind: "transcribe", label: "speech", data: { audioUrl: process.env.SPEECH_URL ?? "https://archive.org/download/gettysburg_address_librivox/gettysburg_address_lincoln_64kb.mp3", model: "tiny.en" } },
    { kind: "transcribe", label: "youtube", data: { youtubeUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw", model: "tiny.en" } },
    { kind: "encode", label: "bad-source", data: { sourceUrl: "https://example.com/this-wf-source-does-not-exist.mp4", durationSec: 1, codecs: ["h264"], size: "large" } },
  ];
  const submitted = [];
  for (const item of cases) {
    const job = await json(`${publicUrl}/jobs/${item.kind}`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(item.data) });
    ownedJobs.add(job.jobId);
    submitted.push({ ...item, ...job });
    console.log(`SUBMITTED: ${item.label} ${JSON.stringify(job)}`);
  }
  const settled = await Promise.allSettled(submitted.map(async (item) => {
    const { run, result } = await waitFor(async () => {
      const { data } = await json(`${publicUrl}/jobs/${item.jobId}`, { headers: auth });
      const run = data.find((r: { status: string }) => ["Completed", "Failed", "Cancelled"].includes(r.status));
      if (!run) return undefined;
      if (run.status === "Cancelled") return { run, result: undefined };
      const output = await json("http://localhost:8288/v0/gql", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "query($id: String!) { run(runID: $id) { output } }", variables: { id: run.run_id } }),
    });
    if (output.errors) throw new Error("Could not retrieve function output");
      const raw = typeof output.data.run.output === "string" ? JSON.parse(output.data.run.output) : output.data.run.output;
      if (run.status === "Failed") return raw && (!Array.isArray(raw) || raw.length) ? { run, result: raw } : undefined;
      const result = Array.isArray(raw) ? raw.find((x) => x.op === "RunComplete")?.data : raw;
      if (!result) return undefined;
      return { run, result };
    }, 1_800_000);
    if (item.label === "bad-source") {
      if (run.status !== "Failed") throw new Error("Bad source did not produce Failed run status");
      const failureReason = "Sandbox media job failed: source_download_failed";
      if (!JSON.stringify(result).includes(failureReason)) throw new Error("Bad source failed for an unexpected reason");
      const failed = { label: item.label, jobId: item.jobId, runStatus: run.status, callbackReceived: true, failureReason };
      results.push(failed);
      console.log(`BAD_SOURCE_STATUS: ${JSON.stringify(failed)}`);
      return;
    }
    if (run.status !== "Completed") throw new Error(`${item.label} failed`);
    if (item.kind === "browser" && (!result.title || !result.screenshotBytes)) throw new Error("Browser output missing");
    if (item.kind !== "browser" && !result.callbackReceived) throw new Error("Missing callback evidence");
    if (item.label === "encode" && (result.status !== "completed" || result.copied.length !== 2)) throw new Error("Encode output missing");
    if (item.label === "speech" && (result.status !== "completed" || !result.result.transcript || result.result.audioSeconds < 120)) throw new Error("Speech output missing");
    if (item.label === "youtube" && result.status !== "needs_cookies") throw new Error("Unauthenticated YouTube did not return needs_cookies");
    const summary = { label: item.label, jobId: item.jobId, runStatus: run.status,
      status: result.status, callbackReceived: item.kind === "browser" ? "n/a" : result.callbackReceived, model: item.data.model,
      title: result.title, screenshotBytes: result.screenshotBytes, timings: result.timings,
      stats: item.kind === "browser" ? undefined : {
        language: result.result.language, audioSeconds: result.result.audioSeconds,
        transcriptCharacters: result.result.transcript?.length,
        downloadSeconds: result.result.downloadSeconds, modelLoadSeconds: result.result.modelLoadSeconds,
        transcribeSeconds: result.result.transcribeSeconds, workSeconds: result.result.workSeconds,
      },
      outputs: result.result?.outputs?.map((output: { codec: string; bytes: number; sha256: string; seconds: number }) => ({
        codec: output.codec, bytes: output.bytes, sha256: output.sha256, seconds: output.seconds,
      })),
    };
    console.log(JSON.stringify(summary, null, 2));
    results.push(summary);
  }));
  if (settled.some((x) => x.status === "rejected")) throw new Error(settled.filter((x) => x.status === "rejected").map((x) => x.reason.message).join("; "));
  jobsPassed = true;
} finally {
  const { preSweepListing, unchanged } = await withFallbackSweep(async () => {
    const preSweepListing = listing();
    console.log(`PRE_SWEEP_SANDBOX_LISTING:\n${maskSandboxIds(preSweepListing)}`);
    const unchanged = JSON.stringify(rows(initialListing)) === JSON.stringify(rows(preSweepListing));
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const evidence = JSON.stringify({ head, jobs: results, preSweepListing: maskSandboxIds(preSweepListing), preexistingUnchanged: unchanged }, null, 2);
    await writeFile("out/e2e-results.json", evidence);
    const path = `out/e2e-results-${head.slice(0, 7)}.json`;
    await writeFile(path, evidence);
    console.log(`RESULTS_JSON: ${path}`);
    return { preSweepListing, unchanged };
  }, async () => {
    for (const child of children) {
      if (child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
    }
    if (ownedJobs.size) {
      const client = dockerClient();
      try {
        for await (const sandbox of client.sdk.all()) {
          if (sandbox.displayName && ownedJobs.has(sandbox.displayName.slice(3)) && sandbox.displayName.startsWith("wf-")) await client.delete(sandbox);
        }
      } finally { await client.sdk.close(); }
    }
  });
  const afterSweep = listing();
  console.log(maskSandboxIds(afterSweep));
  if (/\bwf-/.test(preSweepListing)) throw new Error("Workflow sandboxes remained before fallback sweep");
  if (/\bwf-/.test(afterSweep)) throw new Error("Workflow sandboxes remain");
  if (!unchanged || JSON.stringify(rows(initialListing)) !== JSON.stringify(rows(afterSweep))) throw new Error("Pre-existing sandboxes changed");
  if (jobsPassed) console.log("E2E_PASS: browser, detached encode, speech transcription, YouTube path; bad-source Failed");
  console.log("CLEANUP_PASS: no wf- sandboxes remain");
}
