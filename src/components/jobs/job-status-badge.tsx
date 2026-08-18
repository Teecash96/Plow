import type { JobStatus } from "@/lib/marketplace/types";

const STATUS_LABELS: Record<JobStatus, string> = {
  draft: "Draft",
  pending: "Pending",
  active: "Active",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_STYLES: Record<JobStatus, string> = {
  draft: "border-surface-border bg-surface-raised text-muted",
  pending: "border-[#9a843c] bg-[#211d0d] text-[#e8d995]",
  active: "border-[#5a9876] bg-[#10271f] text-positive",
  completed: "border-[#5a9876] bg-[#10271f] text-positive",
  failed: "border-[#ad6565] bg-[#281414] text-negative",
  cancelled: "border-surface-border bg-surface-raised text-muted",
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${STATUS_STYLES[status]}`}><span className="size-1.5 rounded-full bg-current" />{STATUS_LABELS[status]}</span>;
}
