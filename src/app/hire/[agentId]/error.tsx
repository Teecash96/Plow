"use client";

import { RouteError } from "@/components/marketplace/route-error";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError title="The hiring workspace could not load" description="The agent record or setup status was unavailable. No wallet action was started." reset={reset} backHref="/agents" backLabel="Back to agents" />;
}
