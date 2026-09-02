import { expect, test } from "@playwright/test";

test("runs the no funds sandbox and labels every proof step as simulated", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  const jobPosts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/jobs")) jobPosts.push(request.url());
  });

  await page.goto("/hire/demo-rebalancer-001", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Run no funds simulation" })).toBeVisible();
  await page.getByLabel("Task description").first().fill("Return a bounded readiness report without moving funds.");
  await page.getByRole("button", { name: "Run no funds simulation" }).first().click();

  await expect(page).toHaveURL(/\/jobs\/simulation-/);
  await expect(page.getByText("Simulation only", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/No wallet request, payment token transfer, database write/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Execution proof" })).toBeVisible();
  await expect(page.getByText("x402 payment", { exact: true })).toBeVisible();
  await expect(page.getByText("Agent execution", { exact: true })).toBeVisible();
  await expect(page.getByText("No real result was produced.", { exact: false })).toBeVisible();
  expect(jobPosts).toEqual([]);
});
