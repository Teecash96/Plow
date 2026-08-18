"use client";

import { ArrowLeft, CheckCircle, Clock, Code, FolderOpen, LockKey, Receipt } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/marketplace/empty-state";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { SetupChecklist } from "@/components/hire/setup-checklist";
import { AltanaPermissionPanel } from "@/components/partners/altana-permission-panel";
import { getCategoryDefinition } from "@/lib/marketplace/categories";
import { getLocalJob } from "@/lib/marketplace/job-store";
import { getHireSetupStatus } from "@/lib/marketplace/hire-setup";
import type { Job } from "@/lib/marketplace/types";

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date pending" : date.toLocaleString();
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 border-b border-surface-border py-3 text-sm last:border-b-0"><dt className="text-muted">{label}</dt><dd className="max-w-[16rem] break-words text-right font-medium text-wrap-pretty">{value}</dd></div>;
}

export function JobDetail({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setJob(getLocalJob(jobId));
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [jobId]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-surface-border px-4 py-4 sm:px-6 sm:py-5">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Link href="/jobs" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-brand"><ArrowLeft size={16} />Back to jobs</Link>
          <Link href="/" className="inline-flex min-h-11 items-center text-sm font-semibold tracking-tight">BNB Agent Studio</Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-28 pt-10 sm:px-6 sm:pt-12 lg:pt-20">
        {!ready ? <div className="rounded-3xl border border-surface-border bg-surface px-6 py-16 text-center text-sm text-muted">Loading job</div> : !job ? <EmptyState title="Job not found in this browser" description="This page reads the local job index. An unknown job has no verified network state to show." actionLabel="Back to jobs" actionHref="/jobs" /> : <JobContent job={job} />}
      </main>
    </div>
  );
}

