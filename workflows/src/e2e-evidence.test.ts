import { test } from "node:test";
import assert from "node:assert/strict";
import { maskSandboxIds, withFallbackSweep } from "./e2e-evidence.js";

test("listing masking preserves names, statuses and column positions", () => {
  const raw = "SANDBOX  ID                              STATUS\nexisting sbx_001m4hg9m677jx1bpkeh39fdq5b   ○ stopped\n";
  const masked = maskSandboxIds(raw);
  assert.ok(masked.includes("existing sbx_<masked>"));
  assert.ok(!masked.includes("sbx_001m4hg9m677jx1bpkeh39fdq5b"));
  assert.equal(masked.indexOf("○ stopped"), raw.indexOf("○ stopped"));
  assert.equal(maskSandboxIds(""), "");
});
test("diagnostic failures still sweep and remain failures", async () => {
  for (const failure of ["listing failed", "results write failed"]) {
    let swept = false;
    await assert.rejects(withFallbackSweep(async () => { throw new Error(failure); }, async () => { swept = true; }), { message: failure });
    assert.equal(swept, true);
  }
  let swept = false;
  assert.equal(await withFallbackSweep(async () => "evidence", async () => { swept = true; }), "evidence");
  assert.equal(swept, true);
});
