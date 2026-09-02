import { expect, test } from "@playwright/test";
import type { Address, Hex, PublicClient, WalletClient } from "viem";
import {
  assertPancakeSwapRebalancePolicy,
  executePancakeSwapRebalance,
  type PancakeSwapRebalanceConfig,
  quotePancakeSwapRebalanceAtomic,
  REBALANCE_ERC20_ABI,
} from "@/lib/chain/pancakeswap-rebalance";
import type { SessionPermission } from "@/lib/marketplace/types";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const ROUTER = "0x2222222222222222222222222222222222222222" as Address;
const TOKEN_IN = "0x3333333333333333333333333333333333333333" as Address;
const TOKEN_OUT = "0x4444444444444444444444444444444444444444" as Address;
const WRONG_TOKEN = "0x5555555555555555555555555555555555555555" as Address;
const APPROVAL_HASH = `0x${"aa".repeat(32)}` as Hex;
const SWAP_HASH = `0x${"bb".repeat(32)}` as Hex;

const CONFIG: PancakeSwapRebalanceConfig = {
  chainId: 56,
  networkName: "BSC Mainnet",
  paymentTokenAddress: TOKEN_IN,
  routerAddress: ROUTER,
  tokenInAddress: TOKEN_IN,
  tokenOutAddress: TOKEN_OUT,
  maxSlippageBps: 100,
  enabled: true,
  missing: [],
};

function permission(overrides: Partial<SessionPermission> = {}): SessionPermission {
  return {
    provider: "Altana",
    spendCap: "10",
    currency: "USDC",
    allowlistedContracts: [ROUTER],
    allowlistedTokens: [TOKEN_IN, TOKEN_OUT],
    expiresAt: "24 hours",
    expiresAtTimestamp: "2099-01-01T00:00:00.000Z",
    status: "active",
    templateId: "rebalance-test",
    revokeSupported: false,
    source: "job",
    ...overrides,
  };
}

function fakeClients(outputMultiplier = BigInt(2)) {
  let allowance = BigInt(0);
  let multiplier = outputMultiplier;
  const writes: Array<Record<string, unknown>> = [];
  const publicClient = {
    getChainId: async () => 56,
    getCode: async () => "0x1234",
    readContract: async (request: { address: Address; functionName: string; args?: readonly unknown[] }) => {
      if (request.functionName === "decimals") return 6;
      if (request.functionName === "symbol") return request.address.toLowerCase() === TOKEN_IN.toLowerCase() ? "USDC" : "DAI";
      if (request.functionName === "balanceOf") return BigInt(10_000_000);
      if (request.functionName === "allowance") return allowance;
      if (request.functionName === "getAmountsOut") {
        const amount = request.args?.[0] as bigint;
        return [amount, amount * multiplier];
      }
      throw new Error(`Unexpected read ${request.functionName}`);
    },
    waitForTransactionReceipt: async () => ({ status: "success" as const }),
  } as unknown as PublicClient;
  const walletClient = {
    writeContract: async (request: Record<string, unknown>) => {
      writes.push(request);
      const args = request.args as readonly unknown[];
      if (request.functionName === "approve") allowance = args[1] as bigint;
      return request.functionName === "approve" ? APPROVAL_HASH : SWAP_HASH;
    },
  } as unknown as WalletClient;
  return {
    publicClient,
    walletClient,
    writes,
    setMultiplier(value: bigint) { multiplier = value; },
  };
}

