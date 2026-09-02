import { PERMIT2_ADDRESS } from "@x402/evm";
import { assertPermissionAllows } from "./permission-policy";
import type { SessionPermission } from "./types";

export interface HirePermissionPlanInput {
  permission: SessionPermission;
  contractAddress: string;
  tokenAddress: string;
  amountAtomic: bigint;
  tokenDecimals: number;
  currency: string;
}

export function assertHirePermissionPlan(input: HirePermissionPlanInput) {
  assertPermissionAllows({
    permission: input.permission,
    action: "erc8183-create",
    contractAddress: input.contractAddress,
  });
  assertPermissionAllows({
    permission: input.permission,
    action: "erc8183-budget",
    contractAddress: input.contractAddress,
    tokenAddress: input.tokenAddress,
    amountAtomic: input.amountAtomic,
    tokenDecimals: input.tokenDecimals,
    currency: input.currency,
    countAmount: false,
  });
  assertPermissionAllows({
    permission: input.permission,
    action: "x402-payment",
    contractAddress: PERMIT2_ADDRESS,
    tokenAddress: input.tokenAddress,
    amountAtomic: input.amountAtomic,
    tokenDecimals: input.tokenDecimals,
    currency: input.currency,
    spentAmountAtomic: BigInt(0),
  });
  assertPermissionAllows({
    permission: input.permission,
    action: "erc8183-fund",
    contractAddress: input.contractAddress,
    tokenAddress: input.tokenAddress,
    amountAtomic: input.amountAtomic,
    tokenDecimals: input.tokenDecimals,
    currency: input.currency,
    spentAmountAtomic: input.amountAtomic,
  });
}
