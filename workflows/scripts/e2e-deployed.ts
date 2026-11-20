import { dockerClient } from "../src/sandbox.js";
import { cancelCloudRun, privateJson, readJson, request, required, secretsPath, statePath, until, type Deployment, type Secrets } from "./deploy-lib.js";

interface Run { run_id: string; status: string; output?: unknown }
export const sourceUrl = "https://media.w3.org/2010/05/sintel/trailer.mp4";
const terminal = ["Completed", "Failed", "Cancelled"];

async function main() {
  const state = await readJson<Deployment>(statePath);
  const secrets = await readJson<Secrets>(secretsPath);
  const workerUrl = process.env.WORKER_URL ?? state?.workerUrl;
  const token = process.env.FRONTDOOR_TOKEN ?? secrets?.FRONTDOOR_TOKEN;
  if (!workerUrl || !token || !state?.hostName) throw new Error("Deploy first; Worker URL, token and host ownership record are required");
  const signingKey = required("INNGEST_SIGNING_KEY");
  const client = dockerClient();
  const jobs = new Map<string, string>();
  const results: object[] = [];
  const initial = new Set<string>();
  let interrupted = false;
  const interrupt = () => { interrupted = true; };
  process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  const assertActive = () => { if (interrupted) throw new Error("Test interrupted"); };
  const json = async (url: string, init?: RequestInit) => {
    assertActive();
    const response = await request(url, init);
    if (!response.ok) throw new Error(`Remote request: HTTP ${response.status}`);
    return response.json();
  };
  const status = async (jobId: string): Promise<Run[]> => (await json(`${workerUrl}/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })).data;
  const submit = async (kind: string, data: object) => {
    const response = await json(`${workerUrl}/jobs/${kind}`, { method: "POST", headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/json",
    }, body: JSON.stringify(data) });
    if (typeof response.jobId !== "string" || !/^[a-f0-9-]{36}$/.test(response.jobId)) throw new Error("Missing job ID");
    jobs.set(response.jobId, response.inngestEventIds?.[0]);
    return response.jobId as string;
  };
  const cancel = (runId: string) => cancelCloudRun(runId, signingKey);
  let passed = false;
  let cleanupVerified = false;
  let stage = "initial-listing";
  try {
    for await (const sandbox of client.sdk.all()) initial.add(sandbox.name);
    const cases = [
      { label: "browser", kind: "browser", data: { url: "https://example.com" } },
      { label: "encode", kind: "encode", data: { durationSec: 6, codecs: ["h264", "hevc"] } },
      { label: "encode-source", kind: "encode", data: { sourceUrl, durationSec: 6, codecs: ["h264", "hevc"] } },
      { label: "speech", kind: "transcribe", data: { audioUrl: process.env.SPEECH_URL ?? "https://archive.org/download/gettysburg_address_librivox/gettysburg_address_lincoln_64kb.mp3", model: "tiny.en" } },
      { label: "bad-source", kind: "encode", data: { sourceUrl: "https://example.com/this-wf-source-does-not-exist.mp4", durationSec: 1, codecs: ["h264"] } },
    ];
    for (const item of cases) {
      stage = item.label;
      const jobId = await submit(item.kind, item.data);
      console.log(`SUBMITTED ${item.label} ${jobId}`);
      const run = await until(async () => {
        const runs = await status(jobId);
        return runs.find((run) => terminal.includes(run.status));
      }, 1_800_000);
      console.log(`TERMINAL ${item.label} ${run.status}`);
      const expected = item.label === "bad-source" ? "Failed" : "Completed";
      if (run.status !== expected) throw new Error(`${item.label}: expected ${expected}, got ${run.status}`);
      const output = typeof run.output === "string" ? JSON.parse(run.output) : run.output;
      const value = output as Record<string, any> | undefined;
      if (expected === "Completed") {
        if (item.kind === "browser") {
          if (!value?.title || !(value.screenshotBytes > 0)) throw new Error("Browser artifact missing");
        } else {
          if (!value?.callbackReceived || value.status !== "completed") throw new Error("Media callback missing");
          if (item.kind === "encode" && value.copied?.length !== 2) throw new Error("Encode artifacts missing");
          if (item.kind === "transcribe" && (!value.result?.transcript || !(value.result.audioSeconds >= 120))) throw new Error("Speech result missing");
        }
      }
      results.push({ label: item.label, jobId, status: run.status, callbackReceived: value?.callbackReceived,
        screenshotBytes: value?.screenshotBytes, timings: value?.timings,
        audioSeconds: value?.result?.audioSeconds, transcriptCharacters: value?.result?.transcript?.length,
        outputs: value?.result?.outputs?.map((file: Record<string, unknown>) => ({ codec: file.codec, bytes: file.bytes, sha256: file.sha256 })),
      });
    }
    stage = "cancel-cleanup";
    const jobId = await submit("encode", { durationSec: 120, codecs: ["hevc"], size: "micro" });
    const runId = await until(async () => {
      const runs = await status(jobId);
      if (runs.some((run) => terminal.includes(run.status))) throw new Error("Cancellation job finished before cancellation");
      for await (const sandbox of client.sdk.all()) {
        if (sandbox.displayName !== `wf-${jobId}`) continue;
        const result = await sandbox.run(["test", "-f", "/root/job.log"], {}, { timeoutMs: 30_000 });
        if (result.exitCode === 0 && runs[0]) return runs[0].run_id;
      }
      return undefined;
    }, 1_200_000);
    await cancel(runId);
    await until(async () => (await status(jobId)).some((run) => run.status === "Cancelled") ? true : undefined, 120_000);
    await until(async () => {
      assertActive();
      for await (const sandbox of client.sdk.all()) if (sandbox.displayName === `wf-${jobId}`) return undefined;
      return true;
    }, 300_000);
    cleanupVerified = true;
    results.push({ label: "cancel-cleanup", jobId, status: "Cancelled", sandboxDeleted: true });
    passed = true;
    stage = "leftover-check";
  } finally {
    try {
      const listing: object[] = [];
      let unrelated = 0;
      let leftovers = 0;
      for await (const sandbox of client.sdk.all()) {
        const owned = [...jobs.keys()].some((id) => sandbox.displayName === `wf-${id}`) && !initial.has(sandbox.name);
        const isHost = sandbox.name === state.hostId && sandbox.displayName === state.hostName;
        if (sandbox.displayName?.startsWith("wf-") && !isHost) leftovers++;
        listing.push({ sandbox: owned || isHost ? sandbox.displayName : `pre-existing-${++unrelated}`, status: sandbox.status });
      }
      const evidence = { passed: passed && leftovers === 0, failureStage: passed && leftovers === 0 ? undefined : stage, cancellationCleanupVerified: cleanupVerified, jobs: results, preSweepListing: listing, leftoverJobSandboxes: leftovers };
      await privateJson("out/e2e-deployed-results.json", evidence);
      console.log(JSON.stringify(evidence, null, 2));
      if (leftovers) throw new Error("Workflow job sandboxes remain before fallback cleanup");
    } finally {
      try {
        for (const [jobId, eventId] of jobs) {
          if (!eventId) continue;
          const response = await request(`https://api.inngest.com/v1/events/${encodeURIComponent(eventId)}/runs`, { headers: { Authorization: `Bearer ${signingKey}` } });
          if (!response.ok) throw new Error(`Cleanup run lookup: HTTP ${response.status}`);
          const body = await response.json() as { data: Run[] };
          for (const run of body.data) if (!terminal.includes(run.status)) await cancel(run.run_id);
        }
        for await (const sandbox of client.sdk.all()) {
          if (initial.has(sandbox.name)) continue;
          if ([...jobs.keys()].some((id) => sandbox.displayName === `wf-${id}`)) await client.delete(sandbox);
        }
      } finally {
        await client.sdk.close();
        process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
      }
    }
  }
}
main().catch(() => { console.error("Deployed e2e failed; inspect sanitized out/e2e-deployed-results.json (if written)"); process.exitCode = 1; });
