import type { Job } from "./types";

export type HireResumeMode = "payment-and-funding" | "funding-only";

export function getHireResumeMode(
  job: Pick<Job, "status" | "onchainJobId" | "payment" | "escrow">,
): HireResumeMode | undefined {
  if (job.status !== "pending" || !job.onchainJobId || job.escrow?.status !== "open") return undefined;
  if (job.payment?.status === "paid") return "funding-only";
  if (job.payment?.status === "pending") return "payment-and-funding";
  return undefined;
}
