import { isAddress, parseUnits } from "viem";
import type { SessionPermission } from "./types";

export type PermissionAction =
  | "erc8183-create"
  | "erc8183-budget"
  | "erc8183-register"
  | "token-approval"
  | "x402-payment"
  | "erc8183-fund"
  | "erc8183-dispute"
  | "erc8183-settle"
  | "erc8183-refund"
  | "pancakeswap-rebalance"
  | "agent-execution";

export type PermissionPolicyErrorCode =
  | "missing"
  | "revoked"
  | "expired"
  | "invalid"
  | "not-allowlisted"
  | "over-cap";

export class PermissionPolicyError extends Error {
  readonly code: PermissionPolicyErrorCode;

  constructor(message: string, code: PermissionPolicyErrorCode) {
    super(message);
    this.name = "PermissionPolicyError";
    this.code = code;
  }
}

export interface PermissionCheck {
  permission?: SessionPermission;
  action: PermissionAction;
  contractAddress?: string;
  tokenAddress?: string;
  amountAtomic?: bigint;
  tokenDecimals?: number;
  currency?: string;
  spentAmountAtomic?: bigint;
  countAmount?: boolean;
  requireAmount?: boolean;
  now?: number;
}

function reject(message: string, code: PermissionPolicyErrorCode): never {
  throw new PermissionPolicyError(message, code);
}

function normalizedAddress(value: unknown, label: string) {
  if (typeof value !== "string" || !isAddress(value)) reject(`The permission contains an invalid ${label} address.`, "invalid");
  return value.toLowerCase();
}

function normalizedAllowlist(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length === 0) reject(`The permission ${label} allowlist is empty.`, "invalid");
  return new Set(value.map((entry) => normalizedAddress(entry, label)));
}

function amountSyntax(value: unknown, label: string) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    reject(`The permission ${label} is invalid.`, "invalid");
  }
  return value.trim();
}

function amountAtomic(value: string, decimals: number, label: string) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) reject("The token precision is invalid.", "invalid");
  try {
    const parsed = parseUnits(value, decimals);
    if (parsed <= BigInt(0)) reject(`The permission ${label} must be greater than zero.`, "invalid");
    return parsed;
  } catch {
    reject(`The permission ${label} is invalid for this token.`, "invalid");
  }
}

export function permissionExpiryForDuration(value: string, now = Date.now()) {
  const seconds = value === "1 hour"
    ? 60 * 60
    : value === "24 hours"
      ? 24 * 60 * 60
      : value === "7 days"
        ? 7 * 24 * 60 * 60
        : value === "14 days"
          ? 14 * 24 * 60 * 60
        : undefined;
  if (!seconds) throw new PermissionPolicyError("The permission expiration is invalid.", "invalid");
  return new Date(now + seconds * 1000).toISOString();
}

export function assertPermissionAllows(input: PermissionCheck) {
  const permission = input.permission;
  if (!permission) reject("An active permission is required before this operation.", "missing");
  if (permission.provider !== "Altana") reject("The permission provider is not supported.", "invalid");
  if (permission.status === "revoked") reject("The permission has been revoked.", "revoked");
  if (permission.status !== "active") reject("The permission is not active.", "missing");

  const now = input.now ?? Date.now();
  if (!permission.expiresAtTimestamp) reject("The permission has no absolute expiration.", "invalid");
  const expiresAt = Date.parse(permission.expiresAtTimestamp);
  if (!Number.isFinite(expiresAt)) reject("The permission expiration is invalid.", "invalid");
  if (expiresAt <= now) reject("The permission has expired.", "expired");

  const capText = amountSyntax(permission.spendCap, "spend cap");
  const contracts = normalizedAllowlist(permission.allowlistedContracts, "contract");
  const tokens = normalizedAllowlist(permission.allowlistedTokens, "token");

  if (input.currency && permission.currency.toLowerCase() !== input.currency.toLowerCase()) {
    reject("The permission currency does not match the requested payment.", "invalid");
  }

  if (input.action !== "agent-execution") {
    const contract = normalizedAddress(input.contractAddress, "target contract");
    if (!contracts.has(contract)) reject("The target contract is not in the permission allowlist.", "not-allowlisted");
  }

  const requiresToken = input.action === "erc8183-budget"
    || input.action === "token-approval"
    || input.action === "x402-payment"
    || input.action === "erc8183-fund"
    || input.action === "pancakeswap-rebalance";
  if (requiresToken) {
    const token = normalizedAddress(input.tokenAddress, "target token");
    if (!tokens.has(token)) reject("The target token is not in the permission allowlist.", "not-allowlisted");
  }

  if (input.requireAmount !== false && (input.amountAtomic !== undefined || requiresToken && input.tokenDecimals === undefined)) {
    if (input.amountAtomic === undefined || input.tokenDecimals === undefined) reject("The permission check is missing the token amount.", "invalid");
    if (input.amountAtomic <= BigInt(0)) reject("The permission amount must be greater than zero.", "invalid");
    if (input.countAmount !== false && input.spentAmountAtomic === undefined) {
      reject("The permission check is missing cumulative spend.", "invalid");
    }
    const cap = amountAtomic(capText, input.tokenDecimals, "spend cap");
    const spent = input.spentAmountAtomic ?? BigInt(0);
    if (spent < BigInt(0)) reject("The permission spent amount is invalid.", "invalid");
    if (input.amountAtomic > cap || (input.countAmount !== false && spent + input.amountAtomic > cap)) {
      reject("The requested spend exceeds the permission spend cap.", "over-cap");
    }
  }

  return true;
}
