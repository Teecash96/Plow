import { expect, test } from "@playwright/test";
import { decodeFunctionResult, encodeAbiParameters, parseAbiParameters, type Hex, type PublicClient, type WalletClient } from "viem";
import { ERC8183_ABI, ERC8183_POLICY_ABI, fundERC8183Job } from "@/lib/chain/erc8183-adapter";
import type { SessionPermission } from "@/lib/marketplace/types";

test.describe.configure({ mode: "serial" });

const CONTRACT = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const TOKEN = "0x2222222222222222222222222222222222222222" as `0x${string}`;
const ACCOUNT = "0x3333333333333333333333333333333333333333" as `0x${string}`;
const FUNDING_HASH = `0x${"ab".repeat(32)}` as Hex;
const permission: SessionPermission = {
  provider: "Altana",
  spendCap: "1",
  currency: "USDC",
  allowlistedContracts: [CONTRACT],
  allowlistedTokens: [TOKEN],
  expiresAt: "24 hours",
  expiresAtTimestamp: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  status: "active",
};

const ENV_KEYS = [
  "NEXT_PUBLIC_HIRE_NETWORK",
  "NEXT_PUBLIC_ERC8183_CONTRACT_ADDRESS",
  "NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS",
] as const;
const originalEnvironment = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

test.beforeEach(() => {
  process.env.NEXT_PUBLIC_HIRE_NETWORK = "bsc-mainnet";
  process.env.NEXT_PUBLIC_ERC8183_CONTRACT_ADDRESS = CONTRACT;
  process.env.NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS = TOKEN;
});

test.afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function fundingInput(publicClient: PublicClient, onTransactionBroadcast?: (hash: Hex) => Promise<void> | void) {
  return {
    walletClient: {
      writeContract: async () => FUNDING_HASH,
    } as unknown as WalletClient,
    publicClient,
    account: ACCOUNT,
    jobId: BigInt(7),
    amount: BigInt(250_000),
    permission,
    tokenAddress: TOKEN,
    tokenDecimals: 6,
    spentAmountAtomic: BigInt(0),
    onTransactionBroadcast,
  };
}

test("decodes the deployed ERC 8183 job return shape", () => {
  const output = encodeAbiParameters(parseAbiParameters([
    "(uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook, uint256 submittedAt, bytes32 deliverable)",
  ]), [{
    id: BigInt(7),
    client: "0x1111111111111111111111111111111111111111",
    provider: "0x2222222222222222222222222222222222222222",
    evaluator: "0x3333333333333333333333333333333333333333",
    description: "test",
    budget: BigInt(250000),
    expiredAt: BigInt(1_800_000_000),
    status: 0,
    hook: "0x4444444444444444444444444444444444444444",
    submittedAt: BigInt(0),
    deliverable: `0x${"11".repeat(32)}`,
  }]);

  const job = decodeFunctionResult({ abi: ERC8183_ABI, functionName: "getJob", data: output });
  expect(job.deliverable).toBe(`0x${"11".repeat(32)}`);
});

test("decodes the optimistic policy decision shape", () => {
  const output = encodeAbiParameters(parseAbiParameters(["uint8 verdict", "bytes32 reason"]), [
    1,
    `0x${"22".repeat(32)}`,
  ]);

  const decision = decodeFunctionResult({ abi: ERC8183_POLICY_ABI, functionName: "check", data: output });
  expect(decision).toEqual([1, `0x${"22".repeat(32)}`]);
});

test("records the funding hash before waiting for its receipt", async () => {
  const order: string[] = [];
  const publicClient = {
    waitForTransactionReceipt: async () => {
      order.push("wait");
      throw new Error("receipt timeout");
    },
  } as unknown as PublicClient;

  await expect(fundERC8183Job(fundingInput(publicClient, async () => {
    order.push("record");
  }))).rejects.toMatchObject({
    name: "ERC8183TransactionError",
    transactionHash: FUNDING_HASH,
  });
  expect(order).toEqual(["record", "wait"]);
});

test("returns the funding receipt after a successful wait", async () => {
  const receipt = { status: "success" };
  const publicClient = {
    waitForTransactionReceipt: async () => receipt,
  } as unknown as PublicClient;

  await expect(fundERC8183Job(fundingInput(publicClient))).resolves.toMatchObject({
    transactionHash: FUNDING_HASH,
    receipt,
  });
});

test("keeps the funding hash when the receipt is reverted or the audit record fails", async () => {
  const revertedClient = {
    waitForTransactionReceipt: async () => ({ status: "reverted" }),
  } as unknown as PublicClient;
  await expect(fundERC8183Job(fundingInput(revertedClient))).rejects.toMatchObject({
    name: "ERC8183TransactionError",
    transactionHash: FUNDING_HASH,
  });

  const receiptClient = {
    waitForTransactionReceipt: async () => ({ status: "success" }),
  } as unknown as PublicClient;
  await expect(fundERC8183Job(fundingInput(receiptClient, async () => {
    throw new Error("database unavailable");
  }))).rejects.toMatchObject({
    name: "ERC8183TransactionError",
    transactionHash: FUNDING_HASH,
  });
});
