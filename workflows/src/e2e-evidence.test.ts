import { test } from "node:test";
import assert from "node:assert/strict";
import { maskSandboxIds } from "./e2e-evidence.js";

test("listing masking preserves names, statuses and column positions", () => {
  const raw = "SANDBOX  ID                              STATUS\nexisting sbx_001m4hg9m677jx1bpkeh39fdq5b   ○ stopped\n";
  const masked = maskSandboxIds(raw);
  assert.ok(masked.includes("existing sbx_<masked>"));
  assert.ok(!masked.includes("sbx_001m4hg9m677jx1bpkeh39fdq5b"));
  assert.equal(masked.indexOf("○ stopped"), raw.indexOf("○ stopped"));
  assert.equal(maskSandboxIds(""), "");
});
