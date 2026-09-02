import { expect, test } from "@playwright/test";

test("jobs API reports its durable storage state", async ({ request }) => {
  const response = await request.get("/api/jobs");

  if (response.status() === 200) {
    await expect(response.json()).resolves.toMatchObject({ jobs: [] });
    return;
  }

  expect(response.status()).toBe(503);
  await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("DATABASE_URL") });
});
