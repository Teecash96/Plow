import { createPublicClient, createWalletClient, http, isAddress, verifyMessage, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";
import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactEvmScheme as registerExactEvmFacilitatorScheme } from "@x402/evm/exact/facilitator";
import { PERMIT2_ADDRESS } from "@x402/evm";
import { getERC8183Config } from "@/lib/chain/erc8183-adapter";
import { assertPermissionAllows, PermissionPolicyError } from "@/lib/marketplace/permission-policy";
import type { SessionPermission } from "@/lib/marketplace/types";
import { x402PaymentBindingMessage } from "@/lib/payments/x402-binding";

export interface X402ResourceChallengeInput {
  jobId: string;
  agentId: string;
  amount: string;
  asset: Address;
  recipient: Address;
  origin: string;
}

export interface X402ResourceStatus {
  enabled: boolean;
  reason?: string;
  recipient?: Address;
  amount?: string;
}

const DEFAULT_RESOURCE_AMOUNT = "100000000000000000";
const X402_SETTLEMENT_GAS_LIMIT = BigInt(150_000);

export function getX402SettlementTransactionOverrides(requestedGas?: bigint, gasPrice?: bigint): {
  gas: bigint;
  value: bigint;
  gasPrice?: bigint;
} {
  const overrides = {
    gas: requestedGas ?? X402_SETTLEMENT_GAS_LIMIT,
    value: BigInt(0),
  } as const;
  return gasPrice === undefined ? overrides : { ...overrides, gasPrice };
}

function readServerEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Server-side x402 resource configuration. The facilitator signer is a
 * server-held key that only ever pushes Permit2 settlement transactions that
 * were signed by the buyer — it cannot move funds on its own. Prefers the
 * internal /api/x402/resource URL; an external URL is still accepted.
 */
export function getX402ResourceStatus(): X402ResourceStatus {
  const erc = getERC8183Config();
  if (!erc.enabled) return { enabled: false, reason: erc.reason };
  const recipient = readServerEnv("X402_PAYEE_ADDRESS") ?? readServerEnv("NEXT_PUBLIC_X402_PAYEE_ADDRESS");
  if (recipient && !isAddress(recipient)) return { enabled: false, reason: "The optional X402_PAYEE_ADDRESS is not a valid wallet address." };
  const signerKey = readServerEnv("X402_FACILITATOR_KEY");
  if (!signerKey?.startsWith("0x")) {
    return {
      enabled: false,
      reason: "Set X402_FACILITATOR_KEY (server-only) so settlement can push transactions.",
    };
  }
  return {
    enabled: true,
    recipient: recipient as Address | undefined,
    amount: readServerEnv("X402_RESOURCE_AMOUNT") ?? DEFAULT_RESOURCE_AMOUNT,
  };
}

function resourceChain() {
  return getERC8183Config().chainId === 97 ? bscTestnet : bsc;
}

export function buildPaymentRequirements(input: X402ResourceChallengeInput) {
  const erc = getERC8183Config();
  // The $U token implements EIP-2612 but not EIP-3009, so challenges declare
  // the permit2 transfer method with the token's EIP-712 domain.
  return [
    {
      scheme: "exact" as const,
      network: erc.network,
      amount: input.amount,
      asset: input.asset,
      payTo: input.recipient,
      maxTimeoutSeconds: 900,
      extra: {
        name: "United Stables",
        version: "1",
        assetTransferMethod: "permit2",
      },
    },
  ];
}

interface DecodedPaymentRequirements {
  amount?: string;
  asset?: string;
  payTo?: string;
  scheme?: string;
  network?: string;
  maxTimeoutSeconds?: number;
  extra?: { assetTransferMethod?: string };
}

interface DecodedPayment {
  requirements?: DecodedPaymentRequirements;
  resourceUrl?: string;
  raw?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resourceUrlFromValue(value: unknown) {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.url === "string") return value.url;
  return undefined;
}

function decodePaymentHeader(header: string | null): DecodedPayment | undefined {
  if (!header) return undefined;
  try {
    const raw = Buffer.from(header.trim(), "base64").toString("utf8");
    const decoded = JSON.parse(raw) as unknown;
    if (!isRecord(decoded)) return undefined;
    const payload = isRecord(decoded.payload) ? decoded.payload : undefined;
    const accepted = isRecord(decoded.accepted)
      ? decoded.accepted
      : payload && isRecord(payload.accepted)
        ? payload.accepted
        : decoded;
    return {
      requirements: accepted as DecodedPaymentRequirements,
      resourceUrl: resourceUrlFromValue(decoded.resource)
        ?? resourceUrlFromValue(payload?.resource)
        ?? resourceUrlFromValue(accepted.resource),
      raw: decoded,
    };
  } catch {
    return undefined;
  }
}

