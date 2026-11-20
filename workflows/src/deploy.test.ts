import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { callbackOrigin, cancelCloudRun, command, deploymentMode, hostInstallMarker, privateJson, readJson, requireHostInstall, required, until, validateDeploymentOwnership } from "../scripts/deploy-lib.js";

test("restart-only requires a complete installation marker and propagates check errors", async () => {
  await requireHostInstall(async (argv) => {
    assert.deepEqual(argv, ["test", "-f", hostInstallMarker]);
    return { exitCode: 0 };
  });
  for (const result of [{}, { exitCode: 1 }, { exitCode: 0, incomplete: true }]) {
    await assert.rejects(requireHostInstall(async () => result), /without --restart-only/);
  }
  await assert.rejects(requireHostInstall(async () => { throw new Error("offline"); }), /offline/);
});

test("host-only ownership permits external Worker metadata without weakening owned-resource checks", () => {
  const state = { hostName: "wf-host-123", workerName: "external-worker", namespaceTitle: "external-kv", workerOwned: false, hostOnly: true };
  validateDeploymentOwnership(state);
  assert.throws(() => validateDeploymentOwnership({ ...state, hostName: "" }), /ownership/);
  assert.throws(() => validateDeploymentOwnership({ ...state, hostOnly: false }), /ownership/);
  validateDeploymentOwnership({ ...state, hostOnly: false, workerName: "sandbox-workflows-123", namespaceTitle: "wf-jobs-123" });
});

test("Cloud run cancellation uses the documented DELETE endpoint and preserves HTTP failures", async () => {
  await cancelCloudRun("run/id", "test-only", async (url, init) => {
    assert.equal(url, "https://api.inngest.com/v1/runs/run%2Fid");
    assert.equal(init?.method, "DELETE");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-only");
    return new Response(null, { status: 200 });
  });
  await assert.rejects(cancelCloudRun("run", "test-only", async () => new Response(null, { status: 404 })), /HTTP 404/);
});

test("host-cloud mode and callback configuration reject invalid input", () => {
  assert.equal(deploymentMode(), "deploy");
  for (const mode of ["host-cloud", "host-only", "deploy", "teardown"]) assert.equal(deploymentMode(mode), mode);
  assert.throws(() => deploymentMode(""), /Use deploy/);
  assert.throws(() => deploymentMode("unknown"), /Use deploy/);
  assert.equal(callbackOrigin(), "https://worker-not-configured.invalid");
  assert.equal(callbackOrigin("https://example.workers.dev/"), "https://example.workers.dev");
  for (const value of ["", "http://example.com", "https://user:password@example.com", "https://example.com/path"]) {
    assert.throws(() => callbackOrigin(value));
  }
});

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

test("deployment subprocesses accept stdin, allow only required environment and redact failures", async () => {
  assert.equal(await command(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], "test-only"), "test-only");
  const denied = ["DOCKER_ID", "DOCKER_CLOUD_SANDBOX_TOKEN", "INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY", "CALLBACK_SECRET", "FRONTDOOR_TOKEN", "YT_COOKIES", "YT_PROXY", "UNRELATED_SECRET"];
  const names = [...denied, "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = "test-only";
    assert.equal(await command(process.execPath, ["-e", `process.stdout.write(String(${JSON.stringify(denied)}.every(name => !process.env[name]) && process.env.CLOUDFLARE_API_TOKEN === 'test-only' && process.env.CLOUDFLARE_ACCOUNT_ID === 'test-only'))`]), "true");
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
  await assert.rejects(command(process.execPath, ["-e", "console.error('test-secret');process.exit(1)"]), (error: Error) => !error.message.includes("test-secret"));
});

test("deployment polling handles ready, empty and error cases", async () => {
  assert.equal(await until(async () => "ready", 10, 1), "ready");
  await assert.rejects(until(async () => undefined, 1, 1), /Timed out/);
  await assert.rejects(until(async () => { throw new Error("offline"); }, 10, 1), /offline/);
  assert.throws(() => required("WF_NONEXISTENT_TEST_SETTING"), /Missing WF_NONEXISTENT_TEST_SETTING/);
});
