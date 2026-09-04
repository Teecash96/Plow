import { expect, test } from "@playwright/test";
import { NextRequest } from "next/server";
import { POST as executePOST } from "../src/app/api/provider/execute/route";
import { GET as healthGET } from "../src/app/api/provider/health/route";
import { GET as metadataGET } from "../src/app/api/provider/metadata/route";
import {
  AGENT_EXECUTION_PROTOCOL,
  buildProviderExecutionResult,
  createProviderRequestSignature,
  getProviderServiceConfig,
  getProviderProfileExecutionUrl,
  getProviderProfileHealthUrl,
  getProviderProfileMetadataUrl,
  getProviderServiceListingId,
  parseProviderExecutionRequest,
  providerEndpointMatches,
  readProviderRequestBody,
  signedProviderRequestHeaders,
} from "../src/lib/marketplace/provider-service";

test.describe.configure({ mode: "serial" });

const SECRET = "provider-test-secret-012345678901234567890123";
const PROVIDER_ENV_KEYS = [
  "PLOW_PROVIDER_ENABLED",
  "PLOW_PROVIDER_AGENT_ID",
  "PLOW_PROVIDER_PRICE",
  "PLOW_PROVIDER_CURRENCY",
  "PLOW_PROVIDER_REQUEST_SECRET",
  "PLOW_PROVIDER_PRIVATE_KEY",
  "PLOW_PROVIDER_PUBLIC_URL",
  "PLOW_PROVIDER_EXECUTION_URL",
  "PLOW_PROVIDER_NAME",
  "PLOW_PROVIDER_DESCRIPTION",
  "PLOW_PROVIDER_PROFILES",
] as const;

function setProviderEnvironment() {
  process.env.PLOW_PROVIDER_ENABLED = "true";
  process.env.PLOW_PROVIDER_AGENT_ID = "42";
  process.env.PLOW_PROVIDER_PRICE = "0.25";
  process.env.PLOW_PROVIDER_CURRENCY = "USDC";
  process.env.PLOW_PROVIDER_REQUEST_SECRET = SECRET;
  process.env.PLOW_PROVIDER_PRIVATE_KEY = "0x0123456789012345678901234567890123456789012345678901234567890123";
  process.env.PLOW_PROVIDER_PUBLIC_URL = "https://provider.example";
  delete process.env.PLOW_PROVIDER_EXECUTION_URL;
  process.env.PLOW_PROVIDER_NAME = "Controlled Test Provider";
  process.env.PLOW_PROVIDER_DESCRIPTION = "A controlled provider used by the route test.";
  delete process.env.PLOW_PROVIDER_PROFILES;
}

function clearProviderEnvironment() {
  for (const key of PROVIDER_ENV_KEYS) delete process.env[key];
}

function executionBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    protocol: AGENT_EXECUTION_PROTOCOL,
    job: {
      id: "job-provider-001",
      agentId: "42",
      agentIdentityId: "42",
      marketplaceAgentId: "erc8004-bsc-42",
      status: "active",
      taskSummary: "Return a bounded test result.",
      category: "rebalancing",
      clientAddress: "0x2222222222222222222222222222222222222222",
      onchainNetwork: "BSC Mainnet",
      onchainChainId: 56,
      termsHash: "0xterms-hash",
      price: "0.250",
      currency: "USDC",
      onchainJobId: "7",
      payment: {
        status: "paid",
        amount: "0.25",
        currency: "USDC",
        transactionHash: `0x${"1".repeat(64)}`,
      },
      ...overrides,
    },
  });
}

test.beforeEach(() => {
  setProviderEnvironment();
});

test.afterEach(() => {
  clearProviderEnvironment();
});

test("requires explicit provider configuration", async () => {
  process.env.PLOW_PROVIDER_ENABLED = "false";
  const config = getProviderServiceConfig();
  expect(config.ready).toBe(false);

  const response = await healthGET();
  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toMatchObject({ status: "unavailable" });
});

