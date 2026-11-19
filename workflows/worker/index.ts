import { Sandboxes, pat } from "@docker/sandboxes";
import { validateJob } from "../src/jobs.js";

interface Env {
  JOBS: { get(key: string): Promise<string | null>; put(key: string, value: string, options?: { expirationTtl: number }): Promise<void> };
  INNGEST_EVENT_URL: string;
  INNGEST_API_URL: string;
  INNGEST_EVENT_KEY?: string;
  INNGEST_SIGNING_KEY?: string;
  FRONTDOOR_TOKEN: string;
  CALLBACK_SECRET: string;
  DOCKER_ID?: string;
  DOCKER_CLOUD_SANDBOX_TOKEN?: string;
}
interface Job { ids: string[]; callbackAccepted: boolean }
async function getJob(env: Env, id: string): Promise<Job | undefined> {
  const value = await env.JOBS.get(id);
  return value ? JSON.parse(value) : undefined;
}
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function key(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function emit(env: Env, event: object) {
  const response = await fetch(`${env.INNGEST_EVENT_URL.replace(/\/$/, "")}/e/${env.INNGEST_EVENT_KEY || "test"}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event),
  });
  if (!response.ok) throw new Error("Inngest event submission failed");
  return response.json() as Promise<{ ids: string[] }>;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (!env.CALLBACK_SECRET || !env.FRONTDOOR_TOKEN) return Response.json({ error: "Secrets not configured" }, { status: 503 });
    if (Number(request.headers.get("content-length") ?? 0) > 65536) return new Response("Body too large", { status: 413 });
    try {
      if (request.method === "POST" && url.pathname === "/callbacks/sandbox") {
        const raw = await request.text();
        if (raw.length > 65536) return new Response("Body too large", { status: 413 });
        const data = JSON.parse(raw);
        if (typeof data.jobId !== "string" || !["completed", "failed", "needs_cookies"].includes(data.status) || !data.result || typeof data.result !== "object") return new Response("Invalid callback", { status: 400 });
        const signature = request.headers.get("x-sandbox-signature") ?? "";
        if (!/^[a-f0-9]{64}$/.test(signature)) return new Response("Invalid signature", { status: 401 });
        const perJobKey = hex(await crypto.subtle.sign("HMAC", await key(env.CALLBACK_SECRET), encoder.encode(data.jobId)));
        const bytes = Uint8Array.from(signature.match(/../g)!, (s) => parseInt(s, 16));
        if (!await crypto.subtle.verify("HMAC", await key(perJobKey), bytes, encoder.encode(raw))) return new Response("Invalid signature", { status: 401 });
        const job = await getJob(env, data.jobId);
        if (!job) return new Response("Unknown job", { status: 404 });
        if (job.callbackAccepted) return Response.json({ duplicate: true });
        const sent = await emit(env, { id: `finished-${data.jobId}`, name: "sandbox/job.finished", data: { jobId: data.jobId, status: data.status, result: data.result } });
        job.callbackAccepted = true;
        await env.JOBS.put(data.jobId, JSON.stringify(job), { expirationTtl: 86400 });
        return Response.json(sent);
      }
      if (request.headers.get("authorization") !== `Bearer ${env.FRONTDOOR_TOKEN}`) return new Response("Unauthorized", { status: 401 });
      if (request.method === "POST" && /^\/jobs\/(browser|encode|transcribe)$/.test(url.pathname)) {
        const raw = await request.text();
        if (raw.length > 65536) return new Response("Body too large", { status: 413 });
        let data;
        try { data = validateJob(url.pathname.split("/")[2], JSON.parse(raw)); }
        catch { return Response.json({ error: "Invalid job body" }, { status: 400 }); }
        const jobId = crypto.randomUUID();
        const kind = url.pathname.split("/")[2];
        const sent = await emit(env, { id: jobId, name: kind === "browser" ? "browser/capture" : `media/${kind}`, data: { ...data, jobId } });
        await env.JOBS.put(jobId, JSON.stringify({ ids: sent.ids, callbackAccepted: false }), { expirationTtl: 86400 });
        return Response.json({ jobId, inngestEventIds: sent.ids }, { status: 202 });
      }
      if (request.method === "GET" && url.pathname.startsWith("/jobs/")) {
        const job = await getJob(env, url.pathname.slice(6));
        if (!job) return new Response("Unknown job", { status: 404 });
        const headers = env.INNGEST_SIGNING_KEY ? { Authorization: `Bearer ${env.INNGEST_SIGNING_KEY}` } : undefined;
        const response = await fetch(`${env.INNGEST_API_URL}/v1/events/${job.ids[0]}/runs`, { headers });
        return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json" } });
      }
      if (request.method === "GET" && url.pathname === "/sdk-probe") {
        if (!env.DOCKER_ID || !env.DOCKER_CLOUD_SANDBOX_TOKEN) return new Response("Docker bindings missing", { status: 503 });
        let patFetchAttempted = false;
        let patHttpStatus: number | undefined;
        const sdk = new Sandboxes({ auth: pat({ username: env.DOCKER_ID, personalAccessToken: env.DOCKER_CLOUD_SANDBOX_TOKEN,
          transportRetries: "none",
          fetch: async (input) => {
            patFetchAttempted = true;
            const response = await fetch(input);
            patHttpStatus = response.status;
            return response;
          },
        }) });
        try {
          const result = await sdk.list({}, { timeoutMs: 30_000 });
          return Response.json({ authenticatedSDK: true, count: result.items.length });
        } catch (error) { return Response.json({ authenticatedSDK: false,
          errorName: error instanceof Error ? error.name : "UnknownError",
          code: error && typeof error === "object" && "code" in error ? error.code : undefined,
          patFetchAttempted, patHttpStatus,
        }); }
        finally { await sdk.close(); }
      }
      return new Response("Not found", { status: 404 });
    } catch { return Response.json({ error: "Request failed" }, { status: 502 }); }
  },
};
