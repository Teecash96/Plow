"use client";

import { Clock, FolderOpen, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/marketplace/empty-state";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { SetupChecklist } from "@/components/hire/setup-checklist";
import { getCategoryDefinition } from "@/lib/marketplace/categories";
import { readJobs } from "@/lib/marketplace/job-store";
import { getHireSetupStatus } from "@/lib/marketplace/hire-setup";
import type { Job } from "@/lib/marketplace/types";

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date pending" : date.toLocaleString();
}

export function JobsBrowser() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [ready, setReady] = useState(false);
  const setup = getHireSetupStatus();

  useEffect(() => {
    const refresh = () => {
      setJobs(readJobs());
      setReady(true);
    };
    refresh();
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-surface-border px-4 py-4 sm:px-6 sm:py-5">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3 text-sm font-semibold tracking-tight"><span className="flex size-8 items-center justify-center rounded-full bg-brand text-black">P</span>BNB Agent Studio</Link>
          <Link href="/agents" className="inline-flex min-h-11 items-center text-sm text-muted transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-brand">Browse agents</Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-28 pt-10 sm:px-6 sm:pt-12 lg:pt-20">
        <section className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Jobs</p>
            <h1 className="mt-4 text-4xl font-semibold leading-none tracking-tight text-wrap-balance sm:text-6xl">Keep every job in view</h1>
            <p className="mt-6 max-w-2xl text-lg leading-7 text-muted text-wrap-pretty">Local drafts and on chain jobs share one record. Payment receipts and status changes appear only after a wallet or network response proves them.</p>
          </div>
          <Link href="/agents" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-brand px-4 py-2 text-base font-semibold text-black transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#ffd34f] active:translate-y-px focus:outline-none focus:ring-2 focus:ring-brand"><Plus size={18} weight="bold" /> Start from an agent</Link>
        </section>

        <section className="mt-10">
          <SetupChecklist status={setup} compact />
        </section>

        <section className="mt-12" aria-live="polite">
          {!ready ? (
            <div className="rounded-3xl border border-surface-border bg-surface px-6 py-16 text-center text-sm text-muted">Loading local jobs</div>
          ) : jobs.length === 0 ? (
            <EmptyState title="No jobs yet" description="Jobs appear here after you save a local draft or submit an on chain hire. No result is shown until a real agent execution is recorded." actionLabel="Browse agents" actionHref="/agents" />
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => {
                const category = getCategoryDefinition(job.category);
                return (
                  <Link key={job.id} href={`/jobs/${job.id}`} className="group grid gap-4 rounded-3xl border border-surface-border bg-surface p-5 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:border-[#6a6a6a] hover:bg-surface-raised md:grid-cols-[1fr_auto_auto_auto] md:items-center">
                    <div className="flex items-start gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-black text-brand"><FolderOpen size={20} /></span>
                      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="break-words text-base font-semibold">{job.agentName ?? "Agent not connected"}</p><span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${job.onchainJobId ? "border-[#5a9876] bg-[#14281f] text-positive" : "border-surface-border text-muted"}`}>{job.onchainJobId ? "On chain" : "Local draft"}</span></div><p className="mt-1 break-all font-mono text-xs text-muted">{job.onchainJobId ?? job.id}</p><p className="mt-2 max-w-xl break-words text-sm text-muted">{job.taskSummary}</p></div>
                    </div>
                    <div><p className="text-xs text-muted">Category</p><p className="mt-1 text-sm font-semibold">{category?.label ?? "Category pending"}</p></div>
                    <div><p className="text-xs text-muted">Created</p><p className="mt-1 inline-flex items-center gap-1.5 text-sm"><Clock size={14} className="text-muted" />{formatDate(job.createdAt)}</p></div>
                    <div className="flex items-center justify-between gap-4 md:flex-col md:items-end"><JobStatusBadge status={job.status} /><div className="text-right"><p className="font-mono text-sm">{job.price} {job.currency}</p><p className="mt-1 text-xs text-muted">Payment {job.payment?.status ?? "not created"}</p></div></div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="mt-12 rounded-3xl border border-dashed border-surface-border bg-surface p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Permission management</p>
          <h2 className="mt-4 text-2xl font-semibold">Session key controls live in job detail</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">Open a job to review its Altana spend cap, contract and token allowlists, expiration, and local revoke intent. No session key or on chain revoke transaction is created by this UI yet.</p>
        </section>
      </main>
    </div>
  );
}
