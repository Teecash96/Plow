import { expect, test } from "@playwright/test";
import { PERMIT2_ADDRESS } from "@x402/evm";
import { assertHirePermissionPlan } from "@/lib/marketplace/hire-permission-plan";
import type { SessionPermission } from "@/lib/marketplace/types";

const CONTRACT = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;

test("accepts the live hire preflight plan before the first payment", () => {
  const permission: SessionPermission = {
    provider: "Altana",
    spendCap: "0.5",
    currency: "U",
    allowlistedContracts: [CONTRACT, PERMIT2_ADDRESS],
    allowlistedTokens: [TOKEN],
    expiresAt: "14 days",
    expiresAtTimestamp: "2099-01-01T00:00:00.000Z",
    status: "active",
    templateId: "hire-plan-test",
    revokeSupported: false,
    lastUpdatedAt: "2026-09-01T00:00:00.000Z",
    source: "job",
  };

  expect(() => assertHirePermissionPlan({
    permission,
    contractAddress: CONTRACT,
    tokenAddress: TOKEN,
    amountAtomic: BigInt(250_000),
    tokenDecimals: 6,
    currency: "U",
  })).not.toThrow();
});
