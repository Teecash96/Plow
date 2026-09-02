import { expect, test } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex, PublicClient, WalletClient } from "viem";
import {
  buildProviderDeliverableHash,
  getProviderSignerStatus,
  submitProviderExecution,
} from "../src/lib/marketplace/provider-submission";
import { buildProviderExecutionResult, parseProviderExecutionRequest } from "../src/lib/marketplace/provider-service";

test.describe.configure({ mode: "serial" });

const PRIVATE_KEY = "0x0123456789012345678901234567890123456789012345678901234567890123" as Hex;
const signer = privateKeyToAccount(PRIVATE_KEY);
const CONTRACT = "0x3333333333333333333333333333333333333333" as Address;
const TOKEN = "0x4444444444444444444444444444444444444444" as Address;
const ROUTER = "0x5555555555555555555555555555555555555555" as Address;
const POLICY = "0x6666666666666666666666666666666666666666" as Address;
const CLIENT = "0x7777777777777777777777777777777777777777" as Address;
const SUBMISSION_TRANSACTION = `0x${"9".repeat(64)}` as Hex;

const ENV_KEYS = [
  "PLOW_PROVIDER_ENABLED",
  "PLOW_PROVIDER_AGENT_ID",
  "PLOW_PROVIDER_PRICE",
  "PLOW_PROVIDER_CURRENCY",
  "PLOW_PROVIDER_REQUEST_SECRET",
  "PLOW_PROVIDER_PRIVATE_KEY",
  "PLOW_PROVIDER_PUBLIC_URL",
  "NEXT_PUBLIC_HIRE_NETWORK",
  "NEXT_PUBLIC_ERC8183_CONTRACT_ADDRESS",
  "NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS",
  "NEXT_PUBLIC_ERC8183_ROUTER_ADDRESS",
  "NEXT_PUBLIC_ERC8183_POLICY_ADDRESS",
  "NEXT_PUBLIC_BSC_RPC_URL",
  "PLOW_PROVIDER_PROFILES",
] as const;

function setEnvironment() {
  process.env.PLOW_PROVIDER_ENABLED = "true";
  process.env.PLOW_PROVIDER_AGENT_ID = "42";
  process.env.PLOW_PROVIDER_PRICE = "0.25";
  process.env.PLOW_PROVIDER_CURRENCY = "USDC";
  process.env.PLOW_PROVIDER_REQUEST_SECRET = "provider-test-secret-012345678901234567890123";
  process.env.PLOW_PROVIDER_PRIVATE_KEY = PRIVATE_KEY;
  process.env.PLOW_PROVIDER_PUBLIC_URL = "https://provider.example";
  process.env.NEXT_PUBLIC_HIRE_NETWORK = "bsc-mainnet";
  process.env.NEXT_PUBLIC_ERC8183_CONTRACT_ADDRESS = CONTRACT;
  process.env.NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS = TOKEN;
  process.env.NEXT_PUBLIC_ERC8183_ROUTER_ADDRESS = ROUTER;
  process.env.NEXT_PUBLIC_ERC8183_POLICY_ADDRESS = POLICY;
  process.env.NEXT_PUBLIC_BSC_RPC_URL = "https://bsc.example";
  delete process.env.PLOW_PROVIDER_PROFILES;
}

function clearEnvironment() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function request() {
  return parseProviderExecutionRequest(JSON.stringify({
    protocol: "plow-agent-execution-v1",
    job: {
      id: "job-provider-submission-001",
      agentId: "42",
      agentIdentityId: "42",
      marketplaceAgentId: "erc8004-bsc-42",
      status: "active",
      taskSummary: "Return a bounded test result.",
      category: "rebalancing",
      clientAddress: CLIENT,
      onchainNetwork: "BSC Mainnet",
      onchainChainId: 56,
      termsHash: "0xterms-hash",
      price: "0.25",
      currency: "USDC",
      onchainJobId: "7",
      payment: {
        status: "paid",
        amount: "0.25",
        currency: "USDC",
        transactionHash: `0x${"1".repeat(64)}`,
      },
    },
  }));
}

function chainJob(requested = request()) {
  return {
    id: BigInt(requested.job.onchainJobId),
    client: CLIENT,
    provider: signer.address,
    evaluator: ROUTER,
    description: JSON.stringify({
      marketplaceJobId: requested.job.id,
      marketplaceAgentId: requested.job.marketplaceAgentId,
      agentId: requested.job.agentId,
      client: requested.job.clientAddress,
      task: requested.job.taskSummary,
      category: requested.job.category,
      termsHash: requested.job.termsHash,
    }),
    budget: BigInt(250000),
    expiredAt: BigInt(Math.floor(Date.now() / 1000) + 3_600),
    status: 1,
    hook: ROUTER,
    submittedAt: BigInt(0),
    deliverable: "0x" as Hex,
  };
}

