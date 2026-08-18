"use client";

import { RouteError } from "@/components/marketplace/route-error";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError title="This job could not load" description="The local job record was unavailable. No payment receipt or result is shown without a readable record." reset={reset} backHref="/jobs" backLabel="Back to jobs" />;
}