test("defaults provider metadata to the configured BSC payment token", async () => {
  delete process.env.PLOW_PROVIDER_CURRENCY;

  const config = getProviderServiceConfig();
  expect(config.currency).toBe("U");

  const metadata = await metadataGET();
  expect(metadata.status).toBe(200);
  await expect(metadata.json()).resolves.toMatchObject({
    plow: { x402: { currency: "U" } },
  });
});

test("returns a fresh heartbeat and publishable metadata", async () => {
  const health = await healthGET();
  expect(health.status).toBe(200);
  await expect(health.json()).resolves.toMatchObject({ status: "ok", agentId: "42" });

  const metadata = await metadataGET();
  expect(metadata.status).toBe(200);
  const metadataBody = await metadata.json();
  expect(metadataBody).toMatchObject({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    agentId: "42",
    registrations: [{ agentRegistry: "eip155:56:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432", agentId: "42" }],
    plow: {
      health: { endpoint: "https://provider.example/api/provider/health" },
      x402: { supported: true, amount: "0.25", currency: "USDC" },
      },
  });
  expect(metadataBody.services[0]).toMatchObject({ protocol: AGENT_EXECUTION_PROTOCOL, endpoint: "https://provider.example/api/provider/execute" });
  expect(metadataBody.services).toHaveLength(4);
  expect(metadataBody.services.map((service: { listingId: string }) => service.listingId)).toEqual([
    getProviderServiceListingId("42", "rebalancing"),
    getProviderServiceListingId("42", "grid-trading"),
    getProviderServiceListingId("42", "yield-optimisation"),
    getProviderServiceListingId("42", "health-factor-monitoring"),
  ]);
  expect(metadataBody.plow.listings).toHaveLength(4);
});

test("health identifies the selected category listing", async () => {
  const response = await healthGET(new NextRequest("https://provider.example/api/provider/health?agentId=42&category=grid-trading"));
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    agentId: "42",
    service: {
      listingId: getProviderServiceListingId("42", "grid-trading"),
      category: "grid-trading",
    },
  });
});

test("binds metadata, health, and execution to the selected provider profile", async () => {
  process.env.PLOW_PROVIDER_PROFILES = JSON.stringify([
    {
      agentId: "42",
      categories: ["rebalancing"],
      name: "Range Provider",
      price: "0.25",
      currency: "USDC",
      privateKey: `0x${"1".repeat(64)}`,
    },
    {
      agentId: "43",
      categories: ["grid-trading"],
      name: "Grid Provider",
      price: "0.50",
      currency: "USDC",
      privateKey: `0x${"2".repeat(64)}`,
    },
  ]);

  const config = getProviderServiceConfig();
  expect(config.profileMode).toBe(true);
  expect(config.profiles).toHaveLength(2);
  expect(config.profiles[1]).toMatchObject({ agentId: "43", supportedCategories: ["grid-trading"] });

  const payload = JSON.parse(executionBody()) as { job: Record<string, unknown> };
  payload.job.agentId = "43";
  payload.job.agentIdentityId = "43";
  payload.job.marketplaceAgentId = getProviderServiceListingId("43", "grid-trading");
  payload.job.category = "grid-trading";
  payload.job.price = "0.50";
  payload.job.payment = {
    status: "paid",
    amount: "0.50",
    currency: "USDC",
    transactionHash: `0x${"1".repeat(64)}`,
  };
  const parsed = parseProviderExecutionRequest(JSON.stringify(payload), config);
  expect(parsed.job.agentId).toBe("43");
  expect(parsed.job.category).toBe("grid-trading");

  const health = await healthGET(new NextRequest("https://provider.example/api/provider/health?agentId=43"));
  expect(health.status).toBe(200);
  await expect(health.json()).resolves.toMatchObject({
    agentId: "43",
    listingMode: "independent",
    executionEndpoint: "https://provider.example/api/provider/execute?agentId=43",
    healthEndpoint: "https://provider.example/api/provider/health?agentId=43",
    supportedCategories: ["grid-trading"],
  });

  const metadata = await metadataGET(new NextRequest("https://provider.example/api/provider/metadata?agentId=43"));
  expect(metadata.status).toBe(200);
  await expect(metadata.json()).resolves.toMatchObject({
    agentId: "43",
    name: "Grid Provider",
    plow: {
      profile: { mode: "independent", agentId: "43", category: "grid-trading" },
      health: { endpoint: "https://provider.example/api/provider/health?agentId=43" },
      x402: { amount: "0.50", currency: "USDC" },
      supportedCategories: ["grid-trading"],
    },
  });
});

