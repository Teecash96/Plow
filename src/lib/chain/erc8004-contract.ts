import { parseAbi, type Address } from "viem";

export const BSC_MAINNET_CHAIN_ID = 56 as const;
export const ERC8004_IDENTITY_REGISTRY_ADDRESS = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address;
export const ERC8004_REGISTRY_EXPLORER_URL = `https://bscscan.com/address/${ERC8004_IDENTITY_REGISTRY_ADDRESS}`;
export const ERC8004_AGENT_REGISTRY = `eip155:${BSC_MAINNET_CHAIN_ID}:${ERC8004_IDENTITY_REGISTRY_ADDRESS}` as const;

export const ERC8004_IDENTITY_REGISTRY_ABI = parseAbi([
  "function register() returns (uint256 agentId)",
  "function register(string agentURI) returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);
