import { expect, test } from "@playwright/test";
import type { PublicClient } from "viem";
import { getERC8004AgentById } from "../src/lib/chain/erc8004-adapter";

test("reads a registered ERC 8004 identity directly by token ID", async () => {
  const metadata = encodeURIComponent(JSON.stringify({
    name: "Direct lookup agent",
    description: "A test registration",
    services: [{ endpoint: "https://agent.example/run" }],
    capabilities: ["analysis"],
  }));
  const calls: string[] = [];
  const client = {
    readContract: async ({ functionName }: { functionName: string }) => {
      calls.push(functionName);
      if (functionName === "tokenURI") return `data:application/json,${metadata}`;
      return "0x8A7f979ED5e518C9Cc45C100497d52Ed70229060";
    },
  } as unknown as PublicClient;

  const record = await getERC8004AgentById("323657", { client });

  expect(record).toMatchObject({
    agentId: "323657",
    agentURI: `data:application/json,${metadata}`,
    owner: "0x8A7f979ED5e518C9Cc45C100497d52Ed70229060",
    source: "rpc",
    identityVerified: true,
    metadataStatus: "verified",
    endpoints: ["https://agent.example/run"],
    capabilities: ["analysis"],
  });
  expect(calls).toEqual(["tokenURI", "ownerOf"]);
});
