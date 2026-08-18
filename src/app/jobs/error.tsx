"use client";

import { RouteError } from "@/components/marketplace/route-error";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError title="Jobs could not load" description="The local job index could not be read in this browser. No payment or result state is inferred." reset={reset} />;
}
