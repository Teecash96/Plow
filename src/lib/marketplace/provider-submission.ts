import {
  createWalletClient,
  http,
  isAddress,
  keccak256,
  toBytes,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";
import {
  createBscPublicClient,
  ERC8183_ABI,
  ERC8183_STATUS,
  getERC8183Config,
  parseERC20Amount,
  readERC8183Job,
  readPaymentToken,
  type ERC8183Config,
} from "@/lib/chain/erc8183-adapter";
import { createBscMainnetTransport } from "@/lib/chain/bsc-mainnet-rpc";
import {
  buildProviderExecutionResult,
  getProviderProfileForAgent,
  getProviderServiceConfig,
  type ProviderExecutionRequest,
  type ProviderExecutionResponse,
} from "./provider-service";

const REQUEST_TIMEOUT_MS = 20_000;
const PRIVATE_KEY_PATTERN = /^0x[a-fA-F0-9]{64}$/;

type ProviderSignerAccount = ReturnType<typeof privateKeyToAccount>;
type VerifiedJob = Awaited<ReturnType<typeof readERC8183Job>>;
type PaymentToken = Awaited<ReturnType<typeof readPaymentToken>>;

export interface ProviderSignerStatus {
  configured: boolean;
  address?: Address;
  reason: string;
}

export type ProviderSubmissionErrorCode =
  | "not-configured"
  | "unavailable"
  | "mismatch"
  | "not-funded"
  | "expired"
  | "reverted";

export class ProviderSubmissionError extends Error {
  readonly code: ProviderSubmissionErrorCode;
  readonly status: 409 | 502 | 503;

  constructor(message: string, code: ProviderSubmissionErrorCode, status: 409 | 502 | 503) {
    super(message);
    this.name = "ProviderSubmissionError";
    this.code = code;
    this.status = status;
  }
}

function privateKeyFromEnvironment(agentId?: string) {
  const providerConfig = getProviderServiceConfig();
  const profile = agentId
    ? getProviderProfileForAgent(agentId, providerConfig)
    : providerConfig.profiles[0];
  if (agentId && !profile) return undefined;
  const value = profile?.privateKey ?? (!agentId ? process.env.PLOW_PROVIDER_PRIVATE_KEY?.trim() : undefined);
  return value || undefined;
}

function readProviderSigner(agentId?: string): ProviderSignerAccount | undefined {
  const value = privateKeyFromEnvironment(agentId);
  if (!value || !PRIVATE_KEY_PATTERN.test(value)) return undefined;
  try {
    return privateKeyToAccount(value as Hex);
  } catch {
    return undefined;
  }
}

export function getProviderSignerStatus(agentId?: string): ProviderSignerStatus {
  const providerConfig = getProviderServiceConfig();
  const profile = agentId
    ? getProviderProfileForAgent(agentId, providerConfig)
    : providerConfig.profiles[0];
  if (providerConfig.profileMode && !profile) {
    return {
      configured: false,
      reason: agentId
        ? `Provider submission is not configured. No profile is configured for agent ${agentId}. Add it to PLOW_PROVIDER_PROFILES on the provider server.`
        : "Provider submission is not configured. Add at least one profile to PLOW_PROVIDER_PROFILES on the provider server.",
    };
  }
  const value = privateKeyFromEnvironment(agentId);
  const missingKeyReason = providerConfig.profileMode
    ? `Provider submission is not configured for agent ${profile?.agentId ?? agentId ?? "the selected profile"}. Add its privateKey entry to PLOW_PROVIDER_PROFILES on the provider server.`
    : "Provider submission is not configured. Add PLOW_PROVIDER_PRIVATE_KEY on the provider server.";
  if (!value) {
    return {
      configured: false,
      reason: missingKeyReason,
    };
  }
  if (!PRIVATE_KEY_PATTERN.test(value)) {
    return {
      configured: false,
      reason: providerConfig.profileMode
        ? `Provider submission is not configured for agent ${profile?.agentId ?? agentId ?? "the selected profile"}. Its privateKey must be a 32 byte hex key.`
        : "Provider submission is not configured. PLOW_PROVIDER_PRIVATE_KEY must be a 32 byte hex key.",
    };
  }
  const account = readProviderSigner(agentId);
  if (!account) {
    return {
      configured: false,
      reason: providerConfig.profileMode
        ? `Provider submission is not configured for agent ${profile?.agentId ?? agentId ?? "the selected profile"}. Its privateKey could not be loaded.`
        : "Provider submission is not configured. PLOW_PROVIDER_PRIVATE_KEY could not be loaded.",
    };
  }
  return { configured: true, address: account.address, reason: "The provider signer is ready." };
}

function submissionChain(config: ERC8183Config) {
  return config.chainId === 97 ? bscTestnet : bsc;
}

function submissionTransport(config: ERC8183Config) {
  return config.chainId === 56
    ? createBscMainnetTransport(config.rpcUrl, REQUEST_TIMEOUT_MS)
    : http(config.rpcUrl, { timeout: REQUEST_TIMEOUT_MS });
}

function addressMatches(left: string | undefined, right: string | undefined) {
  return Boolean(
    left
    && right
    && isAddress(left)
    && isAddress(right)
    && left.toLowerCase() === right.toLowerCase(),
  );
}

function providerJobId(request: ProviderExecutionRequest) {
  if (!/^(0|[1-9]\d*)$/.test(request.job.onchainJobId)) {
    throw new ProviderSubmissionError("The on chain job ID is invalid.", "mismatch", 409);
  }
  try {
    return BigInt(request.job.onchainJobId);
  } catch {
    throw new ProviderSubmissionError("The on chain job ID is invalid.", "mismatch", 409);
  }
}

function parseDescription(description: string) {
  try {
    const value = JSON.parse(description) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function assertRequestNetwork(request: ProviderExecutionRequest, config: ERC8183Config) {
  if (request.job.onchainChainId !== config.chainId || request.job.onchainNetwork !== config.networkName) {
    throw new ProviderSubmissionError("The provider request is for a different ERC 8183 network.", "mismatch", 409);
  }
}

function assertDescriptionBinding(
  request: ProviderExecutionRequest,
  onchainJob: VerifiedJob,
) {
  const description = parseDescription(onchainJob.description);
  if (
    !description
    || description.marketplaceJobId !== request.job.id
    || description.marketplaceAgentId !== request.job.marketplaceAgentId
    || description.agentId !== request.job.agentId
    || typeof description.client !== "string"
    || !addressMatches(description.client, request.job.clientAddress)
    || description.task !== request.job.taskSummary
    || description.category !== request.job.category
    || description.termsHash !== request.job.termsHash
  ) {
    throw new ProviderSubmissionError("The on chain job description does not match the provider request.", "mismatch", 409);
  }
}

function assertFundedJob(
  request: ProviderExecutionRequest,
  signerAddress: Address,
  onchainJob: VerifiedJob,
  paymentToken: PaymentToken,
  config: ERC8183Config,
  now: number,
) {
  const jobId = providerJobId(request);
  if (onchainJob.id !== jobId) {
    throw new ProviderSubmissionError("The on chain job ID does not match the provider request.", "mismatch", 409);
  }
  if (!addressMatches(onchainJob.provider, signerAddress)) {
    throw new ProviderSubmissionError("The provider signer does not own the funded ERC 8183 job.", "mismatch", 409);
  }
  if (onchainJob.status !== ERC8183_STATUS.funded) {
    throw new ProviderSubmissionError("The ERC 8183 job is not funded and cannot be submitted.", "not-funded", 409);
  }
  if (onchainJob.expiredAt <= BigInt(Math.floor(now / 1000))) {
    throw new ProviderSubmissionError("The ERC 8183 job has expired and cannot be submitted.", "expired", 409);
  }
  const expectedEvaluator = config.routerAddress ?? config.evaluatorAddress;
  if (expectedEvaluator && !addressMatches(onchainJob.evaluator, expectedEvaluator)) {
    throw new ProviderSubmissionError("The ERC 8183 evaluator does not match the configured deployment.", "mismatch", 409);
  }
  if (config.routerAddress && !addressMatches(onchainJob.hook, config.routerAddress)) {
    throw new ProviderSubmissionError("The ERC 8183 hook does not match the configured router.", "mismatch", 409);
  }
  if (!addressMatches(paymentToken.address, config.paymentTokenAddress)) {
    throw new ProviderSubmissionError("The ERC 8183 payment token does not match the configured deployment.", "mismatch", 409);
  }
  let expectedBudget: bigint;
  try {
    expectedBudget = parseERC20Amount(request.job.price, paymentToken.decimals);
  } catch {
    throw new ProviderSubmissionError("The provider job budget is invalid.", "mismatch", 409);
  }
  if (onchainJob.budget !== expectedBudget) {
    throw new ProviderSubmissionError("The on chain job budget does not match the provider request.", "mismatch", 409);
  }
  assertDescriptionBinding(request, onchainJob);
}

export function buildProviderDeliverableHash(
  request: ProviderExecutionRequest,
  resultSummary: string,
  resultUri?: string,
): Hex {
  const canonical = {
    protocol: request.protocol,
    job: {
      id: request.job.id,
      agentId: request.job.agentId,
      agentIdentityId: request.job.agentIdentityId,
      marketplaceAgentId: request.job.marketplaceAgentId,
      clientAddress: request.job.clientAddress,
      taskSummary: request.job.taskSummary,
      category: request.job.category,
      price: request.job.price,
      currency: request.job.currency,
      onchainJobId: request.job.onchainJobId,
      onchainNetwork: request.job.onchainNetwork,
      onchainChainId: request.job.onchainChainId,
      termsHash: request.job.termsHash,
      payment: {
        status: request.job.payment.status,
        amount: request.job.payment.amount,
        currency: request.job.payment.currency,
        transactionHash: request.job.payment.transactionHash,
      },
    },
    result: {
      resultSummary,
      ...(resultUri ? { resultUri } : {}),
    },
  };
  return keccak256(toBytes(JSON.stringify(canonical)));
}

export interface ProviderSubmissionDependencies {
  publicClient?: PublicClient;
  walletClient?: WalletClient;
  readJob?: (publicClient: PublicClient, jobId: bigint) => Promise<VerifiedJob>;
  readToken?: (publicClient: PublicClient, tokenAddress: Address) => Promise<PaymentToken>;
  buildResult?: (request: ProviderExecutionRequest) => Promise<ProviderExecutionResponse>;
  now?: () => number;
}

export async function submitProviderExecution(
  request: ProviderExecutionRequest,
  dependencies: ProviderSubmissionDependencies = {},
): Promise<ProviderExecutionResponse> {
  const signer = readProviderSigner(request.job.agentId);
  if (!signer) {
    throw new ProviderSubmissionError(getProviderSignerStatus(request.job.agentId).reason, "not-configured", 503);
  }

  const config = getERC8183Config();
  if (!config.enabled || !config.contractAddress || !config.paymentTokenAddress) {
    throw new ProviderSubmissionError(config.reason ?? "The ERC 8183 deployment is not configured.", "not-configured", 503);
  }
  assertRequestNetwork(request, config);

  const jobId = providerJobId(request);
  const publicClient = dependencies.publicClient ?? createBscPublicClient(config.rpcUrl);
  let onchainJob: VerifiedJob;
  let paymentToken: PaymentToken;
  try {
    onchainJob = await (dependencies.readJob ?? readERC8183Job)(publicClient, jobId);
    paymentToken = await (dependencies.readToken ?? readPaymentToken)(publicClient, config.paymentTokenAddress);
  } catch {
    throw new ProviderSubmissionError("The funded ERC 8183 job could not be verified on chain.", "unavailable", 503);
  }

  assertFundedJob(request, signer.address, onchainJob, paymentToken, config, dependencies.now?.() ?? Date.now());
  const result = dependencies.buildResult
    ? await dependencies.buildResult(request)
    : buildProviderExecutionResult(request);
  const deliverableHash = buildProviderDeliverableHash(request, result.resultSummary);
  const walletClient = dependencies.walletClient ?? createWalletClient({
    account: signer,
    chain: submissionChain(config),
    transport: submissionTransport(config),
  });

  let submissionTransactionHash: Hex;
  try {
    submissionTransactionHash = await walletClient.writeContract({
      address: config.contractAddress,
      abi: ERC8183_ABI,
      functionName: "submit",
      args: [jobId, deliverableHash, "0x"],
      // Pass the local account object so viem signs the transaction locally.
      // Passing only signer.address makes viem call eth_sendTransaction, which
      // public RPC providers reject because they do not hold this key.
      account: signer,
      chain: submissionChain(config),
    });
  } catch (error) {
    console.error("[provider] deliverable submission transaction failed", {
      error: error instanceof Error ? error.message.slice(0, 500) : "Unknown provider submission error.",
      contractAddress: config.contractAddress,
      jobId: request.job.onchainJobId,
    });
    throw new ProviderSubmissionError("The provider could not submit the deliverable transaction.", "unavailable", 503);
  }

  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash: submissionTransactionHash });
  } catch {
    throw new ProviderSubmissionError("The provider submission transaction could not be confirmed.", "unavailable", 503);
  }
  if (receipt.status !== "success") {
    throw new ProviderSubmissionError("The provider submission transaction reverted.", "reverted", 502);
  }

  let submittedJob: VerifiedJob;
  try {
    submittedJob = await (dependencies.readJob ?? readERC8183Job)(publicClient, jobId);
  } catch {
    throw new ProviderSubmissionError("The provider submission could not be verified after confirmation.", "unavailable", 503);
  }
  if (submittedJob.status !== ERC8183_STATUS.submitted || submittedJob.deliverable.toLowerCase() !== deliverableHash.toLowerCase()) {
    throw new ProviderSubmissionError("The provider submission did not produce the expected deliverable.", "mismatch", 409);
  }

  return {
    ...result,
    deliverableHash,
    submissionTransactionHash,
  };
}
