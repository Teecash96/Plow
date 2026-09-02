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
import { verifiedTransactionCallData } from "@/lib/chain/transaction-target";
import { decodeFunctionData, isAddress, type Hex } from "viem";
import type { Agent, Job } from "./types";

export type JobExecutionVerificationCode = "not-configured" | "unavailable" | "not-funded" | "mismatch";

export class JobExecutionVerificationError extends Error {
  readonly code: JobExecutionVerificationCode;

  constructor(message: string, code: JobExecutionVerificationCode) {
    super(message);
    this.name = "JobExecutionVerificationError";
    this.code = code;
  }
}

export type VerifiedERC8183Job = Awaited<ReturnType<typeof readERC8183Job>>;
export type VerifiedPaymentToken = Awaited<ReturnType<typeof readPaymentToken>>;

function reject(message: string, code: JobExecutionVerificationCode): never {
  throw new JobExecutionVerificationError(message, code);
}

function addressMatches(left: unknown, right: unknown) {
  return typeof left === "string"
    && typeof right === "string"
    && isAddress(left)
    && isAddress(right)
    && left.toLowerCase() === right.toLowerCase();
}

function parseJobId(value: unknown) {
  if (typeof value !== "string") reject("The on chain job ID is invalid.", "mismatch");
  if (!/^(0|[1-9]\d*)$/.test(value)) reject("The on chain job ID is invalid.", "mismatch");
  try {
    return BigInt(value);
  } catch {
    reject("The on chain job ID is invalid.", "mismatch");
  }
}

