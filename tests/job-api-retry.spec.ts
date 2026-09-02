import { expect, test } from "@playwright/test";
import { reconcileRemoteJob } from "@/lib/marketplace/job-api";

test("retries transient reconciliation failures", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    if (attempts < 3) {
      return new Response(JSON.stringify({ error: "Temporary service failure." }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ job: { id: "reconcile-job-1" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await expect(reconcileRemoteJob("reconcile-job-1")).resolves.toMatchObject({ id: "reconcile-job-1" });
    expect(attempts).toBe(3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
