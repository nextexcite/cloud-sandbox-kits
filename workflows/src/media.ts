import { createHmac, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { NonRetriableError } from "inngest";
import { inngest } from "./capture.js";
import { dockerClient, type SandboxOptions } from "./sandbox.js";
import { validateJob } from "./jobs.js";

async function cleanup(jobId: string) {
  const client = dockerClient();
  try {
    for await (const sandbox of client.sdk.all()) {
      if (sandbox.displayName === `wf-${jobId}`) await client.delete(sandbox);
    }
  } finally { await client.sdk.close(); }
}

export const mediaFunctions = (["encode", "transcribe"] as const).map((kind) => inngest.createFunction({
  id: `media-${kind}`, retries: 0, concurrency: 2, triggers: [{ event: `media/${kind}` }],
  onFailure: async ({ event }) => {
    const jobId = event.data.event.data.jobId;
    if (typeof jobId === "string" && /^[a-f0-9-]{36}$/.test(jobId)) await cleanup(jobId);
  },
}, async ({ event, step }) => {
  const jobId = event.data.jobId;
  if (typeof jobId !== "string" || !/^[a-f0-9-]{36}$/.test(jobId)) throw new NonRetriableError("Valid jobId required");
  let data: Record<string, unknown>;
  try { data = validateJob(kind, event.data); }
  catch { throw new NonRetriableError("Invalid media job"); }
  try {
    const launched = await step.run("create-install-detach", async () => {
      if (!process.env.CALLBACK_SECRET || !process.env.CALLBACK_PUBLIC_URL) throw new Error("Callback configuration missing");
      const client = dockerClient();
      const start = Date.now();
      let sandbox;
      try {
        sandbox = await client.create({ name: `wf-${jobId}`, imageRef: process.env.SANDBOX_IMAGE ?? "ubuntu:24.04",
          size: (data.size ?? "large") as SandboxOptions["size"], ttlMs: 3_600_000,
          network: { policies: [{ mode: "denyAll", allowNetworks: ["*", "*.trycloudflare.com"] }] },
        });
        const created = Date.now();
        const installed = await client.exec(sandbox, ["bash", "-lc", `set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ffmpeg curl ca-certificates ${kind === "transcribe" ? "python3-venv" : "python3"}
${kind === "transcribe" ? "python3 -m venv /opt/media\n/opt/media/bin/pip -q install faster-whisper==1.2.1 yt-dlp" : ""}`], 900_000);
        if (installed.exitCode !== 0 || installed.incomplete) throw new Error("Media dependency installation failed");
        await client.writeFile(sandbox, "/root/job.py", await readFile(new URL("./media-runner.py", import.meta.url)));
        await client.writeFile(sandbox, "/root/job.json", JSON.stringify({ kind, data, jobId,
          callbackUrl: `${process.env.CALLBACK_PUBLIC_URL}/callbacks/sandbox`,
          callbackKey: createHmac("sha256", process.env.CALLBACK_SECRET).update(jobId).digest("hex"),
          ...(kind === "transcribe" ? { cookies: process.env.YT_COOKIES, proxy: process.env.YT_PROXY } : {}),
        }));
        return { name: sandbox.name, timings: { createMs: created - start, installMs: Date.now() - created } };
      } catch (error) {
        if (sandbox) await client.delete(sandbox);
        throw error;
      } finally { await client.sdk.close(); }
    });
    const [callback] = await Promise.all([
      step.waitForEvent("sandbox-job-finished", { event: "sandbox/job.finished", match: "data.jobId", timeout: "25m" }),
      step.run("start-detached", async () => {
        const client = dockerClient();
        try {
          const sandbox = await client.sdk.get(launched.name);
          const detached = await client.exec(sandbox, ["bash", "-lc", `chmod 600 /root/job.json; nohup ${kind === "transcribe" ? "/opt/media/bin/python" : "python3"} /root/job.py > /root/job.log 2>&1 < /dev/null &`]);
          if (detached.exitCode !== 0) throw new Error("Detached launch failed");
          return { detached: true };
        } finally { await client.sdk.close(); }
      }),
    ]);
    if (!callback) throw new Error("Sandbox callback timed out");
    return await step.run("read-artifacts", async () => {
      const client = dockerClient();
      try {
        const sandbox = await client.sdk.get(launched.name);
        const result = JSON.parse(Buffer.from(await client.readFile(sandbox, "/root/result.json")).toString());
        if (result.jobId !== jobId || result.status !== callback.data.status) throw new Error("Callback/result mismatch");
        const copied = [];
        for (const output of result.result.outputs ?? []) {
          if (!/^\/root\/(h264|hevc)\.mp4$/.test(output.path)) throw new Error("Invalid output path");
          const check = await client.exec(sandbox, ["sha256sum", output.path]);
          if (check.exitCode !== 0 || check.stdout.split(" ")[0] !== output.sha256) throw new Error("Output checksum mismatch");
          if (output.bytes <= 5_000_000) {
            const bytes = await client.readFile(sandbox, output.path);
            if (bytes.byteLength !== output.bytes || createHash("sha256").update(bytes).digest("hex") !== output.sha256) throw new Error("Downloaded output checksum mismatch");
            await mkdir(new URL("../out/", import.meta.url), { recursive: true });
            await writeFile(new URL(`../out/${jobId}-${output.codec}.mp4`, import.meta.url), bytes);
            copied.push({ codec: output.codec, bytes: bytes.byteLength });
          } else {
            const sample = await client.exec(sandbox, ["bash", "-lc", `head -c 262144 ${output.path} > /root/sample.bin`]);
            if (sample.exitCode !== 0) throw new Error("Sample extraction failed");
            const bytes = await client.readFile(sandbox, "/root/sample.bin");
            await mkdir(new URL("../out/", import.meta.url), { recursive: true });
            await writeFile(new URL(`../out/${jobId}-${output.codec}.sample.bin`, import.meta.url), bytes);
            copied.push({ codec: output.codec, bytes: bytes.byteLength, partial: true });
          }
        }
        return { ...result, callbackReceived: true, timings: launched.timings, copied };
      } finally { await client.sdk.close(); }
    });
  } finally { await step.run("delete-sandbox", () => cleanup(jobId)); }
}));
