import { expect, test } from "@playwright/test";
import { encodeFunctionData, type Hex } from "viem";
import { ERC8183_ABI } from "@/lib/chain/erc8183-adapter";
import { DELEGATION_MANAGER_ABI, verifiedTransactionCallData } from "@/lib/chain/transaction-target";

const TARGET = "0xea4daa3100a767e86fded867729ae7446476eba6" as const;
const WRAPPER = "0xdb9b1e94b5b69df7e401ddbede43491141047db3" as const;
const PROVIDER = "0x1111111111111111111111111111111111111111" as const;
const ROUTER = "0x2222222222222222222222222222222222222222" as const;

function delegatedTransaction(target: string, callData: Hex, value = "00".repeat(32), executions = [0]) {
  const executionValues = executions.map(() => `0x${target.slice(2)}${value}${callData.slice(2)}` as Hex);
  const delegations = executions.map(() => "0x1234" as Hex);
  const modes = executions.map(() => `0x${"00".repeat(32)}` as Hex);
  return encodeFunctionData({
    abi: DELEGATION_MANAGER_ABI,
    functionName: "redeemDelegations",
    args: [delegations, modes, executionValues],
  });
}

test("unwraps a single MetaMask delegation call to the expected target", () => {
  const nestedCall = encodeFunctionData({
    abi: ERC8183_ABI,
    functionName: "createJob",
    args: [PROVIDER, ROUTER, BigInt(1_800_000_000), "test", ROUTER],
  });
  const delegatedCall = delegatedTransaction(TARGET, nestedCall);

  expect(verifiedTransactionCallData({
    transaction: { to: WRAPPER, input: delegatedCall, value: BigInt(0) },
    receiptTo: WRAPPER,
    expectedTarget: TARGET,
  })).toBe(nestedCall);
});

test("rejects delegated executions that add value or multiple calls", () => {
  const nestedCall = encodeFunctionData({
    abi: ERC8183_ABI,
    functionName: "createJob",
    args: [PROVIDER, ROUTER, BigInt(1_800_000_000), "test", ROUTER],
  });
  const nonZeroValue = delegatedTransaction(TARGET, nestedCall, `01${"00".repeat(31)}`);
  const multipleCalls = delegatedTransaction(TARGET, nestedCall, "00".repeat(32), [0, 1]);

  expect(verifiedTransactionCallData({
    transaction: { to: WRAPPER, input: nonZeroValue, value: BigInt(0) },
    receiptTo: WRAPPER,
    expectedTarget: TARGET,
  })).toBeUndefined();
  expect(verifiedTransactionCallData({
    transaction: { to: WRAPPER, input: multipleCalls, value: BigInt(0) },
    receiptTo: WRAPPER,
    expectedTarget: TARGET,
  })).toBeUndefined();
});