test.beforeEach(setEnvironment);
test.afterEach(clearEnvironment);

test("reports the provider signer address without exposing its key", () => {
  expect(getProviderSignerStatus()).toEqual({
    configured: true,
    address: signer.address,
    reason: "The provider signer is ready.",
  });
});

test("selects the signer owned by the matching provider profile", () => {
  const secondKey = `0x${"2".repeat(64)}` as Hex;
  const secondSigner = privateKeyToAccount(secondKey);
  process.env.PLOW_PROVIDER_PROFILES = JSON.stringify([
    { agentId: "42", categories: ["rebalancing"], price: "0.25", currency: "USDC", privateKey: PRIVATE_KEY },
    { agentId: "43", categories: ["grid-trading"], price: "0.25", currency: "USDC", privateKey: secondKey },
  ]);

  expect(getProviderSignerStatus("43")).toEqual({
    configured: true,
    address: secondSigner.address,
    reason: "The provider signer is ready.",
  });
  expect(getProviderSignerStatus("999")).toMatchObject({
    configured: false,
    reason: /No profile is configured for agent 999/,
  });
});

test("submits and verifies a deterministic deliverable for the funded job", async () => {
  const parsed = request();
  const firstJob = chainJob(parsed);
  const providerResult = buildProviderExecutionResult(parsed);
  const submittedJob = {
    ...firstJob,
    status: 2,
    submittedAt: BigInt(Math.floor(Date.now() / 1000)),
    deliverable: buildProviderDeliverableHash(parsed, providerResult.resultSummary),
  };
  let readCount = 0;
  let writeArgs: Record<string, unknown> | undefined;
  const publicClient = {
    waitForTransactionReceipt: async () => ({ status: "success" as const }),
  } as unknown as PublicClient;
  const walletClient = {
    writeContract: async (args: Record<string, unknown>) => {
      writeArgs = args;
      return SUBMISSION_TRANSACTION;
    },
  } as unknown as WalletClient;

  const result = await submitProviderExecution(parsed, {
    publicClient,
    walletClient,
    readJob: async () => {
      readCount += 1;
      return readCount === 1 ? firstJob : submittedJob;
    },
    readToken: async () => ({ address: TOKEN, decimals: 6, symbol: "USDC" }),
  });

  const expectedHash = buildProviderDeliverableHash(parsed, result.resultSummary);
  expect(result).toEqual({
    status: "completed",
    resultSummary: "Rebalancing strategy accepted: Return a bounded test result.",
    deliverableHash: expectedHash,
    submissionTransactionHash: SUBMISSION_TRANSACTION,
  });
  expect(writeArgs).toMatchObject({
    address: CONTRACT,
    functionName: "submit",
    args: [BigInt(7), expectedHash, "0x"],
  });
  expect(writeArgs?.account).toMatchObject({ address: signer.address, type: "local" });
  expect(typeof (writeArgs?.account as { signTransaction?: unknown } | undefined)?.signTransaction).toBe("function");
});

test("does not submit when the signer is not the on chain provider", async () => {
  const parsed = request();
  const wrongProviderJob = { ...chainJob(parsed), provider: CLIENT };
  const publicClient = {
    waitForTransactionReceipt: async () => ({ status: "success" as const }),
  } as unknown as PublicClient;
  const walletClient = {
    writeContract: async () => SUBMISSION_TRANSACTION,
  } as unknown as WalletClient;

  await expect(submitProviderExecution(parsed, {
    publicClient,
    walletClient,
    readJob: async () => wrongProviderJob,
    readToken: async () => ({ address: TOKEN, decimals: 6, symbol: "USDC" }),
  })).rejects.toMatchObject({
    code: "mismatch",
    status: 409,
    message: "The provider signer does not own the funded ERC 8183 job.",
  });
});

test("fails closed when the provider signer is absent", async () => {
  delete process.env.PLOW_PROVIDER_PRIVATE_KEY;
  await expect(submitProviderExecution(request())).rejects.toMatchObject({
    code: "not-configured",
    status: 503,
    message: "Provider submission is not configured. Add PLOW_PROVIDER_PRIVATE_KEY on the provider server.",
  });
});
