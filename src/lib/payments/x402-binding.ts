export interface X402PaymentBindingInput {
  jobId: string;
  agentId: string;
  resourceUrl: string;
  amount: string;
  asset: string;
  recipient: string;
  network: string;
}

/**
 * The Permit2 authorization does not sign an application job ID. This
 * deterministic message is signed by the payer as the application binding.
 */
export function x402PaymentBindingMessage(input: X402PaymentBindingInput) {
  return JSON.stringify([
    "plow-x402-binding-v1",
    input.jobId,
    input.agentId,
    input.resourceUrl,
    input.amount,
    input.asset.toLowerCase(),
    input.recipient.toLowerCase(),
    input.network,
  ]);
}
