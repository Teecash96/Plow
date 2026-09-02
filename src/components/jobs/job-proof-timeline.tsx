"use client";

import { ArrowSquareOut, CheckCircle, Clock, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { getJobProofEvents, type JobProofEventState } from "@/lib/marketplace/job-proof";
import type { Job } from "@/lib/marketplace/types";

const STATE_LABELS: Record<JobProofEventState, string> = {
  verified: "Verified",
  simulated: "Simulation",
  pending: "Pending",
  failed: "Needs attention",
};

const STATE_STYLES: Record<JobProofEventState, string> = {
  verified: "border-[#5a9876] bg-[#14281f] text-positive",
  simulated: "border-[#9a843c] bg-[#211d0d] text-[#e8d995]",
  pending: "border-surface-border bg-surface-raised text-muted",
  failed: "border-[#ad6565] bg-[#281313] text-negative",
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date pending" : date.toLocaleString();
}

function StateIcon({ state }: { state: JobProofEventState }) {
  if (state === "verified") return <CheckCircle size={19} weight="fill" className="mt-0.5 shrink-0 text-positive" />;
  if (state === "simulated") return <ShieldCheck size={19} weight="fill" className="mt-0.5 shrink-0 text-[#e8d995]" />;
  if (state === "failed") return <WarningCircle size={19} weight="fill" className="mt-0.5 shrink-0 text-negative" />;
  return <Clock size={19} className="mt-0.5 shrink-0 text-muted" />;
}

export function JobProofTimeline({ job }: { job: Job }) {
  const simulation = job.mode === "simulation" || Boolean(job.simulation);
  const events = getJobProofEvents(job);

  return (
    <section className="mt-12 rounded-3xl border border-surface-border bg-surface p-6 sm:p-8" aria-labelledby="proof-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Proof layer</p>
          <h2 id="proof-heading" className="mt-3 text-2xl font-semibold">Execution proof</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">Each step is separated from the next. Live steps can carry a verified transaction link. Simulation steps never claim that a wallet or chain call happened.</p>
        </div>
        <span className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${simulation ? STATE_STYLES.simulated : STATE_STYLES.verified}`}>
          {simulation ? "Simulation only" : "Live record"}
        </span>
      </div>

      {simulation ? (
        <div className="mt-6 rounded-2xl border border-[#9a843c] bg-[#211d0d] px-4 py-3 text-sm leading-6 text-[#e8d995]" role="note">
          No wallet request, payment token transfer, database write, provider call, or blockchain transaction was made. This record exists in this browser only.
        </div>
      ) : null}

      {events.length > 0 ? (
        <ol className="mt-6 space-y-3" aria-label="Execution proof steps">
          {events.map((event) => <ProofEvent key={event.id} event={event} />)}
        </ol>
      ) : (
        <p className="mt-6 rounded-2xl border border-surface-border bg-black px-4 py-5 text-sm text-muted">No proof events are recorded yet.</p>
      )}
    </section>
  );
}

function ProofEvent({ event }: { event: ReturnType<typeof getJobProofEvents>[number] }) {
  return (
    <li className="flex items-start gap-4 rounded-2xl border border-surface-border bg-black/30 p-4">
      <StateIcon state={event.state} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-semibold">{event.label}</p>
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${STATE_STYLES[event.state]}`}>{STATE_LABELS[event.state]}</span>
          <span className="font-mono text-xs text-muted">{formatDate(event.occurredAt)}</span>
        </div>
        <p className="mt-2 break-words text-sm leading-6 text-muted">{event.detail}</p>
        {event.transactionHash && event.explorerUrl ? (
          <a href={event.explorerUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 font-mono text-xs font-semibold text-brand hover:underline" aria-label={`Open ${event.label} transaction`}>
            {`${event.transactionHash.slice(0, 10)}…${event.transactionHash.slice(-8)}`}
            <ArrowSquareOut size={14} />
          </a>
        ) : null}
      </div>
    </li>
  );
}
