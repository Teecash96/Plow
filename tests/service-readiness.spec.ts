import { expect, test } from "@playwright/test";
import {
  assessAgentServiceReadiness,
  parseAgentHeartbeatResponse,
  parseAgentServiceMetadata,
  sameDecimal,
} from "../src/lib/marketplace/service-readiness";

const CHECKED_AT = "2026-08-31T12:00:00.000Z";

test("reads only an explicit Plow service contract from ERC 8004 metadata", () => {
  const parsed = parseAgentServiceMetadata({
    services: [
      { name: "A2A", endpoint: "https://provider.example/card" },
      { name: "Plow execution", protocol: "plow-agent-execution-v1", endpoint: "https://provider.example/execute" },
    ],
    plow: {
      health: { endpoint: "https://provider.example/health" },
      x402: { supported: true, amount: "0.25", currency: "USDC", unit: "per task" },
    },
  });

  expect(parsed).toEqual({
    executionEndpoint: "https://provider.example/execute",
    healthEndpoint: "https://provider.example/health",
    x402Supported: true,
    pricing: { protocol: "x402", amount: "0.25", currency: "USDC", unit: "per task" },
  });
});

test("does not treat a generic A2A endpoint or false x402 flag as a hire contract", () => {
  const parsed = parseAgentServiceMetadata({
    services: [{ name: "A2A", endpoint: "https://provider.example/card" }],
    x402Support: false,
  });

  expect(parsed.executionEndpoint).toBeUndefined();
  expect(parsed.healthEndpoint).toBeUndefined();
  expect(parsed.x402Supported).toBe(false);
  expect(parsed.pricing).toBeUndefined();
});

test("compares provider prices without allowing a different payment amount", () => {
  expect(sameDecimal("0.25", "0.250")).toBe(true);
  expect(sameDecimal("0.25", "0.26")).toBe(false);
  expect(sameDecimal("Not available", "0.25")).toBe(false);
});

test("blocks a provider quote that uses the wrong BSC payment currency", () => {
  const readiness = assessAgentServiceReadiness({
    checkedAt: CHECKED_AT,
    now: CHECKED_AT,
    endpoint: { url: "https://provider.example/execute", verified: true },
    x402Supported: true,
    pricing: { protocol: "x402", amount: "0.25", currency: "USDC", unit: "per task" },
    expectedPaymentCurrency: "U",
    heartbeat: { verified: true, heartbeatAt: "2026-08-31T11:59:30.000Z" },
    bootstrapEligible: true,
  });

  expect(readiness.pricingVerified).toBe(false);
  expect(readiness.available).toBe(false);
  expect(readiness.pricing.detail).toContain("does not match the configured payment token U");
});

test("parses and binds a heartbeat response to the expected agent", () => {
  const body = JSON.stringify({ status: "ok", agentId: "42", heartbeatAt: "2026-08-31T11:59:30.000Z" });

  expect(parseAgentHeartbeatResponse(body, "42")).toBe("2026-08-31T11:59:30.000Z");
  expect(parseAgentHeartbeatResponse(body, "43")).toBeUndefined();
});

test("passes all four gates only with fresh service and completed execution evidence", () => {
  const readiness = assessAgentServiceReadiness({
    checkedAt: CHECKED_AT,
    now: CHECKED_AT,
    endpoint: {
      url: "https://provider.example/execute",
      verified: true,
      detail: "The Plow execution endpoint resolves to a public HTTPS service.",
    },
    x402Supported: true,
    pricing: { protocol: "x402", amount: "0.25", currency: "USDC", unit: "per task" },
    heartbeat: {
      verified: true,
      heartbeatAt: "2026-08-31T11:59:30.000Z",
      detail: "The provider health endpoint returned a fresh heartbeat.",
    },
    executionEvidence: {
      jobId: "job-42",
      completedAt: "2026-08-31T11:30:00.000Z",
      resultSummary: "Completed test execution.",
    },
  });

  expect(readiness).toMatchObject({
    endpointVerified: true,
    pricingVerified: true,
    heartbeatVerified: true,
    executionEvidenceVerified: true,
    freshnessVerified: true,
    available: true,
  });
});

test("allows the configured provider to perform its first paid execution", () => {
  const readiness = assessAgentServiceReadiness({
    checkedAt: CHECKED_AT,
    now: CHECKED_AT,
    endpoint: {
      url: "https://provider.example/execute",
      verified: true,
    },
    x402Supported: true,
    pricing: { protocol: "x402", amount: "0.25", currency: "USDC", unit: "per task" },
    heartbeat: {
      verified: true,
      heartbeatAt: "2026-08-31T11:59:30.000Z",
    },
    bootstrapEligible: true,
  });

  expect(readiness).toMatchObject({
    executionEvidenceVerified: false,
    bootstrapEligible: true,
    freshnessVerified: true,
    available: true,
  });
  expect(readiness.executionEvidence.detail).toContain("first paid execution");
});

test("blocks stale heartbeats, invalid prices, and missing execution evidence", () => {
  const readiness = assessAgentServiceReadiness({
    checkedAt: CHECKED_AT,
    now: CHECKED_AT,
    endpoint: { url: "https://provider.example/execute", verified: true },
    x402Supported: true,
    pricing: { protocol: "x402", amount: "Not available", currency: "USDC", unit: "per task" },
    heartbeat: { verified: true, heartbeatAt: "2026-08-30T12:00:00.000Z" },
  });

  expect(readiness.endpointVerified).toBe(true);
  expect(readiness.pricingVerified).toBe(false);
  expect(readiness.heartbeatVerified).toBe(false);
  expect(readiness.executionEvidenceVerified).toBe(false);
  expect(readiness.available).toBe(false);
  expect(readiness.reason).toContain("price");
});
