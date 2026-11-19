import { validateJob } from "../src/jobs.js";

interface Env {
  JOBS: { get(key: string): Promise<string | null>; put(key: string, value: string, options?: { expirationTtl: number }): Promise<void> };
  INNGEST_EVENT_URL: string;
  INNGEST_API_URL: string;
  INNGEST_EVENT_KEY?: string;
  INNGEST_SIGNING_KEY?: string;
  FRONTDOOR_TOKEN: string;
  CALLBACK_SECRET: string;
}
interface Job { ids: string[]; callbackAccepted: boolean; submission?: "pending" | "submitted" | "failed" }
async function getJob(env: Env, id: string): Promise<Job | undefined> {
  const value = await env.JOBS.get(id);
  if (!value) return undefined;
  const [submission, callback] = await Promise.all([env.JOBS.get(`submission:${id}`), env.JOBS.get(`callback:${id}`)]);
  const job: Job = JSON.parse(value);
  return { ...job, ...(submission ? JSON.parse(submission) : {}), callbackAccepted: job.callbackAccepted || callback === "accepted" };
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
async function readBody(request: Request): Promise<ArrayBuffer | undefined> {
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        const body = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
        return body.buffer;
      }
      bytes += value.byteLength;
      if (bytes > 65536) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (!env.CALLBACK_SECRET || !env.FRONTDOOR_TOKEN) return Response.json({ error: "Secrets not configured" }, { status: 503 });
    if (Number(request.headers.get("content-length") ?? 0) > 65536) return new Response("Body too large", { status: 413 });
    try {
      if (request.method === "POST" && url.pathname === "/callbacks/sandbox") {
        const raw = await readBody(request);
        if (raw === undefined) return new Response("Body too large", { status: 413 });
        const signature = request.headers.get("x-sandbox-signature") ?? "";
        const jobId = request.headers.get("x-sandbox-job-id");
        if (!jobId || !/^[a-f0-9]{64}$/.test(signature)) return new Response("Invalid signature", { status: 401 });
        const perJobKey = hex(await crypto.subtle.sign("HMAC", await key(env.CALLBACK_SECRET), encoder.encode(jobId)));
        const bytes = Uint8Array.from(signature.match(/../g)!, (s) => parseInt(s, 16));
        if (!await crypto.subtle.verify("HMAC", await key(perJobKey), bytes, raw)) return new Response("Invalid signature", { status: 401 });
        let data;
        try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
        catch { return new Response("Invalid callback", { status: 400 }); }
        if (data.jobId !== jobId || !["completed", "failed", "needs_cookies"].includes(data.status) || !data.result || typeof data.result !== "object") return new Response("Invalid callback", { status: 400 });
        const job = await getJob(env, data.jobId);
        if (!job) return new Response("Unknown job", { status: 404 });
        if (job.callbackAccepted) return Response.json({ duplicate: true });
        const sent = await emit(env, { id: `finished-${data.jobId}`, name: "sandbox/job.finished", data: { jobId: data.jobId, status: data.status, result: data.result } });
        await env.JOBS.put(`callback:${data.jobId}`, "accepted", { expirationTtl: 86400 });
        return Response.json(sent);
      }
      if (request.headers.get("authorization") !== `Bearer ${env.FRONTDOOR_TOKEN}`) return new Response("Unauthorized", { status: 401 });
      if (request.method === "POST" && /^\/jobs\/(browser|encode|transcribe)$/.test(url.pathname)) {
        const raw = await readBody(request);
        if (raw === undefined) return new Response("Body too large", { status: 413 });
        let data;
        try { data = validateJob(url.pathname.split("/")[2], JSON.parse(new TextDecoder().decode(raw))); }
        catch { return Response.json({ error: "Invalid job body" }, { status: 400 }); }
        const jobId = crypto.randomUUID();
        const kind = url.pathname.split("/")[2];
        const pending: Job = { ids: [], callbackAccepted: false, submission: "pending" };
        await env.JOBS.put(jobId, JSON.stringify(pending), { expirationTtl: 86400 });
        let sent;
        try { sent = await emit(env, { id: jobId, name: kind === "browser" ? "browser/capture" : `media/${kind}`, data: { ...data, jobId } }); }
        catch {
          await env.JOBS.put(`submission:${jobId}`, JSON.stringify({ ids: [], submission: "failed" }), { expirationTtl: 86400 });
          return Response.json({ error: "Inngest event submission failed", jobId }, { status: 502 });
        }
        await env.JOBS.put(`submission:${jobId}`, JSON.stringify({ ids: sent.ids, submission: "submitted" }), { expirationTtl: 86400 });
        return Response.json({ jobId, inngestEventIds: sent.ids }, { status: 202 });
      }
      if (request.method === "GET" && url.pathname.startsWith("/jobs/")) {
        const job = await getJob(env, url.pathname.slice(6));
        if (!job) return new Response("Unknown job", { status: 404 });
        if (!job.ids.length) return Response.json({ data: job.submission === "failed" ? [{ status: "Failed" }] : [] });
        const headers = env.INNGEST_SIGNING_KEY ? { Authorization: `Bearer ${env.INNGEST_SIGNING_KEY}` } : undefined;
        const response = await fetch(`${env.INNGEST_API_URL}/v1/events/${job.ids[0]}/runs`, { headers });
        return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json" } });
      }
      return new Response("Not found", { status: 404 });
    } catch { return Response.json({ error: "Request failed" }, { status: 502 }); }
  },
};
