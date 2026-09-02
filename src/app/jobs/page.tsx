import type { Metadata } from "next";
import { JobsBrowser } from "./jobs-browser";

export const metadata: Metadata = {
  title: "Jobs | BNB Agent Studio",
  description: "Review saved agent jobs, local drafts, and future execution status.",
};

export default function JobsPage() {
  return <JobsBrowser />;
}
