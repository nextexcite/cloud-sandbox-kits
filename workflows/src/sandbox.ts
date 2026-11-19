import { Sandboxes, pat, NotFoundError, ResourceWaitError, type Sandbox, type ClientCreateOptions } from "@docker/sandboxes";

export interface SandboxOptions {
  name: string;
  imageRef: string;
  size?: "micro" | "small" | "medium" | "large" | "xl";
  ttlMs?: number;
  network?: ClientCreateOptions["network"];
}

export function dockerClient(env = process.env) {
  const username = env.DOCKER_ID;
  const personalAccessToken = env.DOCKER_CLOUD_SANDBOX_TOKEN;
  if (!username || !personalAccessToken) throw new Error("Docker credentials are required in the environment");
  return new SandboxClient(new Sandboxes({ auth: pat({ username, personalAccessToken }) }));
}

export class SandboxClient {
  constructor(readonly sdk: Sandboxes) {}

  async create(opts: SandboxOptions) {
    if (!opts.name.startsWith("wf-")) throw new Error("Sandbox name must start with wf-");
    if (opts.ttlMs !== undefined && (!Number.isFinite(opts.ttlMs) || opts.ttlMs <= 0)) throw new Error("TTL must be positive");
    const sandbox = await this.sdk.create({
      displayName: opts.name, imageRef: opts.imageRef, resources: opts.size ?? "small",
      lifecycle: { timeoutMs: opts.ttlMs ?? 3_600_000, onTimeout: "delete" },
      network: opts.network,
    }, { idempotencyKey: opts.name });
    try {
      return await sandbox.waitUntilRunning({ timeoutMs: 300_000 });
    } catch (error) {
      await this.delete(sandbox);
      throw error;
    }
  }

  exec(sandbox: Sandbox, argv: string[], timeoutMs = 60_000) {
    return sandbox.run(argv, {}, { timeoutMs });
  }

  writeFile(sandbox: Sandbox, path: string, content: string | Uint8Array) {
    return sandbox.files.write(path, content);
  }

  readFile(sandbox: Sandbox, path: string, maxBytes = 16_777_216) {
    return sandbox.files.read(path, { maxBytes });
  }

  async delete(sandbox: Sandbox) {
    if (!sandbox.displayName?.startsWith("wf-")) throw new Error("Refusing to delete a non-workflow sandbox");
    try { await sandbox.delete({ force: true }); }
    catch (error) { if (error instanceof NotFoundError) return; throw error; }
    try { await sandbox.waitUntilDeleted({ timeoutMs: 120_000 }); }
    catch (error) {
      if (error instanceof ResourceWaitError && error.cause instanceof NotFoundError) return;
      throw error;
    }
  }

  async withSandbox<T>(opts: SandboxOptions, fn: (sandbox: Sandbox) => Promise<T>) {
    const sandbox = await this.create(opts);
    try { return await fn(sandbox); }
    finally { await this.delete(sandbox); }
  }
}