test("scopes profile endpoints and signing to the selected identity", () => {
  process.env.PLOW_PROVIDER_PROFILES = JSON.stringify([
    { agentId: "42", categories: ["rebalancing"], price: "0.25", currency: "USDC", privateKey: `0x${"1".repeat(64)}` },
    { agentId: "43", categories: ["grid-trading"], price: "0.25", currency: "USDC", privateKey: `0x${"2".repeat(64)}` },
  ]);

  const config = getProviderServiceConfig();
  const profile = config.profiles[1];
  expect(profile).toBeDefined();
  expect(getProviderProfileExecutionUrl(config, profile!)).toBe("https://provider.example/api/provider/execute?agentId=43");
  expect(getProviderProfileHealthUrl(config, profile!)).toBe("https://provider.example/api/provider/health?agentId=43");
  expect(getProviderProfileMetadataUrl(config, profile!)).toBe("https://provider.example/api/provider/metadata?agentId=43");
  expect(providerEndpointMatches("https://provider.example/api/provider/execute?agentId=43", config, "43")).toBe(true);
  expect(providerEndpointMatches("https://provider.example/api/provider/execute?agentId=43", config, "42")).toBe(false);
});

test("supports explicit endpoints for a profile", () => {
  process.env.PLOW_PROVIDER_PROFILES = JSON.stringify([
    {
      agentId: "43",
      categories: ["grid-trading"],
      price: "0.50",
      currency: "USDC",
      executionUrl: "https://grid.provider.example/run",
      healthUrl: "https://grid.provider.example/health",
      privateKey: `0x${"2".repeat(64)}`,
    },
  ]);

  const config = getProviderServiceConfig();
  const profile = config.profiles[0];
  expect(getProviderProfileExecutionUrl(config, profile)).toBe("https://grid.provider.example/run");
  expect(getProviderProfileHealthUrl(config, profile)).toBe("https://grid.provider.example/health");
  expect(providerEndpointMatches("https://grid.provider.example/run", config, "43")).toBe(true);
  expect(providerEndpointMatches("https://provider.example/api/provider/execute", config, "43")).toBe(false);
});

test("rejects a category that belongs to another provider profile", () => {
  process.env.PLOW_PROVIDER_PROFILES = JSON.stringify([
    { agentId: "42", categories: ["rebalancing"], price: "0.25", currency: "USDC", privateKey: `0x${"1".repeat(64)}` },
    { agentId: "43", categories: ["grid-trading"], price: "0.50", currency: "USDC", privateKey: `0x${"2".repeat(64)}` },
  ]);
  const payload = JSON.parse(executionBody()) as { job: Record<string, unknown> };
  payload.job.agentId = "43";
  payload.job.agentIdentityId = "43";
  payload.job.price = "0.50";
  payload.job.payment = { status: "paid", amount: "0.50", currency: "USDC", transactionHash: `0x${"1".repeat(64)}` };

  expect(() => parseProviderExecutionRequest(JSON.stringify(payload))).toThrow("provider does not support this job category");
});

test("binds a paid request to the selected category listing", () => {
  const payload = JSON.parse(executionBody()) as { job: Record<string, unknown> };
  payload.job.category = "grid-trading";
  payload.job.marketplaceAgentId = getProviderServiceListingId("42", "rebalancing");

  expect(() => parseProviderExecutionRequest(JSON.stringify(payload))).toThrow("marketplace listing does not match");
});

