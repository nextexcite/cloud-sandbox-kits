import { randomBytes } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { NotFoundError, type Sandbox } from "@docker/sandboxes";
import { dockerClient } from "../src/sandbox.js";
import { callbackOrigin, command, deploymentMode, privateJson, readJson, request, required, secretsPath, statePath, until, validateDeploymentOwnership, type Deployment, type Secrets } from "./deploy-lib.js";

async function main() {
  const mode = deploymentMode(process.argv[2]);
  const smoke = mode === "host-only";
  const hostOnly = smoke || mode === "host-cloud";
  const restartOnly = process.argv.includes("--restart-only");
  if (restartOnly && mode !== "host-cloud") throw new Error("--restart-only requires host-cloud");
  let state = await readJson<Deployment>(statePath);
  if (mode === "teardown" && !state) return;
  required("DOCKER_ID"); required("DOCKER_CLOUD_SANDBOX_TOKEN");
  if (mode === "host-cloud") {
    required("INNGEST_EVENT_KEY"); required("INNGEST_SIGNING_KEY");
  }
  if (restartOnly && !state?.hostId) throw new Error("No recorded host to restart");
  if (mode !== "teardown" && !hostOnly) {
    for (const key of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"]) required(key);
  }
  if (mode !== "teardown" && state && state.hostOnly !== hostOnly) throw new Error("Teardown the previous deployment before changing mode");
  const client = dockerClient();
  const save = () => privateJson(statePath, state);
  const cf = async (path: string, method = "GET") => {
    const account = required("CLOUDFLARE_ACCOUNT_ID");
    if (state?.accountId && state.accountId !== account) throw new Error("Deployment belongs to another Cloudflare account");
    return request(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
      method, headers: { Authorization: `Bearer ${required("CLOUDFLARE_API_TOKEN")}` },
    });
  };
  try {
    if (!state) {
      const ts = Date.now();
      state = { hostName: `wf-host-${ts}`, workerName: `sandbox-workflows-${ts}`, namespaceTitle: `wf-jobs-${ts}`, hostOnly };
      if (!hostOnly) state.accountId = required("CLOUDFLARE_ACCOUNT_ID");
      for await (const existing of client.sdk.all()) {
        if (existing.displayName === state.hostName) throw new Error("Host name collision");
      }
      await save();
    }
    validateDeploymentOwnership(state);
    if (mode === "teardown") {
      let host: Sandbox | undefined;
      if (state.hostId) {
        try { host = await client.sdk.get(state.hostId); } catch (error) { if (!(error instanceof NotFoundError)) throw error; }
      } else {
        for await (const item of client.sdk.all()) if (item.displayName === state.hostName) host = item;
      }
      if (host) {
        if (host.displayName !== state.hostName) throw new Error("Host ownership mismatch");
        await client.delete(host);
      }
      if (process.argv.includes("--all") && !state.hostOnly) {
        if (state.workerOwned) {
          const response = await cf(`workers/scripts/${state.workerName}`, "DELETE");
          if (!response.ok && response.status !== 404) throw new Error(`Worker deletion: HTTP ${response.status}`);
        }
        if (!state.namespaceId) {
          const list = await cf("storage/kv/namespaces?per_page=100");
          if (!list.ok) throw new Error(`KV lookup: HTTP ${list.status}`);
          const { result } = await list.json() as { result: { id: string; title: string }[] };
          state.namespaceId = result.find((ns) => ns.title === state!.namespaceTitle)?.id;
        }
        if (state.namespaceId) {
          const response = await cf(`storage/kv/namespaces/${state.namespaceId}`, "DELETE");
          if (!response.ok && response.status !== 404) throw new Error(`KV deletion: HTTP ${response.status}`);
        }
      }
      if (state.hostOnly || process.argv.includes("--all")) {
        await rm(statePath); await rm(secretsPath, { force: true }); await rm("out/wrangler-deployed.json", { force: true });
      } else {
        delete state.hostId; delete state.hostUrl;
        state.hostName = `wf-host-${Date.now()}`;
        await save();
      }
      return;
    }
    let secrets = await readJson<Secrets>(secretsPath);
    if (!secrets) {
      if (state.workerUrl || state.hostId || (state.callbackPublicUrl && !state.callbackPublicUrl.endsWith(".invalid"))) throw new Error("Deployment secret file missing; restore it before redeploying");
      secrets = { FRONTDOOR_TOKEN: randomBytes(32).toString("hex"), CALLBACK_SECRET: randomBytes(32).toString("hex") };
      await privateJson(secretsPath, secrets);
    }
    if (!hostOnly) {
      const wrangler = async (args: string[], input?: string) => command("./node_modules/.bin/wrangler", args, input);
      if (!state.namespaceId) {
        let namespaces = JSON.parse(await wrangler(["kv", "namespace", "list"])) as { id: string; title: string }[];
        if (!namespaces.some((ns) => ns.title === state!.namespaceTitle)) {
          await wrangler(["kv", "namespace", "create", state.namespaceTitle, "--update-config=false"]);
          namespaces = JSON.parse(await wrangler(["kv", "namespace", "list"])) as typeof namespaces;
        }
        state.namespaceId = namespaces.find((ns) => ns.title === state!.namespaceTitle)?.id;
        if (!state.namespaceId) throw new Error("Created KV namespace was not found");
        await save();
      }
      if (!state.workerOwned) {
        const existing = await cf(`workers/scripts/${state.workerName}`);
        if (existing.status !== 404) throw new Error("Worker exists or ownership check failed");
        state.workerOwned = true; await save();
      }
      await privateJson("out/wrangler-deployed.json", {
        name: state.workerName, main: "../worker/index.ts", compatibility_date: "2026-11-19", workers_dev: true,
        kv_namespaces: [{ binding: "JOBS", id: state.namespaceId }],
        vars: { INNGEST_EVENT_URL: "https://inn.gs", INNGEST_API_URL: "https://api.inngest.com" },
      });
      const uploadSecrets = "out/worker-secrets-upload.json";
      try {
        await privateJson(uploadSecrets, {
          ...secrets, INNGEST_EVENT_KEY: required("INNGEST_EVENT_KEY"), INNGEST_SIGNING_KEY: required("INNGEST_SIGNING_KEY"),
        });
        await wrangler(["deploy", "--config", "out/wrangler-deployed.json", "--secrets-file", uploadSecrets]);
      } finally { await rm(uploadSecrets, { force: true }); }
      const subdomain = await cf("workers/subdomain");
      if (!subdomain.ok) throw new Error(`Worker URL lookup: HTTP ${subdomain.status}`);
      const body = await subdomain.json() as { result: { subdomain: string } };
      state.workerUrl = `https://${state.workerName}.${body.result.subdomain}.workers.dev`;
      await save();
    }
    let host: Sandbox | undefined;
    if (state.hostId) {
      try {
        host = await client.sdk.get(state.hostId);
        if (host.displayName !== state.hostName) throw new Error("Host ownership mismatch");
      } catch (error) {
        if (restartOnly) throw error;
        if (!(error instanceof NotFoundError)) throw error;
        state.hostName = `wf-host-${Date.now()}`;
        delete state.hostId; delete state.hostUrl; await save();
      }
    }
    if (!host) {
      host = await client.sdk.create({ displayName: state.hostName, imageRef: "ubuntu:24.04", resources: "small",
        lifecycle: { timeoutMs: 24 * 3600_000, onTimeout: "delete" },
        network: { policies: [{ mode: "denyAll", allowNetworks: ["*"] }] },
      }, { idempotencyKey: state.hostName });
      state.hostId = host.name; await save();
    }
    host = await host.waitUntilRunning({ timeoutMs: 300_000 });
    const run = async (cmd: string[], env?: Record<string, string>, timeoutMs = 900_000) => {
      const result = await host!.run(cmd, { env }, { timeoutMs });
      if (result.exitCode !== 0 || result.incomplete) throw new Error("Host command failed; remote output suppressed to protect secrets");
      return result.stdout;
    };
    if (!restartOnly) {
      await run(["bash", "-lc", "set -eu; export DEBIAN_FRONTEND=noninteractive; if ! command -v node >/dev/null; then apt-get update -qq; apt-get install -y -qq curl ca-certificates; curl -fsSL https://deb.nodesource.com/setup_24.x | bash -; apt-get install -y -qq nodejs; fi; mkdir -p /opt/workflows/src /opt/workflows/out"]);
      for (const name of ["package.json", "package-lock.json", ...(await readdir("src")).filter((file) => /\.(ts|py)$/.test(file)).map((file) => `src/${file}`)]) {
        await host.files.write(`/opt/workflows/${name}`, await readFile(name));
      }
      await run(["bash", "-lc", "cd /opt/workflows; npm ci --no-audit --no-fund >/opt/workflows/out/install.log 2>&1"]);
    }
    const ports = await host.ports.list();
    const port = ports.published?.find((port) => port.number === 3000) ?? await host.ports.create({ number: 3000, protocol: "tcp" });
    if (!port.url?.startsWith("https://")) throw new Error("No public HTTPS host URL");
    state.hostUrl = port.url.replace(/\/$/, ""); await save();
    const hostEnv: Record<string, string> = { PORT: "3000", INNGEST_SERVE_ORIGIN: state.hostUrl, INNGEST_SERVE_PATH: "/api/inngest" };
    if (!smoke) {
      state.callbackPublicUrl = callbackOrigin(process.env.CALLBACK_PUBLIC_URL ?? state.workerUrl ?? state.callbackPublicUrl);
      await save();
      Object.assign(hostEnv, {
        DOCKER_ID: required("DOCKER_ID"), DOCKER_CLOUD_SANDBOX_TOKEN: required("DOCKER_CLOUD_SANDBOX_TOKEN"),
        INNGEST_SIGNING_KEY: required("INNGEST_SIGNING_KEY"), INNGEST_EVENT_KEY: required("INNGEST_EVENT_KEY"),
        CALLBACK_PUBLIC_URL: state.callbackPublicUrl, CALLBACK_SECRET: secrets.CALLBACK_SECRET,
      });
    }
    await run(["bash", "-lc", "set -eu; cd /opt/workflows; if test -f out/server.pid; then pid=$(cat out/server.pid); if kill -0 \"$pid\" 2>/dev/null; then kill -- -\"$pid\"; fi; fi; unset INNGEST_DEV; nohup setsid ./node_modules/.bin/tsx src/server.ts >out/server.log 2>&1 </dev/null & echo $! >out/server.pid"], hostEnv);
    await until(async () => {
      try { const response = await request(`${state!.hostUrl}/health`); return response.ok ? true : undefined; } catch { return undefined; }
    }, 120_000);
    if (smoke) {
      const response = await request(`${state.hostUrl}/api/inngest`);
      const log = await run(["tail", "-c", "4096", "/opt/workflows/out/server.log"]);
      const missingSigningKey = log.includes("In cloud mode but no signing key found");
      if (!response.ok && !(response.status === 500 && missingSigningKey)) throw new Error(`Host introspection: HTTP ${response.status}`);
      await privateJson("out/host-dry-run.json", { hostUrl: state.hostUrl, introspectionStatus: response.status, missingSigningKey, body: await response.json() });
    } else {
      const response = await request(`${state.hostUrl}/api/inngest`, { method: "PUT" });
      const syncResponse = await response.json();
      await privateJson("out/host-sync.json", { hostName: state.hostName, hostUrl: state.hostUrl, status: response.status, response: syncResponse });
      if (!response.ok) throw new Error(`Inngest sync: HTTP ${response.status}`);
    }
    if (state.workerUrl) console.log(state.workerUrl);
    console.log(state.hostUrl);
  } finally { await client.sdk.close(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Deployment failed"); process.exitCode = 1; });