test("requires the fixed pair and both permission token allowlists", () => {
  expect(() => assertPancakeSwapRebalancePolicy({
    permission: permission({ allowlistedTokens: [TOKEN_IN] }),
    config: CONFIG,
    routerAddress: ROUTER,
    tokenInAddress: TOKEN_IN,
    tokenOutAddress: TOKEN_OUT,
    amountInAtomic: BigInt(1_000_000),
    minimumAmountOutAtomic: BigInt(1_000_000),
    tokenInDecimals: 6,
    tokenInSymbol: "USDC",
    deadline: BigInt(Math.floor(Date.now() / 1000) + 60),
  })).toThrow("allowlist");

  expect(() => assertPancakeSwapRebalancePolicy({
    permission: permission(),
    config: CONFIG,
    routerAddress: ROUTER,
    tokenInAddress: TOKEN_IN,
    tokenOutAddress: WRONG_TOKEN,
    amountInAtomic: BigInt(1_000_000),
    minimumAmountOutAtomic: BigInt(1_000_000),
    tokenInDecimals: 6,
    tokenInSymbol: "USDC",
    deadline: BigInt(Math.floor(Date.now() / 1000) + 60),
  })).toThrow("configured PancakeSwap pair");

  expect(() => assertPancakeSwapRebalancePolicy({
    permission: permission(),
    config: CONFIG,
    routerAddress: ROUTER,
    tokenInAddress: TOKEN_IN,
    tokenOutAddress: TOKEN_OUT,
    amountInAtomic: BigInt(11_000_000),
    minimumAmountOutAtomic: BigInt(1_000_000),
    tokenInDecimals: 6,
    tokenInSymbol: "USDC",
    deadline: BigInt(Math.floor(Date.now() / 1000) + 60),
  })).toThrow("spend cap");

  expect(() => assertPancakeSwapRebalancePolicy({
    permission: permission(),
    config: CONFIG,
    routerAddress: ROUTER,
    tokenInAddress: TOKEN_IN,
    tokenOutAddress: TOKEN_OUT,
    amountInAtomic: BigInt(1_000_000),
    minimumAmountOutAtomic: BigInt(1_000_000),
    tokenInDecimals: 6,
    tokenInSymbol: "USDC",
    deadline: BigInt(Math.floor(Date.now() / 1000) + 301),
  })).toThrow("five minute");
});

test("quotes a fixed pair and executes one exact approval followed by one swap", async () => {
  const clients = fakeClients();
  const quoted = await quotePancakeSwapRebalanceAtomic({ publicClient: clients.publicClient, permission: permission(), amountInAtomic: BigInt(1_000_000), account: ACCOUNT, config: CONFIG });
  expect(quoted.quotedAmountOutAtomic).toBe(BigInt(2_000_000));
  expect(quoted.minimumAmountOutAtomic).toBe(BigInt(1_980_000));

  const submitted: string[] = [];
  const result = await executePancakeSwapRebalance({
    wallet: { account: ACCOUNT, chainId: 56, walletClient: clients.walletClient, publicClient: clients.publicClient },
    permission: permission(),
    quote: quoted,
    config: CONFIG,
    onApprovalSubmitted: async (hash) => { submitted.push(`approval:${hash}`); },
    onSwapSubmitted: async (hash) => { submitted.push(`swap:${hash}`); },
  });

  expect(result.transactionHash).toBe(SWAP_HASH);
  expect(result.approvalTransactionHash).toBe(APPROVAL_HASH);
  expect(submitted).toEqual([`approval:${APPROVAL_HASH}`, `swap:${SWAP_HASH}`]);
  expect(clients.writes).toHaveLength(2);
  expect(clients.writes[0].functionName).toBe("approve");
  expect(clients.writes[0].args).toEqual([ROUTER, BigInt(1_000_000)]);
  expect(clients.writes[1].functionName).toBe("swapExactTokensForTokens");
  const swapArgs = clients.writes[1].args as readonly unknown[];
  expect(swapArgs.slice(0, 4)).toEqual([BigInt(1_000_000), BigInt(1_980_000), [TOKEN_IN, TOKEN_OUT], ACCOUNT]);
  expect(typeof swapArgs[4]).toBe("bigint");
  expect(clients.writes[1].value).toBeUndefined();
  expect(REBALANCE_ERC20_ABI).toBeDefined();
});

test("stops before any wallet write when the displayed quote changes", async () => {
  const clients = fakeClients();
  const quoted = await quotePancakeSwapRebalanceAtomic({ publicClient: clients.publicClient, permission: permission(), amountInAtomic: BigInt(1_000_000), account: ACCOUNT, config: CONFIG });
  clients.setMultiplier(BigInt(3));

  await expect(executePancakeSwapRebalance({
    wallet: { account: ACCOUNT, chainId: 56, walletClient: clients.walletClient, publicClient: clients.publicClient },
    permission: permission(),
    quote: quoted,
    config: CONFIG,
  })).rejects.toThrow("quote changed");
  expect(clients.writes).toHaveLength(0);
});
