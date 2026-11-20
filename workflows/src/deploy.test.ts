import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { command, privateJson, readJson, required, until } from "../scripts/deploy-lib.js";

test("deployment state is private, round-trips, and distinguishes missing from invalid files", async () => {
  await mkdir("out", { recursive: true });
  const dir = await mkdtemp("out/deploy-test-");
  const path = `${dir}/state.json`;
  try {
    assert.equal(await readJson(path), undefined);
    await privateJson(path, { value: "test-only" });
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await readJson(path), { value: "test-only" });
    await privateJson(path, {});
    assert.deepEqual(await readJson(path), {});
    await writeFile(path, "invalid");
    await assert.rejects(readJson(path), SyntaxError);
  } finally { await rm(dir, { recursive: true }); }
});

test("deployment subprocesses accept stdin, strip Docker credentials and redact failures", async () => {
  assert.equal(await command(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], "test-only"), "test-only");
  assert.equal(await command(process.execPath, ["-e", "process.stdout.write(String(!process.env.DOCKER_ID && !process.env.DOCKER_CLOUD_SANDBOX_TOKEN))"]), "true");
  await assert.rejects(command(process.execPath, ["-e", "console.error('test-secret');process.exit(1)"]), (error: Error) => !error.message.includes("test-secret"));
});

test("deployment polling handles ready, empty and error cases", async () => {
  assert.equal(await until(async () => "ready", 10, 1), "ready");
  await assert.rejects(until(async () => undefined, 1, 1), /Timed out/);
  await assert.rejects(until(async () => { throw new Error("offline"); }, 10, 1), /offline/);
  assert.throws(() => required("WF_NONEXISTENT_TEST_SETTING"), /Missing WF_NONEXISTENT_TEST_SETTING/);
});