function JobContent({ job }: { job: Job }) {
  const category = getCategoryDefinition(job.category);
  const setup = getHireSetupStatus();
  const explorerHost = job.onchainNetwork === "BSC Testnet" ? "https://testnet.bscscan.com" : "https://bscscan.com";
  return (
    <>
      <section className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Job detail</p>
          <h1 className="mt-4 text-4xl font-semibold leading-none tracking-tight text-wrap-balance sm:text-6xl">{job.agentName ?? "Agent not connected"}</h1>
          <p className="mt-4 font-mono text-xs text-muted">{job.id}</p>
          <p className="mt-5 max-w-2xl text-lg leading-7 text-muted text-wrap-pretty">{job.taskSummary}</p>
        </div>
        <JobStatusBadge status={job.status} />
      </section>

      <section className="mt-8">
        <SetupChecklist status={setup} compact />
      </section>

      <section className="mt-12 grid gap-4 lg:grid-cols-[1fr_22rem] lg:items-start">
          <div className="rounded-3xl border border-surface-border bg-surface p-6">
            <div className="flex items-center gap-3"><FolderOpen size={22} className="text-brand" /><h2 className="text-2xl font-semibold">Job summary</h2></div>
          <dl className="mt-8"><SummaryRow label="Agent ID" value={job.agentId} /><SummaryRow label="Category" value={category?.label ?? "Category pending"} /><SummaryRow label="Created" value={formatDate(job.createdAt)} /><SummaryRow label="Budget" value={`${job.price} ${job.currency}`} /><SummaryRow label="Client" value={job.clientAddress} /><SummaryRow label="Job source" value={job.onchainJobId ? "ERC 8183 on chain" : "Local draft"} /></dl>
        </div>
        <div className="rounded-3xl border border-surface-border bg-surface p-6">
          <div className="flex items-center gap-3"><Code size={22} className="text-brand" /><h2 className="text-lg font-semibold">On chain state</h2></div>
          <dl className="mt-5"><SummaryRow label="Network" value={job.onchainNetwork ? `${job.onchainNetwork}, chain ${job.onchainChainId ?? "pending"}` : "Not submitted"} /><SummaryRow label="Job ID" value={job.onchainJobId ?? "Not created"} /><SummaryRow label="Contract" value={job.jobContractAddress ?? "Not configured"} /><SummaryRow label="Terms hash" value={job.termsHash ?? job.terms.termsHash ?? "Not created"} /></dl>
          {job.onchainJobId && job.jobContractAddress ? <a href={`${explorerHost}/address/${job.jobContractAddress}`} target="_blank" rel="noreferrer" className="mt-5 inline-flex text-sm font-semibold text-brand hover:underline">View contract on BscScan</a> : <p className="mt-5 text-sm leading-6 text-muted">No network receipt is attached to this record.</p>}
        </div>
        <AltanaPermissionPanel permission={job.permission} jobId={job.id} mode="job" />
      </section>

      <section className="mt-12 grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-surface-border bg-surface p-6">
          <div className="flex items-center gap-3"><Code size={22} className="text-brand" /><h2 className="text-2xl font-semibold">Terms</h2></div>
          <dl className="mt-8"><SummaryRow label="Protocol" value={job.onchainJobId ? "ERC 8183" : "ERC 8183 preview"} /><SummaryRow label="Task" value={job.terms.taskSummary} /><SummaryRow label="Category" value={category?.label ?? "Category pending"} /><SummaryRow label="Expiration" value={job.terms.expiresAt} /><SummaryRow label="Terms hash" value={job.termsHash ?? job.terms.termsHash ?? "Not created"} /></dl>
        </div>
        <div className="rounded-3xl border border-surface-border bg-surface p-6">
          <div className="flex items-center gap-3"><Receipt size={22} className="text-brand" /><h2 className="text-2xl font-semibold">Payment receipt</h2></div>
          <dl className="mt-8"><SummaryRow label="Protocol" value="x402" /><SummaryRow label="Status" value={job.payment?.status ?? "Not created"} /><SummaryRow label="Amount" value={job.payment ? `${job.payment.amount} ${job.payment.currency}` : `${job.price} ${job.currency}`} /><SummaryRow label="Receipt" value={job.payment?.receiptId ?? "Not created"} /><SummaryRow label="Transaction" value={job.payment?.transactionHash ?? "No transaction submitted"} /></dl>
          <p className="mt-5 text-sm leading-6 text-muted">A paid state is shown only after the configured x402 resource returns a response. A local preview is never treated as payment.</p>
        </div>
      </section>

      <section className="mt-12 rounded-3xl border border-dashed border-surface-border bg-surface p-6 sm:p-8">
        <div className="flex items-center gap-3"><LockKey size={22} className="text-brand" /><h2 className="text-2xl font-semibold">Result</h2></div>
        <p className="mt-4 text-sm leading-6 text-muted">No agent has executed this job. A future result record will include the output URI, summary, evidence, and completion timestamp.</p>
        <p className="mt-6 font-mono text-xs uppercase tracking-[0.14em] text-muted">Result pending</p>
      </section>

      <section className="mt-12" aria-labelledby="timeline-heading">
        <div className="flex items-center gap-3"><Clock size={22} className="text-brand" /><h2 id="timeline-heading" className="text-2xl font-semibold">Status timeline</h2></div>
        <div className="mt-8 space-y-3">
          {job.statusHistory.map((entry) => <div key={`${entry.status}-${entry.changedAt}`} className="flex items-start gap-4 rounded-2xl border border-surface-border bg-surface p-4"><CheckCircle size={18} className="mt-0.5 shrink-0 text-brand" /><div className="min-w-0"><div className="flex flex-wrap items-center gap-3"><JobStatusBadge status={entry.status} /><span className="font-mono text-xs text-muted">{formatDate(entry.changedAt)}</span></div><p className="mt-2 break-words text-sm text-muted">{entry.note ?? "Status recorded locally"}</p></div></div>)}
        </div>
      </section>
    </>
  );
}
