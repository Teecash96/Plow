import { expect, test } from "@playwright/test";
import { DEMO_AGENTS } from "../src/lib/marketplace/agents";
import { buildProviderServiceListing } from "../src/lib/marketplace/registry";
import { getProviderServiceListingId, type ProviderProfileConfig, type ProviderServiceConfig } from "../src/lib/marketplace/provider-service";
import { AGENT_CATEGORIES, type Agent } from "../src/lib/marketplace/types";

test("a shared provider publishes one explicit marketplace listing per category", async () => {
  const profile: ProviderProfileConfig = {
    agentId: "325479",
    price: "0.25",
    currency: "U",
    name: "Plow Strategy Provider",
    description: "A provider used by the catalog test.",
    supportedCategories: AGENT_CATEGORIES,
  };
  const config = {
    profileMode: false,
    executionUrl: "https://provider.example/api/provider/execute",
  } as ProviderServiceConfig;
  const listings = await Promise.all(AGENT_CATEGORIES.map((category) => buildProviderServiceListing(DEMO_AGENTS[0] as Agent, profile, category, config)));

  expect(listings.map((listing) => listing.listingId)).toEqual(AGENT_CATEGORIES.map((category) => getProviderServiceListingId("325479", category)));
  expect(new Set(listings.map((listing) => listing.id)).size).toBe(AGENT_CATEGORIES.length);
  expect(new Set(listings.map((listing) => listing.identity.agentId)).size).toBe(1);
  expect(listings.map((listing) => listing.name)).toEqual(["Range Steward", "Grid Pilot", "Yield Scout", "Health Sentinel"]);
  expect(listings.every((listing, index) => listing.category === AGENT_CATEGORIES[index] && listing.supportedCategories?.length === 1 && listing.supportedCategories[0] === AGENT_CATEGORIES[index])).toBe(true);
  expect(listings.every((listing) => listing.providerName === profile.name && listing.listingMode === "shared")).toBe(true);
});
