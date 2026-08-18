"use client";

import { RouteError } from "@/components/marketplace/route-error";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError title="The agent registry could not load" description="The BSC registry or its metadata source did not respond. Try again, or continue with the pages that are already available." reset={reset} />;
}
