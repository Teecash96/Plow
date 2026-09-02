import { expect, test } from "@playwright/test";

test("provider onboarding presents a controlled ERC 8004 registration flow", async ({ page }) => {
  await page.goto("/provider");

  await expect(page.getByRole("heading", { name: "Create an identity you control" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create new ERC 8004 identity" })).toBeVisible();
  await expect(page.getByLabel("Public provider URL")).toBeVisible();
  await expect(page.getByLabel("ERC 8004 agent ID")).toBeVisible();
  await expect(page.getByText("BSC Mainnet wallet required")).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});
