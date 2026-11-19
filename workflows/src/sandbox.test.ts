import { test } from "node:test";
import assert from "node:assert/strict";
import { NotFoundError, ResourceWaitError, type Sandboxes, type Sandbox } from "@docker/sandboxes";
import { SandboxClient, dockerClient } from "./sandbox.js";

test("credentials are required without exposing values", () => {
  assert.throws(() => dockerClient({}), /credentials are required/);
});
test("withSandbox deletes on success, empty result and callback failure", async () => {
  for (const outcome of ["ok", undefined, new Error("callback failed")]) {
    let deleted = 0;
    const client = new SandboxClient({} as Sandboxes);
    client.create = async () => ({} as Sandbox);
    client.delete = async () => { deleted++; };
    const run = client.withSandbox({ name: "wf-test", imageRef: "ubuntu:24.04" }, async () => {
      if (outcome instanceof Error) throw outcome;
      return outcome;
    });
    if (outcome instanceof Error) await assert.rejects(run, /callback failed/);
    else assert.equal(await run, outcome);
    assert.equal(deleted, 1);
  }
});
test("rejects unsafe names and invalid TTL before creating", async () => {
  const client = new SandboxClient({} as Sandboxes);
  await assert.rejects(client.create({ name: "existing", imageRef: "x" }), /wf-/);
  await assert.rejects(client.create({ name: "wf-test", imageRef: "x", ttlMs: 0 }), /positive/);
  await assert.rejects(client.delete({ displayName: "existing" } as Sandbox), /Refusing/);
});
test("binary and empty file contents and exec results are preserved", async () => {
  const client = new SandboxClient({} as Sandboxes);
  for (const bytes of [new Uint8Array(), new Uint8Array([0, 255, 1])]) {
    const sandbox = { files: {
      read: async () => bytes,
      write: async (_path: string, content: Uint8Array) => { assert.deepEqual(content, bytes); },
    }, run: async (_argv: string[], _opts: unknown, call: { timeoutMs: number }) => {
      assert.equal(call.timeoutMs, 1234);
      return { stdout: "out", stderr: "err", exitCode: 7 };
    } } as unknown as Sandbox;
    assert.deepEqual(await client.readFile(sandbox, "/a"), bytes);
    await client.writeFile(sandbox, "/a", bytes);
    assert.deepEqual(await client.exec(sandbox, ["false"], 1234), { stdout: "out", stderr: "err", exitCode: 7 });
  }
});
test("delete handles SDK missing-resource wait error but propagates other failures", async () => {
  const client = new SandboxClient({} as Sandboxes);
  const missing = new NotFoundError({ code: "notFound" }, 404);
  const sandbox = { displayName: "wf-test", delete: async () => {}, waitUntilDeleted: async () => {
    throw new ResourceWaitError("request", undefined, "notFound", undefined, undefined, missing);
  } } as unknown as Sandbox;
  await client.delete(sandbox);
  sandbox.waitUntilDeleted = async () => { throw new Error("unavailable"); };
  await assert.rejects(client.delete(sandbox), /unavailable/);
});
