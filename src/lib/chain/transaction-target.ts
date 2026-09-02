import { decodeFunctionData, isAddress, parseAbi, type Hex } from "viem";

export const DELEGATION_MANAGER_ABI = parseAbi([
  "function redeemDelegations(bytes[] delegations, bytes32[] modes, bytes[] executions)",
]);

interface TransactionLike {
  to: string | null;
  input: Hex;
  value?: bigint;
}

function delegatedCallData(data: Hex, expectedTarget: string) {
  try {
    const decoded = decodeFunctionData({ abi: DELEGATION_MANAGER_ABI, data });
    if (decoded.functionName !== "redeemDelegations" || !decoded.args || decoded.args.length !== 3) return undefined;
    const [delegations, modes, executions] = decoded.args;
    if (delegations.length !== 1 || modes.length !== 1 || executions.length !== 1) return undefined;
    if (delegations[0].length <= 2 || modes[0].toLowerCase() !== `0x${"00".repeat(32)}`) return undefined;

    const execution = executions[0];
    const packedExecution = execution.slice(2);
  if (packedExecution.length < 40 + 64 + 8 || packedExecution.length % 2 !== 0) return undefined;
    const target = `0x${packedExecution.slice(0, 40)}`;
    if (!isAddress(target) || target.toLowerCase() !== expectedTarget.toLowerCase()) return undefined;
    if (BigInt(`0x${packedExecution.slice(40, 104)}`) !== BigInt(0)) return undefined;
    const callData = `0x${packedExecution.slice(104)}` as Hex;
    return callData === "0x" ? undefined : callData;
  } catch {
    return undefined;
  }
}

export function verifiedTransactionCallData(input: {
  transaction: TransactionLike;
  receiptTo: string | null;
  expectedTarget: string;
}): Hex | undefined {
  const { transaction, receiptTo, expectedTarget } = input;
  if (!isAddress(expectedTarget) || !transaction.to || !receiptTo || !isAddress(transaction.to) || !isAddress(receiptTo)) return undefined;
  if (transaction.value !== undefined && transaction.value !== BigInt(0)) return undefined;
  if (transaction.to.toLowerCase() === expectedTarget.toLowerCase() && receiptTo.toLowerCase() === expectedTarget.toLowerCase()) return transaction.input;
  if (transaction.to.toLowerCase() !== receiptTo.toLowerCase()) return undefined;
  return delegatedCallData(transaction.input, expectedTarget);
}
