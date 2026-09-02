import { expect, test } from "@playwright/test";

test("unavailable agent records cannot be hired from browse", async ({ page }) => {
  await page.goto("/agents", { waitUntil: "domcontentloaded" });

  const demoCard = page.locator("article").filter({ hasText: "Demo fixture" }).first();
  await expect(demoCard).toBeVisible();
  await expect(demoCard.getByRole("link", { name: "Preview" })).toBeVisible();
  await expect(demoCard.getByRole("link", { name: "Hire" })).toHaveCount(0);
});

test("unavailable agent readiness is shown as a required hire check", async ({ page }) => {
  await page.goto("/hire/demo-rebalancer-001", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Live hiring is blocked" })).toBeVisible();
  await expect(page.getByText("Agent service readiness")).toBeVisible();
});

test("hire page offers one primary action with advanced settings collapsed", async ({ page }) => {
  await page.goto("/hire/demo-rebalancer-001", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Hire and run an agent in one click" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hire and run task" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Hiring steps" })).toHaveCount(0);
  await expect(page.getByText("Advanced settings")).toBeVisible();
  await expect(page.getByText("The agent starts automatically after funding.")).toBeVisible();
});

test("defaults to an expiry that covers the evaluator dispute window", async ({ page }) => {
  await page.goto("/hire/demo-rebalancer-001", { waitUntil: "domcontentloaded" });

  const expiration = page.locator("#expiration").first();
  await expect(expiration).toHaveValue("14 days");
  await expect(expiration.locator("option", { hasText: "14 days" })).toHaveCount(1);
});