test("fails closed on duplicate provider profile identities", () => {
  process.env.PLOW_PROVIDER_PROFILES = JSON.stringify([
    { agentId: "42", categories: ["rebalancing"], price: "0.25", currency: "USDC" },
    { agentId: "42", categories: ["grid-trading"], price: "0.25", currency: "USDC" },
  ]);

  const config = getProviderServiceConfig();
  expect(config.profileMode).toBe(true);
  expect(config.ready).toBe(false);
  expect(config.reason).toContain("agent IDs must be unique");
});

test("rejects unsigned provider execution requests", async () => {
  const response = await executePOST(new NextRequest("http://localhost/api/provider/execute", {
    method: "POST",
    headers: { "content-type": "application/json", "x-plow-agent-id": "42", "x-plow-job-id": "job-provider-001" },
    body: executionBody(),
  }));

  expect(response.status).toBe(401);
});

test("does not report completion when provider signing is not configured", async () => {
  delete process.env.PLOW_PROVIDER_PRIVATE_KEY;
  const body = executionBody();
  const requestHeaders = signedProviderRequestHeaders(body, SECRET);
  const response = await executePOST(new NextRequest("http://localhost/api/provider/execute", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-plow-agent-id": "42",
      "x-plow-job-id": "job-provider-001",
      ...requestHeaders,
    },
    body,
  }));

  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toMatchObject({
    error: "Provider submission is not configured. Add PLOW_PROVIDER_PRIVATE_KEY on the provider server.",
  });
});

test("rejects unpaid or mismatched jobs before execution", async () => {
  const unpaidBody = executionBody({ payment: { status: "pending", amount: "0.25", currency: "USDC", transactionHash: `0x${"1".repeat(64)}` } });
  const unpaidHeaders = signedProviderRequestHeaders(unpaidBody, SECRET);
  const unpaidResponse = await executePOST(new NextRequest("http://localhost/api/provider/execute", {
    method: "POST",
    headers: { ...unpaidHeaders, "x-plow-agent-id": "42", "x-plow-job-id": "job-provider-001" },
    body: unpaidBody,
  }));
  expect(unpaidResponse.status).toBe(409);

  const wrongPriceBody = executionBody({ price: "0.26" });
  const wrongPriceHeaders = signedProviderRequestHeaders(wrongPriceBody, SECRET);
  const wrongPriceResponse = await executePOST(new NextRequest("http://localhost/api/provider/execute", {
    method: "POST",
    headers: { ...wrongPriceHeaders, "x-plow-agent-id": "42", "x-plow-job-id": "job-provider-001" },
    body: wrongPriceBody,
  }));
  expect(wrongPriceResponse.status).toBe(409);
});

test("rejects a request whose signed headers name another job", async () => {
  const body = executionBody();
  const requestHeaders = signedProviderRequestHeaders(body, SECRET);
  const response = await executePOST(new NextRequest("http://localhost/api/provider/execute", {
    method: "POST",
    headers: { ...requestHeaders, "x-plow-agent-id": "42", "x-plow-job-id": "another-job" },
    body,
  }));

  expect(response.status).toBe(409);
});

test("bounds provider request bodies before parsing", async () => {
  const oversized = "x".repeat(64 * 1024 + 1);
  await expect(readProviderRequestBody(new Request("http://localhost/api/provider/execute", {
    method: "POST",
    body: oversized,
  }))).rejects.toMatchObject({ status: 413 });
});

test("binds signatures to the raw request body", () => {
  const body = executionBody();
  const timestamp = String(Date.now());
  const signature = createProviderRequestSignature(body, timestamp, SECRET);
  expect(signature).toHaveLength(64);
  expect(createProviderRequestSignature(`${body} `, timestamp, SECRET)).not.toBe(signature);

  const parsed = parseProviderExecutionRequest(body);
  expect(buildProviderExecutionResult(parsed).status).toBe("completed");
});
