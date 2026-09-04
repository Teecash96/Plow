import { isAddress } from "viem";
import type { AgentCategory, StrategyAction } from "./types";

export type StrategyActionRequest =
  | {
      kind: "grid-plan";
      levels: number;
      bandPercent: string;
    }
  | {
      kind: "yield-route";
      vaultAddress?: string;
      vaultName: string;
      assetSymbol?: string;
    }
  | {
      kind: "health-monitor";
      accountAddress: string;
      alertThreshold: string;
    };

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;
const SYMBOL_PATTERN = /^[A-Za-z0-9._-]{1,24}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDecimal(value: unknown, min: number, max: number) {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value.trim())) return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
}

export function parseStrategyActionRequest(value: unknown): StrategyActionRequest | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") return undefined;

  if (value.kind === "grid-plan") {
    if (!Number.isInteger(value.levels) || Number(value.levels) < 2 || Number(value.levels) > 20 || !validDecimal(value.bandPercent, 1, 50)) return undefined;
    return { kind: "grid-plan", levels: Number(value.levels), bandPercent: String(value.bandPercent).trim() };
  }

  if (value.kind === "yield-route") {
    if (typeof value.vaultName !== "string" || value.vaultName.trim().length < 1 || value.vaultName.trim().length > 100) return undefined;
    if (value.vaultAddress !== undefined && (typeof value.vaultAddress !== "string" || !isAddress(value.vaultAddress))) return undefined;
    if (value.assetSymbol !== undefined && (typeof value.assetSymbol !== "string" || !SYMBOL_PATTERN.test(value.assetSymbol.trim()))) return undefined;
    return {
      kind: "yield-route",
      vaultName: value.vaultName.trim(),
      ...(value.vaultAddress ? { vaultAddress: value.vaultAddress } : {}),
      ...(value.assetSymbol ? { assetSymbol: value.assetSymbol.trim().toUpperCase() } : {}),
    };
  }

  if (value.kind === "health-monitor") {
    if (typeof value.accountAddress !== "string" || !isAddress(value.accountAddress) || !validDecimal(value.alertThreshold, 1.01, 10)) return undefined;
    return {
      kind: "health-monitor",
      accountAddress: value.accountAddress,
      alertThreshold: String(value.alertThreshold).trim(),
    };
  }

  return undefined;
}

export function strategyActionCategory(kind: StrategyActionRequest["kind"]): AgentCategory {
  if (kind === "grid-plan") return "grid-trading";
  if (kind === "yield-route") return "yield-optimisation";
  return "health-factor-monitoring";
}

export function materializeStrategyAction(input: StrategyActionRequest, createdAt = new Date().toISOString()): StrategyAction {
  if (input.kind === "grid-plan") return { ...input, status: "planned", createdAt };
  if (input.kind === "yield-route") return { ...input, status: "selected", createdAt };
  return { ...input, status: "monitoring", createdAt };
}

export function isStrategyAction(value: unknown): value is StrategyAction {
  if (!isRecord(value) || typeof value.kind !== "string" || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) return false;
  if (value.kind === "grid-plan") return value.status === "planned" && typeof value.levels === "number" && Number.isInteger(value.levels) && value.levels >= 2 && value.levels <= 20 && validDecimal(value.bandPercent, 1, 50);
  if (value.kind === "yield-route") return value.status === "selected" && typeof value.vaultName === "string" && value.vaultName.length > 0 && value.vaultName.length <= 100 && (value.vaultAddress === undefined || isAddress(String(value.vaultAddress))) && (value.assetSymbol === undefined || SYMBOL_PATTERN.test(String(value.assetSymbol)));
  if (value.kind === "health-monitor") return value.status === "monitoring" && isAddress(String(value.accountAddress ?? "")) && validDecimal(value.alertThreshold, 1.01, 10);
  return false;
}

export function strategyActionMatchesRequest(action: StrategyAction, input: StrategyActionRequest) {
  if (input.kind === "grid-plan") return action.kind === "grid-plan" && action.levels === input.levels && action.bandPercent === input.bandPercent;
  if (input.kind === "yield-route") return action.kind === "yield-route" && action.vaultName === input.vaultName && action.vaultAddress?.toLowerCase() === input.vaultAddress?.toLowerCase() && action.assetSymbol === input.assetSymbol;
  return action.kind === "health-monitor" && action.accountAddress.toLowerCase() === input.accountAddress.toLowerCase() && action.alertThreshold === input.alertThreshold;
}