function parseDescription(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function assertStoredJobDeploymentBinding(job: Job, config: ERC8183Config) {
  if (
    typeof job.id !== "string"
    || job.onchainNetwork !== config.networkName
    || job.onchainChainId !== config.chainId
    || typeof job.jobContractAddress !== "string"
    || job.jobContractAddress.toLowerCase() !== config.contractAddress?.toLowerCase()
    || typeof job.onchainJobId !== "string"
  ) {
    reject("The stored job does not match the configured ERC 8183 deployment.", "mismatch");
  }
}

function assertERC8183CommonProof(
  job: Job,
  agent: Agent,
  onchainJob: VerifiedERC8183Job,
  paymentToken: VerifiedPaymentToken,
  config: ERC8183Config,
) {
  if (!config.enabled || !config.contractAddress || !config.paymentTokenAddress) {
    reject("On chain job verification is not configured.", "not-configured");
  }
  assertStoredJobDeploymentBinding(job, config);

  const jobId = parseJobId(job.onchainJobId);
  if (onchainJob.id !== jobId) reject("The ERC 8183 job ID does not match the stored job.", "mismatch");
  if (!isAddress(job.clientAddress)) reject("The stored client address is not a wallet address.", "mismatch");
  const ownerAddress = agent.identity.ownerAddress;
  if (typeof agent.id !== "string" || typeof agent.identity.agentId !== "string" || typeof ownerAddress !== "string" || !isAddress(ownerAddress)) {
    reject("The agent provider address is not verified.", "mismatch");
  }
  if (job.agentIdentityId !== agent.identity.agentId) {
    reject("The stored job is not bound to the selected agent identity.", "mismatch");
  }
  if (typeof config.paymentTokenAddress !== "string" || !addressMatches(paymentToken.address, config.paymentTokenAddress)) {
    reject("The ERC 8183 payment token does not match the configured deployment.", "mismatch");
  }
  if (!addressMatches(onchainJob.client, job.clientAddress)) reject("The on chain client does not match the stored job.", "mismatch");
  if (!addressMatches(onchainJob.provider, ownerAddress)) reject("The on chain provider does not match the selected agent.", "mismatch");
  const expectedEvaluator = config.routerAddress ?? config.evaluatorAddress;
  if (expectedEvaluator && !addressMatches(onchainJob.evaluator, expectedEvaluator)) reject("The on chain evaluator does not match the configured evaluator.", "mismatch");
  if (config.routerAddress && !addressMatches(onchainJob.hook, config.routerAddress)) reject("The on chain hook does not match the evaluator router.", "mismatch");

  let expectedBudget: bigint;
  try {
    expectedBudget = parseERC20Amount(job.price, paymentToken.decimals);
  } catch {
    reject("The stored job budget is invalid.", "mismatch");
  }
  if (onchainJob.status === ERC8183_STATUS.open) {
    if (onchainJob.budget !== BigInt(0) && onchainJob.budget !== expectedBudget) reject("The on chain budget does not match the stored job.", "mismatch");
  } else if (onchainJob.budget !== expectedBudget) {
    reject("The on chain budget does not match the stored job.", "mismatch");
  }

  const description = parseDescription(onchainJob.description);
  const expectedTermsHash = job.termsHash ?? job.terms.termsHash;
  if (
    !description
    || description.marketplaceJobId !== job.id
    || description.marketplaceAgentId !== job.agentId
    || description.agentId !== agent.identity.agentId
    || typeof description.client !== "string"
    || !addressMatches(description.client, job.clientAddress)
    || description.task !== job.taskSummary
    || description.category !== job.category
    || typeof expectedTermsHash !== "string"
    || description.termsHash !== expectedTermsHash
  ) {
    reject("The on chain job description does not match the stored job.", "mismatch");
  }

  return { jobId };
}

export function assertERC8183ExecutionProof(
  job: Job,
  agent: Agent,
  onchainJob: VerifiedERC8183Job,
  paymentToken: VerifiedPaymentToken,
  config: ERC8183Config,
  now = Date.now(),
) {
  const result = assertERC8183CommonProof(job, agent, onchainJob, paymentToken, config);
  if (onchainJob.status !== ERC8183_STATUS.funded) reject("The ERC 8183 job is not funded.", "not-funded");
  if (onchainJob.expiredAt <= BigInt(Math.floor(now / 1000))) reject("The ERC 8183 job has expired.", "not-funded");
  return result;
}

export function assertERC8183SubmissionProof(
  job: Job,
  agent: Agent,
  onchainJob: VerifiedERC8183Job,
  paymentToken: VerifiedPaymentToken,
  config: ERC8183Config,
  deliverableHash: string,
  now = Date.now(),
) {
  const result = assertERC8183CommonProof(job, agent, onchainJob, paymentToken, config);
  if (onchainJob.status !== ERC8183_STATUS.submitted) reject("The ERC 8183 job is not submitted.", "not-funded");
  if (onchainJob.expiredAt <= BigInt(Math.floor(now / 1000))) reject("The ERC 8183 job has expired.", "not-funded");
  if (!/^0x[a-fA-F0-9]{64}$/.test(deliverableHash)) reject("The deliverable hash is invalid.", "mismatch");
  if (typeof onchainJob.deliverable !== "string" || onchainJob.deliverable.toLowerCase() !== deliverableHash.toLowerCase()) {
    reject("The on chain deliverable does not match the agent result.", "mismatch");
  }
  return result;
}

export async function verifyStoredJobForExecution(job: Job, agent: Agent) {
  const config = getERC8183Config();
  if (!config.enabled || !config.contractAddress || !config.paymentTokenAddress) {
    reject("On chain job verification is not configured.", "not-configured");
  }
  assertStoredJobDeploymentBinding(job, config);
  const jobId = parseJobId(job.onchainJobId);
  const publicClient = createBscPublicClient(config.rpcUrl);
  let onchainJob: Awaited<ReturnType<typeof readERC8183Job>>;
  try {
    onchainJob = await readERC8183Job(publicClient, jobId);
  } catch {
    reject("The ERC 8183 job could not be verified on chain.", "unavailable");
  }

  let paymentToken: Awaited<ReturnType<typeof readPaymentToken>>;
  try {
    paymentToken = await readPaymentToken(publicClient, config.paymentTokenAddress);
  } catch {
    reject("The ERC 8183 payment token could not be verified.", "unavailable");
  }

  assertERC8183ExecutionProof(job, agent, onchainJob, paymentToken, config);

  return { onchainJob, paymentToken };
}

export async function verifyStoredJobForLifecycle(job: Job, agent: Agent) {
  const config = getERC8183Config();
  if (!config.enabled || !config.contractAddress || !config.paymentTokenAddress) {
    reject("On chain job verification is not configured.", "not-configured");
  }
  assertStoredJobDeploymentBinding(job, config);
  const jobId = parseJobId(job.onchainJobId);
  const publicClient = createBscPublicClient(config.rpcUrl);
  let onchainJob: Awaited<ReturnType<typeof readERC8183Job>>;
  try {
    onchainJob = await readERC8183Job(publicClient, jobId);
  } catch {
    reject("The ERC 8183 job could not be verified on chain.", "unavailable");
  }

  let paymentToken: Awaited<ReturnType<typeof readPaymentToken>>;
  try {
    paymentToken = await readPaymentToken(publicClient, config.paymentTokenAddress);
  } catch {
    reject("The ERC 8183 payment token could not be verified.", "unavailable");
  }

  assertERC8183CommonProof(job, agent, onchainJob, paymentToken, config);
  return { onchainJob, paymentToken };
}

export async function verifyStoredJobSubmission(
  job: Job,
  agent: Agent,
  deliverableHash: string,
  submissionTransactionHash: string,
) {
  const config = getERC8183Config();
  if (!config.enabled || !config.contractAddress || !config.paymentTokenAddress) {
    reject("On chain job verification is not configured.", "not-configured");
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(submissionTransactionHash)) reject("The submission transaction hash is invalid.", "mismatch");
  assertStoredJobDeploymentBinding(job, config);
  const jobId = parseJobId(job.onchainJobId);
  const publicClient = createBscPublicClient(config.rpcUrl);
  let receipt;
  let transaction;
  try {
    [receipt, transaction] = await Promise.all([
      publicClient.getTransactionReceipt({ hash: submissionTransactionHash as Hex }),
      publicClient.getTransaction({ hash: submissionTransactionHash as Hex }),
    ]);
  } catch {
    reject("The provider submission transaction could not be verified.", "unavailable");
  }
  if (receipt.status !== "success") reject("The provider submission transaction reverted.", "mismatch");
  const callData = verifiedTransactionCallData({
    transaction: { to: transaction.to, input: transaction.input, value: transaction.value },
    receiptTo: receipt.to,
    expectedTarget: config.contractAddress,
  });
  if (!callData) reject("The provider submission targeted the wrong contract.", "mismatch");
  if (!agent.identity.ownerAddress || !addressMatches(receipt.from, agent.identity.ownerAddress)) reject("The provider submission signer does not match the selected agent.", "mismatch");
  try {
    const decoded = decodeFunctionData({ abi: ERC8183_ABI, data: callData });
    const [submittedJobId, submittedDeliverable] = decoded.args ?? [];
    if (
      decoded.functionName !== "submit"
      || typeof submittedJobId !== "bigint"
      || submittedJobId !== jobId
      || typeof submittedDeliverable !== "string"
      || submittedDeliverable.toLowerCase() !== deliverableHash.toLowerCase()
    ) {
      reject("The provider submission does not target the stored ERC 8183 job and deliverable.", "mismatch");
    }
  } catch (error) {
    if (error instanceof JobExecutionVerificationError) throw error;
    reject("The provider submission call could not be decoded.", "mismatch");
  }

  let onchainJob: Awaited<ReturnType<typeof readERC8183Job>>;
  try {
    onchainJob = await readERC8183Job(publicClient, jobId);
  } catch {
    reject("The submitted ERC 8183 job could not be verified on chain.", "unavailable");
  }
  let paymentToken: Awaited<ReturnType<typeof readPaymentToken>>;
  try {
    paymentToken = await readPaymentToken(publicClient, config.paymentTokenAddress);
  } catch {
    reject("The ERC 8183 payment token could not be verified.", "unavailable");
  }
  assertERC8183SubmissionProof(job, agent, onchainJob, paymentToken, config, deliverableHash);
  return { onchainJob, paymentToken, submissionTransactionHash: submissionTransactionHash as Hex };
}
