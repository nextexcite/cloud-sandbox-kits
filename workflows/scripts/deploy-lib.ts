import { spawn } from "node:child_process";
import { chmod, mkdir, open, readFile, rename } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function deploymentMode(value = "deploy") {
  if (value !== "deploy" && value !== "host-only" && value !== "host-cloud" && value !== "teardown") {
    throw new Error("Use deploy, host-only, host-cloud [--restart-only], or teardown [--all]");
  }
  return value;
}

export function callbackOrigin(value = "https://worker-not-configured.invalid") {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("CALLBACK_PUBLIC_URL must be an HTTPS origin without credentials");
  }
  return url.origin;
}

export function validateDeploymentOwnership(state: Deployment) {
  if (!/^wf-host-\d+$/.test(state.hostName) || (!state.hostOnly &&
    (!/^sandbox-workflows-\d+$/.test(state.workerName) || !/^wf-jobs-\d+$/.test(state.namespaceTitle)))) {
    throw new Error("Invalid deployment ownership record");
  }
}

export async function privateJson(path: string, value: unknown) {
  await mkdir("out", { recursive: true, mode: 0o700 });
  const file = await open(`${path}.tmp`, "w", 0o600);
  try { await file.chmod(0o600); await file.writeFile(JSON.stringify(value, null, 2)); }
  finally { await file.close(); }
  await rename(`${path}.tmp`, path);
  await chmod(path, 0o600);
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export async function command(bin: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { WRANGLER_SEND_METRICS: "false" };
    for (const name of ["PATH", "HOME", "USERPROFILE", "SystemRoot", "TMP", "TEMP", "TMPDIR",
      "XDG_CACHE_HOME", "APPDATA", "LOCALAPPDATA", "CI", "TERM", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
      "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    const child = spawn(bin, args, { env, stdio: "pipe" });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.resume();
    child.on("error", () => reject(new Error(`${bin} failed to start`)));
    child.on("exit", (code) => code === 0 ? resolve(output) : reject(new Error(`${bin} failed (exit ${code}); output suppressed to protect secrets`)));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

export const hostInstallMarker = "/opt/workflows/out/install-complete";

export async function requireHostInstall(run: (argv: string[]) => Promise<{ exitCode?: number | null; incomplete?: boolean }>) {
  const result = await run(["test", "-f", hostInstallMarker]);
  if (result.exitCode !== 0 || result.incomplete) {
    throw new Error("Host installation incomplete; run deploy -- host-cloud without --restart-only");
  }
}

export async function until<T>(fn: () => Promise<T | undefined>, timeoutMs: number, intervalMs = 3000): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await fn();
    if (value !== undefined) return value;
    await delay(intervalMs);
  }
  throw new Error("Timed out waiting for remote operation");
}

export async function request(url: string, init?: RequestInit) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
}

export async function cancelCloudRun(runId: string, signingKey: string, fetcher = request) {
  const response = await fetcher(`https://api.inngest.com/v1/runs/${encodeURIComponent(runId)}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${signingKey}` },
  });
  if (!response.ok) throw new Error(`Cancel run: HTTP ${response.status}`);
}

export interface Deployment {
  hostName: string;
  hostId?: string;
  hostUrl?: string;
  workerName: string;
  namespaceTitle: string;
  namespaceId?: string;
  workerUrl?: string;
  accountId?: string;
  workerOwned?: boolean;
  hostOnly: boolean;
  callbackPublicUrl?: string;
}
export interface Secrets { FRONTDOOR_TOKEN: string; CALLBACK_SECRET: string }
export const statePath = "out/deployment.json";
export const secretsPath = "out/deployment-secrets.json";
