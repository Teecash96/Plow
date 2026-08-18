"use client";

import { RouteError } from "@/components/marketplace/route-error";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError title="This agent profile could not load" description="The registry response was incomplete or unavailable. No identity or performance claim is shown while the profile is unavailable." reset={reset} backHref="/agents" backLabel="Back to agents" />;
}
