import { expect, test } from "@playwright/test";
import { getX402SettlementTransactionOverrides } from "@/lib/payments/x402-resource";

test("bounds facilitator settlement to zero native value", () => {
  expect(getX402SettlementTransactionOverrides()).toEqual({
    gas: BigInt(150_000),
    value: BigInt(0),
  });
  expect(getX402SettlementTransactionOverrides(BigInt(120_000))).toEqual({
    gas: BigInt(120_000),
    value: BigInt(0),
  });
  expect(getX402SettlementTransactionOverrides(BigInt(120_000), BigInt(50_000_000))).toEqual({
    gas: BigInt(120_000),
    value: BigInt(0),
    gasPrice: BigInt(50_000_000),
  });
});
