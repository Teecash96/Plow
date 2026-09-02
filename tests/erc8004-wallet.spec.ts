import { expect, test } from "@playwright/test";
import { createBscPublicClient } from "../src/lib/chain/erc8004-adapter";
import { setErc8004AgentUri, type ConnectedErc8004Wallet } from "../src/lib/chain/erc8004-wallet";

const wallet = {
  account: "0x1111111111111111111111111111111111111111",
  chainId: 56,
  walletClient: {},
  publicClient: {},
} as unknown as ConnectedErc8004Wallet;

test("rejects a non public metadata URI before asking the chain", async () => {
  await expect(setErc8004AgentUri(wallet, "42", "https://localhost:3000/api/provider/metadata")).rejects.toThrow("public HTTPS host");
});

test("rejects a non HTTPS metadata URI before asking the chain", async () => {
  await expect(setErc8004AgentUri(wallet, "42", "http://provider.example/api/provider/metadata")).rejects.toThrow("HTTPS");
});

test("uses a fallback transport for ERC 8004 receipt reads", () => {
  expect(createBscPublicClient().transport.type).toBe("fallback");
});
