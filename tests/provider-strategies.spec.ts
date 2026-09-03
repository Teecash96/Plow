import { expect, test } from "@playwright/test";
import type { Address } from "viem";
import {
  buildLiveProviderExecutionResult,
  type BscChainSnapshot,
  type ProviderHealthFactorSnapshot,
  type ProviderPoolSnapshot,
  type ProviderTelemetryReader,
  type ProviderYieldVaultSnapshot,
} from "../src/lib/marketplace/provider-strategies";
import type { ProviderExecutionRequest } from "../src/lib/marketplace/provider-service";

test.describe.configure({ mode: "serial" });

const POOL = "0x1111111111111111111111111111111111111111" as Address;
const LENDING_POOL = "0x2222222222222222222222222222222222222222" as Address;
const ACCOUNT = "0x3333333333333333333333333333333333333333" as Address;
const TARGET_ACCOUNT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const VAULT_A = "0x4444444444444444444444444444444444444444" as Address;
const VAULT_B = "0x5555555555555555555555555555555555555555" as Address;

const chain: BscChainSnapshot = {
  chainId: 56,
  blockNumber: "50000000",
  blockTimestamp: "2026-09-01T12:00:00.000Z",
};

const pool: ProviderPoolSnapshot = {
  address: POOL,
  token0: "0x6666666666666666666666666666666666666666",
  token1: "0x7777777777777777777777777777777777777777",
  token0Symbol: "WBNB",
  token1Symbol: "USDT",
  token0Decimals: 18,
  token1Decimals: 18,
  feeTier: "0.05%",
  tick: 12,
  liquidity: "1000000",
  spotPriceToken1PerToken0: "600.00000000",
};

const vaultSnapshots: Record<string, ProviderYieldVaultSnapshot> = {
  [VAULT_A]: {
    address: VAULT_A,
    name: "Stable Route",
    asset: "0x8888888888888888888888888888888888888888",
    assetSymbol: "USDT",
    totalAssets: "1000000",
    totalSupply: "1000000",
    assetsPerShare: "1.02000000",
  },
  [VAULT_B]: {
    address: VAULT_B,
    name: "Conservative Route",
    asset: "0x9999999999999999999999999999999999999999",
    assetSymbol: "USDT",
    totalAssets: "500000",
    totalSupply: "500000",
    assetsPerShare: "1.01000000",
  },
};

const health: ProviderHealthFactorSnapshot = {
  poolAddress: LENDING_POOL,
  account: ACCOUNT,
  totalCollateralBase: "1000000000",
  totalDebtBase: "700000000",
  currentLiquidationThreshold: "8000",
  healthFactor: "1.14200000",
};

function request(category: string, taskSummary: string): ProviderExecutionRequest {
  return {
    protocol: "plow-agent-execution-v1",
    job: {
      id: "job-strategy-001",
      agentId: "42",
      agentIdentityId: "42",
      marketplaceAgentId: "erc8004-bsc-42",
      status: "active",
      taskSummary,
      category,
      clientAddress: ACCOUNT,
      onchainNetwork: "BSC Mainnet",
      onchainChainId: 56,
      termsHash: "0xterms-hash",
      price: "0.25",
      currency: "U",
      onchainJobId: "7",
      payment: {
        status: "paid",
        amount: "0.25",
        currency: "U",
        transactionHash: `0x${"1".repeat(64)}`,
      },
    },
  };
}

const reader: ProviderTelemetryReader = {
  async readChainSnapshot() {
    return chain;
  },
  async readPoolSnapshot() {
    return pool;
  },
  async readYieldVaultSnapshot(address, name) {
    return { ...vaultSnapshots[address], name };
  },
  async readHealthFactorSnapshot() {
    return health;
  },
};

test.afterEach(() => {
  delete process.env.PLOW_PROVIDER_POOL_ADDRESS;
  delete process.env.PLOW_PROVIDER_YIELD_VAULTS;
  delete process.env.PLOW_PROVIDER_YIELD_VAULT_ADDRESSES;
  delete process.env.PLOW_PROVIDER_LENDING_POOL_ADDRESS;
  delete process.env.PLOW_PROVIDER_HEALTH_ACCOUNT_ADDRESS;
});

