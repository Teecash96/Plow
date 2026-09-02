import { expect, test } from "@playwright/test";
import type { PaymentRequired } from "@x402/core/types";
import { PERMIT2_ADDRESS } from "@x402/evm";
import { verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  assertPermissionAllows,
  permissionExpiryForDuration,
  PermissionPolicyError,
} from "@/lib/marketplace/permission-policy";
import type { SessionPermission } from "@/lib/marketplace/types";
import { verifyX402Challenge } from "@/lib/payments/x402-adapter";
import { x402PaymentBindingMessage } from "@/lib/payments/x402-binding";
import { settleFromPaymentHeader, x402ResourceMatchesJob } from "@/lib/payments/x402-resource";

const CONTRACT = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;
const RECIPIENT = "0x3333333333333333333333333333333333333333" as const;
const WRONG_RECIPIENT = "0x4444444444444444444444444444444444444444" as const;

function permission(overrides: Partial<SessionPermission> = {}): SessionPermission {
  return {
    provider: "Altana",
    spendCap: "2",
    currency: "USDC",
    allowlistedContracts: [CONTRACT, PERMIT2_ADDRESS],
    allowlistedTokens: [TOKEN],
    expiresAt: "24 hours",
    expiresAtTimestamp: "2099-01-01T00:00:00.000Z",
    status: "active",
    templateId: "policy-test",
    revokeSupported: false,
    lastUpdatedAt: "2026-08-31T00:00:00.000Z",
    source: "job",
    ...overrides,
  };
}

const paymentCheck = {
  permission: permission(),
  action: "x402-payment" as const,
  contractAddress: PERMIT2_ADDRESS,
  tokenAddress: TOKEN,
  amountAtomic: BigInt(100),
  tokenDecimals: 2,
  currency: "USDC",
  spentAmountAtomic: BigInt(0),
};

test("supports the live evaluator-safe expiry duration", () => {
  const now = Date.parse("2026-09-01T00:00:00.000Z");
  expect(permissionExpiryForDuration("14 days", now)).toBe("2026-09-15T00:00:00.000Z");
});

test("allows a permitted payment and escrow operation within the cumulative cap", () => {
  expect(() => assertPermissionAllows(paymentCheck)).not.toThrow();
  expect(() => assertPermissionAllows({
    ...paymentCheck,
    action: "erc8183-fund",
    contractAddress: CONTRACT,
    spentAmountAtomic: BigInt(100),
  })).not.toThrow();
});

test("rejects cumulative spend above the cap", () => {
  expect(() => assertPermissionAllows({
    ...paymentCheck,
    spentAmountAtomic: BigInt(101),
  })).toThrow(PermissionPolicyError);
  expect(() => assertPermissionAllows({
    ...paymentCheck,
    spentAmountAtomic: BigInt(101),
  })).toThrow("spend cap");
});

test("rejects missing, revoked, expired, malformed, and unallowlisted permission state", () => {
  expect(() => assertPermissionAllows({ ...paymentCheck, permission: undefined })).toThrow("permission");
  expect(() => assertPermissionAllows({ ...paymentCheck, permission: permission({ status: "revoked" }) })).toThrow("revoked");
  expect(() => assertPermissionAllows({ ...paymentCheck, permission: permission({ expiresAtTimestamp: "2020-01-01T00:00:00.000Z" }) })).toThrow("expired");
  expect(() => assertPermissionAllows({ ...paymentCheck, contractAddress: RECIPIENT })).toThrow("allowlist");
  expect(() => assertPermissionAllows({ ...paymentCheck, tokenAddress: RECIPIENT })).toThrow("allowlist");
  expect(() => assertPermissionAllows({ ...paymentCheck, permission: permission({ allowlistedTokens: ["not-an-address"] }) })).toThrow("address");
});

