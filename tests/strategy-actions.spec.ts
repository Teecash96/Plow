import { expect, test } from "@playwright/test";
import {
  isStrategyAction,
  materializeStrategyAction,
  parseStrategyActionRequest,
  strategyActionCategory,
  strategyActionMatchesRequest,
} from "@/lib/marketplace/strategy-actions";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const VAULT = "0x2222222222222222222222222222222222222222";

test("accepts bounded grid plans and rejects unsafe bounds", () => {
  const input = parseStrategyActionRequest({ kind: "grid-plan", levels: 5, bandPercent: "10" });
  expect(input).toEqual({ kind: "grid-plan", levels: 5, bandPercent: "10" });
  expect(strategyActionCategory("grid-plan")).toBe("grid-trading");
  expect(parseStrategyActionRequest({ kind: "grid-plan", levels: 1, bandPercent: "10" })).toBeUndefined();
  expect(parseStrategyActionRequest({ kind: "grid-plan", levels: 5, bandPercent: "51" })).toBeUndefined();
});

test("materializes an idempotent yield route selection", () => {
  const input = parseStrategyActionRequest({ kind: "yield-route", vaultAddress: VAULT, vaultName: "Stable route", assetSymbol: "usdc" });
  expect(input).toEqual({ kind: "yield-route", vaultAddress: VAULT, vaultName: "Stable route", assetSymbol: "USDC" });
  if (!input) throw new Error("Expected a valid yield route");
  const action = materializeStrategyAction(input, "2026-09-04T10:00:00.000Z");
  expect(isStrategyAction(action)).toBe(true);
  expect(strategyActionMatchesRequest(action, input)).toBe(true);
  expect(strategyActionMatchesRequest(action, { kind: "yield-route", vaultAddress: VAULT, vaultName: "Other route", assetSymbol: "USDC" })).toBe(false);
});

test("requires a valid account and threshold for health monitoring", () => {
  const input = parseStrategyActionRequest({ kind: "health-monitor", accountAddress: ACCOUNT, alertThreshold: "1.2" });
  expect(input).toEqual({ kind: "health-monitor", accountAddress: ACCOUNT, alertThreshold: "1.2" });
  expect(strategyActionCategory("health-monitor")).toBe("health-factor-monitoring");
  expect(parseStrategyActionRequest({ kind: "health-monitor", accountAddress: "not-an-address", alertThreshold: "1.2" })).toBeUndefined();
  expect(parseStrategyActionRequest({ kind: "health-monitor", accountAddress: ACCOUNT, alertThreshold: "1.00" })).toBeUndefined();
});
