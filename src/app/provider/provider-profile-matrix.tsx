"use client";

import { CheckCircle, CircleNotch, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { useState } from "react";
import { CATEGORY_DEFINITIONS } from "@/lib/marketplace/categories";
import type { AgentCategory, AgentListingMode } from "@/lib/marketplace/types";

export interface ProviderProfileSummary {
  agentId: string;
  name: string;
  price: string;
  currency: string;
  supportedCategories: readonly AgentCategory[];
  listingMode: AgentListingMode;
  signerConfigured: boolean;
  executionUrl?: string;
  healthUrl?: string;
  metadataUrl?: string;
}

type ProfileProbe = {
  status: "ready" | "unavailable";
  detail: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function responseJson(response: Response) {
  try {
    const value: unknown = await response.json();
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

async function checkProfile(profile: ProviderProfileSummary): Promise<ProfileProbe> {
  if (!profile.signerConfigured) {
    return { status: "unavailable", detail: "The server signer is not configured for this identity." };
  }
  if (!profile.healthUrl || !profile.metadataUrl) {
    return { status: "unavailable", detail: "A public provider URL is not configured for this identity." };
  }

  try {
    const [healthResponse, metadataResponse] = await Promise.all([
      fetch(profile.healthUrl, { cache: "no-store" }),
      fetch(profile.metadataUrl, { cache: "no-store" }),
    ]);
    const health = await responseJson(healthResponse);
    const metadata = await responseJson(metadataResponse);
    const healthAgentId = typeof health.agentId === "string" ? health.agentId : undefined;
    const metadataAgentId = typeof metadata.agentId === "string" ? metadata.agentId : undefined;
    if (!healthResponse.ok || !metadataResponse.ok) {
      const detail = typeof health.reason === "string"
        ? health.reason
        : typeof metadata.error === "string"
          ? metadata.error
          : "The provider service did not return ready responses.";
      return { status: "unavailable", detail };
    }
    if (healthAgentId !== profile.agentId || metadataAgentId !== profile.agentId) {
      return { status: "unavailable", detail: "The provider responses do not match this identity." };
    }
    return { status: "ready", detail: "Health and metadata match this identity." };
  } catch {
    return { status: "unavailable", detail: "The browser could not reach both provider endpoints." };
  }
}

function serviceLabel(probe: ProfileProbe | undefined) {
  if (!probe) return "Not checked";
  return probe.status === "ready" ? "Ready" : "Unavailable";
}

export function ProviderProfileMatrix({ initialProfiles }: { initialProfiles: readonly ProviderProfileSummary[] }) {
  const [checks, setChecks] = useState<Record<string, ProfileProbe>>({});
  const [checking, setChecking] = useState(false);

  async function checkAllProfiles() {
    if (initialProfiles.length === 0 || checking) return;
    setChecking(true);
    const results = await Promise.all(initialProfiles.map(async (profile) => [profile.agentId, await checkProfile(profile)] as const));
    setChecks((current) => ({ ...current, ...Object.fromEntries(results) }));
    setChecking(false);
  }

  const configuredCategories = new Set(initialProfiles.flatMap((profile) => profile.supportedCategories));
  const readyCategories = CATEGORY_DEFINITIONS.filter((category) => {
    const profile = initialProfiles.find((candidate) => candidate.supportedCategories.includes(category.id));
    return Boolean(profile && profile.signerConfigured && checks[profile.agentId]?.status === "ready");
  }).length;

  return (
    <section className="mt-10 rounded-3xl border border-surface-border bg-surface p-5 sm:p-6" aria-labelledby="provider-profile-matrix-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Four category build</p>
          <h2 id="provider-profile-matrix-title" className="mt-3 text-2xl font-semibold">Provider profile matrix</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">Each category needs a configured ERC 8004 identity, a matching server signer, and a reachable provider service. This check uses read only requests. It does not create an identity or spend funds.</p>
        </div>
        <button
          type="button"
          onClick={() => void checkAllProfiles()}
          disabled={initialProfiles.length === 0 || checking}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-surface-border px-4 py-2 text-sm font-semibold text-muted hover:border-[#6a6a6a] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand"
        >
          {checking ? <CircleNotch size={17} className="animate-spin" /> : <ShieldCheck size={17} />}
          {checking ? "Checking profiles" : "Check all profiles"}
        </button>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2" aria-label="Provider categories">
        {CATEGORY_DEFINITIONS.map((category) => {
          const profile = initialProfiles.find((candidate) => candidate.supportedCategories.includes(category.id));
          const probe = profile ? checks[profile.agentId] : undefined;
          const ready = Boolean(profile && profile.signerConfigured && probe?.status === "ready");
          return (
            <article key={category.id} data-testid={`provider-profile-${category.id}`} className={`rounded-2xl border p-4 ${ready ? "border-[#5a9876] bg-[#10271f]" : "border-surface-border bg-black"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{category.label}</h3>
                  <p className="mt-1 text-xs text-muted">{category.plainLanguage}</p>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${ready ? "border-[#5a9876] text-positive" : "border-[#9a843c] text-[#e8d995]"}`}>
                  {ready ? <CheckCircle size={14} weight="fill" /> : <WarningCircle size={14} />}
                  {ready ? "Ready" : profile ? "Setup needed" : "Needs profile"}
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                <div>
                  <dt className="text-muted">Identity</dt>
                  <dd className="mt-1 break-all font-mono text-foreground">{profile?.agentId ?? "Add ERC 8004 ID"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Listing</dt>
                  <dd className="mt-1 text-foreground">{profile?.listingMode === "independent" ? "Independent" : "Shared"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Signer</dt>
                  <dd className="mt-1 text-foreground">{profile?.signerConfigured ? "Server signer ready" : "Server signer needed"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Service</dt>
                  <dd className="mt-1 text-foreground">{serviceLabel(probe)}</dd>
                </div>
              </dl>

              {profile ? (
                <p className="mt-4 border-t border-surface-border pt-3 text-xs leading-5 text-muted">{profile.name} at {profile.price} {profile.currency} per task. {probe?.detail ?? "Run the profile check after the service is deployed."}</p>
              ) : (
                <p className="mt-4 border-t border-surface-border pt-3 text-xs leading-5 text-muted">{category.description} Add this category to PLOW_PROVIDER_PROFILES with its own identity and signer.</p>
              )}
            </article>
          );
        })}
      </div>

      <p className="mt-5 text-xs leading-5 text-muted">{initialProfiles.length === 0 ? "No provider profiles are configured on this deployment." : `${configuredCategories.size} of ${CATEGORY_DEFINITIONS.length} categories have a configured profile. ${readyCategories} passed the service check.`}</p>
    </section>
  );
}
