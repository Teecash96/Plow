import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";
import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactEvmScheme as registerExactEvmFacilitatorScheme } from "@x402/evm/exact/facilitator";
import { getERC8183Config } from "@/lib/chain/erc8183-adapter";

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
  if (!recipient || !recipient.startsWith("0x")) {
    return { enabled: false, reason: "Set X402_PAYEE_ADDRESS to the agent wallet that receives $U." };
  }
  const signerKey = readServerEnv("X402_FACILITATOR_KEY");
  if (!signerKey?.startsWith("0x")) {
    return {
      enabled: false,
      reason: "Set X402_FACILITATOR_KEY (server-only) so settlement can push transactions.",
    };
  }
  return {
    enabled: true,
    recipient: recipient as Address,
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

interface DecodedPayment {
  requirements?: { amount?: string; asset?: string; payTo?: string; scheme?: string; network?: string };
}

function decodePaymentHeader(header: string | null): DecodedPayment | undefined {
  if (!header) return undefined;
  try {
    const raw = Buffer.from(header.trim(), "base64").toString("utf8");
    const decoded = JSON.parse(raw) as Record<string, unknown>;
    const accepted = (decoded as { accepted?: unknown }).accepted;
    if (accepted && typeof accepted === "object") return { requirements: accepted as DecodedPayment["requirements"] };
    const inner = (decoded as { payload?: { accepted?: unknown } }).payload?.accepted;
    if (inner && typeof inner === "object") return { requirements: inner as DecodedPayment["requirements"] };
    return decoded as DecodedPayment;
  } catch {
    return undefined;
  }
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
      const hash = await walletClient.sendTransaction({
        to: to as Address,
        data: data as Hex,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      return hash;
    },
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
  jobId?: string;
  agentId?: string;
  resourceUrl?: string;
}): Promise<SettleWithHeaderResult> {
  const decoded = decodePaymentHeader(input.paymentHeader);
  const requirements = decoded?.requirements;
  if (!requirements?.amount || !requirements.asset || !requirements.payTo) {
    return { status: "rejected", errorReason: "The payment header was missing or malformed." };
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
  let rawPayload: Record<string, unknown>;
  try {
    const raw = Buffer.from((input.paymentHeader ?? "").trim(), "base64").toString("utf8");
    rawPayload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { status: "rejected", errorReason: "The payment payload could not be decoded." };
  }
  try {
    const { facilitator } = getFacilitator();
    const erc = getERC8183Config();
    const paymentPayload = {
      x402Version: 2,
      resource: { url: "", description: "BNB Agent Studio hire", mimeType: "application/json" },
      payload: rawPayload.payload ?? rawPayload,
      accepted: requirements,
    } as never;
    const verifyResponse = await facilitator.verify(paymentPayload, requirements as never);
    if (!verifyResponse.isValid) {
      return { status: "rejected", errorReason: verifyResponse.invalidReason ?? "Verification failed." };
    }
    const settleResponse = await facilitator.settle(paymentPayload, requirements as never);
    if (!settleResponse.success || !settleResponse.transaction) {
      return { status: "rejected", errorReason: settleResponse.errorReason ?? "Settlement failed.", payer: verifyResponse.payer };
    }
    void erc;
    return { status: "paid", transactionHash: settleResponse.transaction, payer: verifyResponse.payer };
  } catch (error) {
    return {
      status: "rejected",
      errorReason: error instanceof Error ? error.message : "Settlement threw an unexpected error.",
    };
  }
}
