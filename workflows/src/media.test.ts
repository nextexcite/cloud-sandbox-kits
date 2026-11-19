import { test } from "node:test";
import assert from "node:assert/strict";
import { NonRetriableError } from "inngest";
import { mediaFunctions } from "./media.js";

test("media runner failures reject the function and always schedule cleanup", async () => {
  for (const status of ["completed", "needs_cookies", "failed", "timeout"]) {
    const steps: string[] = [];
    const result = { status, result: {} };
    const handler = Reflect.get(mediaFunctions[0], "fn") as (context: unknown) => Promise<unknown>;
    const run = handler({ event: { data: { jobId: "11111111-1111-1111-1111-111111111111" } }, step: {
      run: async (id: string) => {
        steps.push(id);
        if (id === "create-install-detach") return { name: "test", timings: {} };
        if (id === "read-artifacts") return result;
        return {};
      },
      waitForEvent: async () => status === "timeout" ? null : { data: { status } },
    } });
    if (status === "failed") await assert.rejects(run, NonRetriableError);
    else if (status === "timeout") await assert.rejects(run, /timed out/);
    else assert.equal(await run, result);
    assert.equal(steps.filter((id) => id === "delete-sandbox").length, 1);
  }
});
