"use client";

import { RouteError } from "@/components/marketplace/route-error";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError title="Jobs could not load" description="The saved job index could not be read. No payment or result state is inferred." reset={reset} />;
}
