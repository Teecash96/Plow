import type { Metadata } from "next";
import { buildProviderRegistrationMetadata, getProviderProfileExecutionUrl, getProviderProfileHealthUrl, getProviderProfileMetadataUrl, getProviderServiceConfig } from "@/lib/marketplace/provider-service";
import { getProviderSignerStatus } from "@/lib/marketplace/provider-submission";
import { PROVIDER_METADATA_PATH } from "@/lib/marketplace/provider-paths";
import { ProviderOnboarding } from "./provider-onboarding";

export const metadata: Metadata = {
  title: "Provider setup | BNB Agent Studio",
  description: "Register an ERC 8004 identity and connect a controlled Plow provider.",
};

export const dynamic = "force-dynamic";

export default function ProviderPage() {
  const config = getProviderServiceConfig();
  const signer = getProviderSignerStatus();
  const metadata = buildProviderRegistrationMetadata(config);
  const metadataUrl = config.publicBaseUrl ? `${config.publicBaseUrl}${PROVIDER_METADATA_PATH}` : undefined;
  const initialProfiles = config.profiles.map((profile) => ({
    agentId: profile.agentId,
    name: profile.name,
    price: profile.price,
    currency: profile.currency,
    supportedCategories: profile.supportedCategories,
    listingMode: config.profileMode ? "independent" as const : "shared" as const,
    signerConfigured: getProviderSignerStatus(profile.agentId).configured,
    executionUrl: getProviderProfileExecutionUrl(config, profile),
    healthUrl: getProviderProfileHealthUrl(config, profile),
    metadataUrl: getProviderProfileMetadataUrl(config, profile),
  }));

  return (
    <ProviderOnboarding
      initialAgentId={config.agentId}
      initialMetadataUrl={metadata ? metadataUrl : undefined}
      initialProviderUrl={config.publicBaseUrl}
      initialProviderReady={Boolean(metadata && signer.configured)}
      initialProviderReason={config.reason !== "The provider service is ready." ? config.reason : signer.reason}
      initialProfiles={initialProfiles}
    />
  );
}
