import { expect, test } from "@playwright/test";
import { findMarketplaceAgentById } from "../src/lib/marketplace/agent-lookup";

test("resolves an ERC 8004 route when the agent is missing from the current list", async () => {
  const directAgent = { id: "erc8004-bsc-323657", slug: "erc8004-323657" };
  const lookupCalls: string[] = [];

  const agent = await findMarketplaceAgentById(
    "erc8004-323657",
    [],
    async (agentId) => {
      lookupCalls.push(agentId);
      return directAgent;
    },
  );

  expect(agent).toBe(directAgent);
  expect(lookupCalls).toEqual(["323657"]);
});

test("resolves a raw numeric ERC 8004 route", async () => {
  const directAgent = { id: "erc8004-bsc-325479", slug: "erc8004-325479" };
  const lookupCalls: string[] = [];

  const agent = await findMarketplaceAgentById(
    "325479",
    [],
    async (agentId) => {
      lookupCalls.push(agentId);
      return directAgent;
    },
  );

  expect(agent).toBe(directAgent);
  expect(lookupCalls).toEqual(["325479"]);
});
