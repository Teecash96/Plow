import type { Metadata } from "next";
import { buildProviderRegistrationMetadata, getProviderServiceConfig } from "@/lib/marketplace/provider-service";
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

  return (
    <ProviderOnboarding
      initialAgentId={config.agentId}
      initialMetadataUrl={metadata ? metadataUrl : undefined}
      initialProviderUrl={config.publicBaseUrl}
      initialProviderReady={Boolean(metadata && signer.configured)}
      initialProviderReason={config.reason !== "The provider service is ready." ? config.reason : signer.reason}
    />
  );
}
