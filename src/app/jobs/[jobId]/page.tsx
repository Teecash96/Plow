import type { Metadata } from "next";
import { JobDetail } from "./job-detail";

interface JobDetailPageProps {
  params: Promise<{ jobId: string }>;
}

export async function generateMetadata({ params }: JobDetailPageProps): Promise<Metadata> {
  const { jobId } = await params;
  return {
    title: `Job ${jobId} | BNB Agent Studio`,
    description: "Review a saved job, terms, payment preview, result state, and status timeline.",
  };
}

export default async function JobDetailPage({ params }: JobDetailPageProps) {
  const { jobId } = await params;
  return <JobDetail jobId={jobId} />;
}