function sortedSearchParams(url: URL) {
  return [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
}

export function x402ResourceMatchesJob(input: {
  actualResourceUrl?: string;
  expectedResourceUrl: string;
  jobId: string;
  agentId: string;
}) {
  if (!input.actualResourceUrl || !input.expectedResourceUrl || !input.jobId || !input.agentId) return false;

  let actual: URL;
  let expected: URL;
  try {
    actual = new URL(input.actualResourceUrl);
    expected = new URL(input.expectedResourceUrl);
  } catch {
    return false;
  }

  if (
    actual.origin !== expected.origin
    || actual.pathname !== expected.pathname
    || actual.username
    || actual.password
    || expected.username
    || expected.password
    || actual.hash !== expected.hash
  ) {
    return false;
  }

  if (JSON.stringify(sortedSearchParams(actual)) !== JSON.stringify(sortedSearchParams(expected))) return false;
  return actual.searchParams.get("jobId") === input.jobId
    && actual.searchParams.get("agentId") === input.agentId;
}

let cachedFacilitator: { facilitator: x402Facilitator; chainId: number } | undefined;

function getFacilitator() {
  const erc = getERC8183Config();
  if (cachedFacilitator && cachedFacilitator.chainId === erc.chainId) return cachedFacilitator;
  const key = readServerEnv("X402_FACILITATOR_KEY");
  if (!key?.startsWith("0x")) throw new Error("The facilitator signing key is not configured.");
  const account = privateKeyToAccount(key as Hex);
  const chain = resourceChain();
  const publicClient = createPublicClient({ chain, transport: http(erc.rpcUrl, { timeout: 20_000 }) });
  const walletClient = createWalletClient({ account, chain, transport: http(erc.rpcUrl, { timeout: 20_000 }) });
  const signer = {
    address: account.address,
    getAddresses: () => [account.address] as const,
    signTypedData: async (message: Parameters<typeof account.signTypedData>[0]) =>
      account.signTypedData({
        domain: message.domain,
        types: message.types,
        primaryType: message.primaryType,
        message: message.message,
      }),
    readContract: publicClient.readContract.bind(publicClient),
    getCode: async ({ address }: { address: string }) =>
      publicClient.getCode({ address: address as Address }),
    getBalance: async ({ address }: { address: string }) =>
      publicClient.getBalance({ address: address as Address }),
    getTransactionCount: async ({ address }: { address: string }) =>
      Number(await publicClient.getTransactionCount({ address: address as Address })),
    estimateFeesPerGas: () => publicClient.estimateFeesPerGas(),
    sendTransaction: async ({ to, data }: { to: string; data: string }) => {
      return walletClient.sendTransaction({
        to: to as Address,
        data: data as Hex,
        account,
        chain,
      });
    },
    writeContract: async ({
      address,
      abi,
      functionName,
      args,
      gas,
      dataSuffix,
    }: {
      address: Address;
      abi: readonly unknown[];
      functionName: string;
      args: readonly unknown[];
      gas?: bigint;
      dataSuffix?: Hex;
    }) => {
      // BSC is a legacy-fee network in practice. Supplying gasPrice prevents
      // viem from reserving an inflated EIP-1559 max fee on the facilitator.
      const gasPrice = await publicClient.getGasPrice();
      const transactionOverrides = getX402SettlementTransactionOverrides(gas, gasPrice);
      const facilitatorBalance = await publicClient.getBalance({ address: account.address });
      const estimatedNativeCost = transactionOverrides.gas * gasPrice + transactionOverrides.value;
      console.info("[x402] facilitator settlement preflight", {
        facilitatorAddress: account.address,
        balanceWei: facilitatorBalance.toString(),
        gasPriceWei: gasPrice.toString(),
        gasLimit: transactionOverrides.gas.toString(),
        estimatedNativeCostWei: estimatedNativeCost.toString(),
      });
      if (facilitatorBalance < estimatedNativeCost) {
        throw new Error("The x402 facilitator wallet does not have enough BNB for settlement gas.");
      }
      return walletClient.writeContract({
        address,
        abi,
        functionName,
        args,
        account,
        chain,
        type: "legacy",
        gas: transactionOverrides.gas,
        value: transactionOverrides.value,
        gasPrice: transactionOverrides.gasPrice,
        dataSuffix,
      } as never);
    },
    waitForTransactionReceipt: ({ hash }: { hash: Hex }) =>
      publicClient.waitForTransactionReceipt({ hash }),
  };
  const facilitator = new x402Facilitator();
  registerExactEvmFacilitatorScheme(facilitator as never, {
    networks: [erc.network] as never,
    signer: signer as never,
  });
  cachedFacilitator = { facilitator, chainId: erc.chainId };
  return cachedFacilitator;
}

export interface SettleWithHeaderResult {
  status: "paid" | "rejected";
  transactionHash?: string;
  payer?: string;
  errorReason?: string;
}

/**
 * Verify the buyer's X-PAYMENT header against the expected job terms and
 * settle it on-chain via the exact permit2 proxy. Returns the receipt fields
 * embedded in the PAYMENT-RESPONSE header.
 */
export async function settleFromPaymentHeader(input: {
  paymentHeader: string | null;
  expectedAmount: string;
  expectedAsset: Address;
  expectedRecipient: Address;
  expectedPayer: Address;
  bindingSignature: string | null;
  jobId: string;
  agentId: string;
  resourceUrl: string;
  permission: SessionPermission;
  tokenDecimals: number;
  currency: string;
  spentAmountAtomic: bigint;
}): Promise<SettleWithHeaderResult> {
  let expectedAmountAtomic: bigint;
  try {
    expectedAmountAtomic = BigInt(input.expectedAmount);
  } catch {
    return { status: "rejected", errorReason: "The expected payment amount is invalid." };
  }
  try {
    assertPermissionAllows({
      permission: input.permission,
      action: "x402-payment",
      contractAddress: PERMIT2_ADDRESS,
      tokenAddress: input.expectedAsset,
      amountAtomic: expectedAmountAtomic,
      tokenDecimals: input.tokenDecimals,
      currency: input.currency,
      spentAmountAtomic: input.spentAmountAtomic,
    });
  } catch (error) {
    if (error instanceof PermissionPolicyError) return { status: "rejected", errorReason: error.message };
    return { status: "rejected", errorReason: "The payment permission could not be verified." };
  }
  const decoded = decodePaymentHeader(input.paymentHeader);
  const requirements = decoded?.requirements;
  const erc = getERC8183Config();
  if (
    typeof requirements?.amount !== "string"
    || typeof requirements.asset !== "string"
    || typeof requirements.payTo !== "string"
    || !isAddress(requirements.asset)
    || !isAddress(requirements.payTo)
  ) {
    return { status: "rejected", errorReason: "The payment header was missing or malformed." };
  }
  if (requirements.scheme !== "exact" || requirements.network !== erc.network || requirements.extra?.assetTransferMethod !== "permit2") {
    return { status: "rejected", errorReason: "The payment method does not match the configured x402 scheme." };
  }
  if (requirements.amount !== input.expectedAmount) {
    return { status: "rejected", errorReason: "The payment amount does not match the challenge." };
  }
  if (requirements.asset.toLowerCase() !== input.expectedAsset.toLowerCase()) {
    return { status: "rejected", errorReason: "The payment asset does not match the challenge." };
  }
  if (requirements.payTo.toLowerCase() !== input.expectedRecipient.toLowerCase()) {
    return { status: "rejected", errorReason: "The payment recipient does not match the challenge." };
  }

  if (
    decoded?.raw?.x402Version !== 2
    || !isRecord(decoded.raw.resource)
    || typeof decoded.raw.resource.url !== "string"
    || !isRecord(decoded.raw.payload)
    || !x402ResourceMatchesJob({
      actualResourceUrl: decoded.resourceUrl,
      expectedResourceUrl: input.resourceUrl,
      jobId: input.jobId,
      agentId: input.agentId,
    })
  ) {
    return { status: "rejected", errorReason: "The payment resource metadata does not match this job and agent." };
  }

  if (!input.bindingSignature || !/^0x[a-fA-F0-9]+$/.test(input.bindingSignature)) {
    return { status: "rejected", errorReason: "The payment is missing its job binding signature." };
  }

  let bindingValid = false;
  try {
    bindingValid = await verifyMessage({
      address: input.expectedPayer,
      message: x402PaymentBindingMessage({
        jobId: input.jobId,
        agentId: input.agentId,
        resourceUrl: input.resourceUrl,
        amount: input.expectedAmount,
        asset: input.expectedAsset,
        recipient: input.expectedRecipient,
        network: erc.network,
      }),
      signature: input.bindingSignature as Hex,
    });
  } catch {
    bindingValid = false;
  }
  if (!bindingValid) {
    return { status: "rejected", errorReason: "The payment binding signature does not match the job client, job, or agent." };
  }

  try {
    const { facilitator } = getFacilitator();
    const serverRequirements = {
      scheme: "exact" as const,
      network: erc.network,
      amount: input.expectedAmount,
      asset: input.expectedAsset,
      payTo: input.expectedRecipient,
      maxTimeoutSeconds: 900,
      extra: { assetTransferMethod: "permit2" },
    };
    const paymentPayload = {
      x402Version: 2,
      resource: { url: input.resourceUrl, description: "BNB Agent Studio hire", mimeType: "application/json" },
      payload: decoded.raw?.payload,
      accepted: serverRequirements,
    } as never;
    const verifyResponse = await facilitator.verify(paymentPayload, serverRequirements as never);
    if (!verifyResponse.isValid) {
      return { status: "rejected", errorReason: verifyResponse.invalidReason ?? "Verification failed." };
    }
    if (!verifyResponse.payer || verifyResponse.payer.toLowerCase() !== input.expectedPayer.toLowerCase()) {
      return { status: "rejected", errorReason: "The payment payer does not match the job client." };
    }
    const settleResponse = await facilitator.settle(paymentPayload, serverRequirements as never);
    if (!settleResponse.success || !settleResponse.transaction) {
      return { status: "rejected", errorReason: settleResponse.errorReason ?? "Settlement failed.", payer: verifyResponse.payer };
    }
    return { status: "paid", transactionHash: settleResponse.transaction, payer: verifyResponse.payer };
  } catch (error) {
    return {
      status: "rejected",
      errorReason: error instanceof Error ? error.message : "Settlement threw an unexpected error.",
    };
  }
}
