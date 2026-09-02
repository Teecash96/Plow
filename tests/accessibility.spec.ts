import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { AxeResults } from "axe-core";

const LOCAL_JOB_STORAGE_KEY = "plow.jobs.v1";

const localJob = {
  id: "a11y-job",
  agentId: "demo-rebalancer-001",
  agentName: "Range Steward Demo",
  category: "rebalancing",
  clientAddress: "Local draft",
  taskSummary: "Review a demo liquidity position and return a bounded range recommendation.",
  status: "draft",
  price: "Demo only",
  currency: "USDC",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  terms: {
    protocol: "ERC-8183",
    taskSummary: "Review a demo liquidity position and return a bounded range recommendation.",
    category: "rebalancing",
    expiresAt: "24 hours",
  },
  statusHistory: [
    { status: "draft", changedAt: "2026-01-01T00:00:00.000Z", note: "Created locally. No transaction was submitted." },
  ],
  permission: {
    provider: "Altana",
    spendCap: "Demo only",
    currency: "USDC",
    allowlistedContracts: [],
    allowlistedTokens: [],
    expiresAt: "24 hours",
    status: "draft",
    templateId: "altana-a11y-template",
    revokeSupported: false,
    lastUpdatedAt: "Demo fixture",
    source: "job",
  },
  payment: {
    protocol: "x402",
    status: "preview",
    amount: "Demo only",
    currency: "USDC",
  },
};

const pages = [
  { name: "homepage", path: "/" },
  { name: "agent browse", path: "/agents" },
  { name: "agent detail", path: "/agents/demo-rebalancer-001" },
  { name: "quick hire", path: "/hire/demo-rebalancer-001" },
  { name: "jobs list", path: "/jobs" },
  { name: "job detail", path: "/jobs/a11y-job", seedJob: true },
] as const;

const AXE_OPTIONS = {
  rules: {
    // Keep this explicit so a future axe configuration cannot silently skip contrast.
    "color-contrast": { enabled: true },
  },
};

function formatViolations(violations: AxeResults["violations"]) {
  return violations
    .map((violation) => {
      const targets = violation.nodes.map((node) => node.target.join(" ")).join(", ");
      return `${violation.id} (${violation.impact ?? "unknown"}) ${violation.help} at ${targets} ${violation.helpUrl}`;
    })
    .join("\n");
}

test.describe("WCAG automated audit", () => {
  for (const route of pages) {
    test(route.name, async ({ page }) => {
      if ("seedJob" in route && route.seedJob) {
        await page.addInitScript(({ key, value }) => {
          window.localStorage.setItem(key, JSON.stringify([value]));
        }, { key: LOCAL_JOB_STORAGE_KEY, value: localJob });
      }

      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).toBeVisible();
      await page.waitForTimeout(250);

      const results = await new AxeBuilder({ page }).options(AXE_OPTIONS).analyze();
      const contrastRule = [
        ...results.violations,
        ...results.incomplete,
        ...results.passes,
        ...results.inapplicable,
      ].find((rule) => rule.id === "color-contrast");
      expect(contrastRule, "The color-contrast rule did not execute").toBeDefined();
      expect(results.violations, formatViolations(results.violations)).toEqual([]);
    });
  }
});