test("rejects an x402 challenge that pays a recipient outside the expected target", () => {
  const resource = "https://resource.example/pay?jobId=job-1&agentId=42";
  const paymentRequired = {
    x402Version: 2,
    accepts: [{
      scheme: "exact",
      network: "eip155:56",
      amount: "100",
      asset: TOKEN,
      payTo: WRONG_RECIPIENT,
      resource,
    }],
    resource: { url: resource, description: "test", mimeType: "application/json" },
  } as unknown as PaymentRequired;

  const result = verifyX402Challenge(paymentRequired, {
    jobId: "job-1",
    agentId: "42",
    amount: "100",
    network: "eip155:56",
    asset: TOKEN,
    recipient: RECIPIENT,
    resource: "https://resource.example/pay",
  });

  expect(result.valid).toBe(false);
});

test("binds the signed x402 resource to the requested job and agent", () => {
  const expected = "https://resource.example/pay?jobId=job-1&agentId=42";

  expect(x402ResourceMatchesJob({
    actualResourceUrl: expected,
    expectedResourceUrl: expected,
    jobId: "job-1",
    agentId: "42",
  })).toBe(true);

  expect(x402ResourceMatchesJob({
    actualResourceUrl: "https://resource.example/pay?jobId=job-2&agentId=42",
    expectedResourceUrl: expected,
    jobId: "job-1",
    agentId: "42",
  })).toBe(false);

  expect(x402ResourceMatchesJob({
    actualResourceUrl: "https://resource.example/pay?jobId=job-1&agentId=99",
    expectedResourceUrl: expected,
    jobId: "job-1",
    agentId: "42",
  })).toBe(false);
});

test("does not reuse a payer binding signature for another job", async () => {
  const payer = privateKeyToAccount("0x0123456789012345678901234567890123456789012345678901234567890123");
  const binding = {
    jobId: "job-1",
    agentId: "42",
    resourceUrl: "https://resource.example/pay?jobId=job-1&agentId=42",
    amount: "100",
    asset: TOKEN,
    recipient: RECIPIENT,
    network: "eip155:56",
  };
  const message = x402PaymentBindingMessage(binding);
  const signature = await payer.signMessage({ message });

  expect(await verifyMessage({ address: payer.address, message, signature })).toBe(true);
  expect(await verifyMessage({
    address: payer.address,
    message: x402PaymentBindingMessage({ ...binding, jobId: "job-2" }),
    signature,
  })).toBe(false);
});

test("rejects a valid x402 payment with a binding signature for another job", async () => {
  const payer = privateKeyToAccount("0x0123456789012345678901234567890123456789012345678901234567890123");
  const resourceUrl = "https://resource.example/pay?jobId=job-1&agentId=42";
  const paymentHeader = Buffer.from(JSON.stringify({
    x402Version: 2,
    resource: { url: resourceUrl, description: "test", mimeType: "application/json" },
    accepted: {
      scheme: "exact",
      network: "eip155:56",
      amount: "100",
      asset: TOKEN,
      payTo: RECIPIENT,
      maxTimeoutSeconds: 900,
      extra: { assetTransferMethod: "permit2" },
    },
    payload: { permit2Authorization: {}, signature: "0x" },
  })).toString("base64");
  const wrongBindingSignature = await payer.signMessage({
    message: x402PaymentBindingMessage({
      jobId: "job-2",
      agentId: "42",
      resourceUrl,
      amount: "100",
      asset: TOKEN,
      recipient: RECIPIENT,
      network: "eip155:56",
    }),
  });

  const result = await settleFromPaymentHeader({
    paymentHeader,
    expectedAmount: "100",
    expectedAsset: TOKEN,
    expectedRecipient: RECIPIENT,
    expectedPayer: payer.address,
    bindingSignature: wrongBindingSignature,
    jobId: "job-1",
    agentId: "42",
    resourceUrl,
    permission: permission(),
    tokenDecimals: 2,
    currency: "USDC",
    spentAmountAtomic: BigInt(0),
  });

  expect(result.status).toBe("rejected");
  expect(result.errorReason).toContain("binding signature");
});
