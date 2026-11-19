import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Inngest, NonRetriableError } from "inngest";
import { dockerClient } from "./sandbox.js";

export const inngest = new Inngest({ id: "sandbox-workflows" });
export const capture = inngest.createFunction(
  { id: "browser-capture", retries: 0, concurrency: 2, triggers: [{ event: "browser/capture" }] },
  async ({ event, step }) => {
    let url: URL;
    try { url = new URL(event.data.url); }
    catch { throw new NonRetriableError("A valid URL is required"); }
    if (!["https:", "http:"].includes(url.protocol)) throw new NonRetriableError("HTTP(S) URL required");
    return step.run("capture-and-cleanup", async () => {
      const client = dockerClient();
      const timings: Record<string, number> = {};
      const started = Date.now();
      const name = `wf-${typeof event.data.jobId === "string" && /^[a-f0-9-]{36}$/.test(event.data.jobId) ? event.data.jobId : randomUUID()}`;
      const time = async <T>(key: string, fn: () => Promise<T>) => {
        const start = Date.now();
        try { return await fn(); } finally { timings[key] = Date.now() - start; }
      };
      try {
        const sandbox = await time("createMs", () => client.create({ name,
          imageRef: process.env.SANDBOX_IMAGE ?? "ubuntu:24.04", size: "large", ttlMs: 1_800_000,
          network: { policies: [{ mode: "denyAll", allowNetworks: ["*"] }] },
        }));
        let result;
        try {
          const exec = async (argv: string[], timeout = 120_000) => {
            const output = await client.exec(sandbox, argv, timeout);
            if (output.exitCode !== 0 || output.incomplete) throw new Error(`Command failed (${output.exitCode}): ${output.stderr.slice(-2000)}`);
            return output.stdout.trim();
          };
          await time("installMs", () => exec(["bash", "-lc", `set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates fonts-noto-cjk libnspr4 libnss3
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y -qq nodejs
npm install -g agent-browser@0.43.0
agent-browser install --with-deps`], 900_000));
          await time("openMs", () => exec(["agent-browser", "open", url.href]));
          const title = await exec(["agent-browser", "get", "title"]);
          const snapshot = await time("snapshotMs", () => exec(["agent-browser", "snapshot"]));
          await time("screenshotMs", () => exec(["agent-browser", "screenshot", "/tmp/capture.png"]));
          const png = await time("readMs", () => client.readFile(sandbox, "/tmp/capture.png"));
          if (Buffer.from(png).subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Invalid PNG");
          await mkdir(new URL("../out/", import.meta.url), { recursive: true });
          await writeFile(new URL(`../out/${name}.png`, import.meta.url), png);
          result = { title, snapshotExcerpt: snapshot.slice(0, 2000), screenshotBytes: png.byteLength, timings };
        } finally { await time("deleteMs", () => client.delete(sandbox)); }
        timings.totalMs = Date.now() - started;
        return result;
      } finally { await client.sdk.close(); }
    });
  },
);
