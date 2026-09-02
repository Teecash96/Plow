import { expect, test } from "@playwright/test";
import { executeRemoteJob } from "@/lib/marketplace/job-api";

test("quick hire starts the agent through the durable jobs API", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: string; method?: string }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ input: String(input), method: init?.method });
    return new Response(JSON.stringify({ job: { id: "quick-job-1" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await expect(executeRemoteJob("quick-job-1")).resolves.toMatchObject({ id: "quick-job-1" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(calls).toEqual([{ input: "/api/jobs/quick-job-1/execute", method: "POST" }]);
});
