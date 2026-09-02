import { fallback, http } from "viem";

export const DEFAULT_BSC_MAINNET_RPC_URL = "https://bsc-dataseed.binance.org";
const BACKUP_BSC_MAINNET_RPC_URL = "https://bsc.publicnode.com";

export function getBscMainnetRpcUrls(configuredUrl?: string) {
  return [...new Set([
    configuredUrl?.trim(),
    DEFAULT_BSC_MAINNET_RPC_URL,
    BACKUP_BSC_MAINNET_RPC_URL,
  ].filter(Boolean))] as string[];
}

export function createBscMainnetTransport(configuredUrl?: string, timeout = 10_000) {
  return fallback(
    getBscMainnetRpcUrls(configuredUrl).map((url) => http(url, { timeout })),
    { rank: false },
  );
}