test("runs a live rebalancing provider against BSC pool telemetry", async () => {
  const result = await buildLiveProviderExecutionResult(
    request("rebalancing", `Review pool ${POOL} range 590 to 610.`),
    { reader },
  );

  expect(result.status).toBe("completed");
  expect(result.resultSummary).toContain("Rebalancing provider");
  expect(result.resultSummary).toContain("block 50000000");
  expect(result.resultSummary).toContain("Spot is inside the requested range");
  expect(result.resultSummary).toContain("No DeFi transaction was attempted");
});

test("runs a live grid provider and returns bounded levels without placing orders", async () => {
  const result = await buildLiveProviderExecutionResult(
    request("grid-trading", `Build grid levels 4 for pool ${POOL} with band 10%.`),
    { reader },
  );

  expect(result.status).toBe("completed");
  expect(result.resultSummary).toContain("Grid trading provider");
  expect(result.resultSummary).toContain("Proposed 4 price levels");
  expect(result.resultSummary).toContain("540.00000000");
  expect(result.resultSummary).toContain("660.00000000");
  expect(result.resultSummary).toContain("No order was placed");
});

test("runs a live yield provider and compares configured vaults", async () => {
  process.env.PLOW_PROVIDER_YIELD_VAULTS = JSON.stringify([
    { address: VAULT_A, name: "Stable Route" },
    { address: VAULT_B, name: "Conservative Route" },
  ]);
  const result = await buildLiveProviderExecutionResult(
    request("yield-optimisation", "Compare the configured yield routes."),
    { reader },
  );

  expect(result.status).toBe("completed");
  expect(result.resultSummary).toContain("Yield optimisation provider");
  expect(result.resultSummary).toContain("1. Stable Route 1.02000000 per share");
  expect(result.resultSummary).toContain("This is not an APY calculation");
  expect(result.resultSummary).toContain("No deposit or withdrawal was attempted");
});

test("runs a live health provider and raises a threshold alert", async () => {
  process.env.PLOW_PROVIDER_LENDING_POOL_ADDRESS = LENDING_POOL;
  const result = await buildLiveProviderExecutionResult(
    request("health-factor-monitoring", "Alert below 1.2."),
    { reader },
  );

  expect(result.status).toBe("completed");
  expect(result.resultSummary).toContain("Health factor monitoring provider");
  expect(result.resultSummary).toContain("health factor 1.14200000");
  expect(result.resultSummary).toContain("Alert: health factor 1.14200000 is below 1.2");
  expect(result.resultSummary).toContain("No liquidation or repayment was attempted");
});

test("monitors an explicit health account and explains when it has no debt", async () => {
  process.env.PLOW_PROVIDER_LENDING_POOL_ADDRESS = LENDING_POOL;
  const noDebtReader: ProviderTelemetryReader = {
    ...reader,
    async readHealthFactorSnapshot(poolAddress, account) {
      return {
        ...health,
        poolAddress,
        account,
        totalDebtBase: "0",
        healthFactor: "not applicable",
        hasActiveDebt: false,
      };
    },
  };
  const result = await buildLiveProviderExecutionResult(
    request("health-factor-monitoring", `Monitor account ${TARGET_ACCOUNT}. Alert below 1.2.`),
    { reader: noDebtReader },
  );

  expect(result.status).toBe("completed");
  expect(result.resultSummary).toContain(`account ${TARGET_ACCOUNT}`);
  expect(result.resultSummary).toContain("account has no active debt");
  expect(result.resultSummary).toContain("health factor not applicable");
});

test("fails closed for an unsupported provider category", async () => {
  await expect(buildLiveProviderExecutionResult(
    request("uncategorised", "Do something.")
    , { reader },
  )).rejects.toMatchObject({ status: 409 });
});
