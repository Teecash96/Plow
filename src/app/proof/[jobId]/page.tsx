import { ArrowLeft, ArrowSquareOut, CheckCircle, Clock, Pulse, WarningCircle } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCategoryDefinition } from "@/lib/marketplace/categories";
import { getPublicJobProof } from "@/lib/marketplace/job-database";
import type { JobProofEventState } from "@/lib/marketplace/job-proof";

interface PublicProofPageProps {
  params: Promise<{ jobId: string }>;
}

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date pending" : date.toLocaleString();
}

const stateLabels: Record<JobProofEventState, string> = {
  verified: "Verified",
  simulated: "Simulation",
  pending: "Pending",
  failed: "Needs attention",
};

const stateStyles: Record<JobProofEventState, string> = {
  verified: "border-[#5a9876] bg-[#14281f] text-positive",
  simulated: "border-[#9a843c] bg-[#211d0d] text-[#e8d995]",
  pending: "border-surface-border bg-surface-raised text-muted",
  failed: "border-[#ad6565] bg-[#281313] text-negative",
};

function EventIcon({ state }: { state: JobProofEventState }) {
  if (state === "verified") return <CheckCircle size={19} weight="fill" className="mt-0.5 shrink-0 text-positive" />;
  if (state === "failed") return <WarningCircle size={19} weight="fill" className="mt-0.5 shrink-0 text-negative" />;
  return <Clock size={19} className="mt-0.5 shrink-0 text-muted" />;
}

export async function generateMetadata({ params }: PublicProofPageProps): Promise<Metadata> {
  const { jobId } = await params;
  const proof = await getPublicJobProof(jobId);
  return {
    title: proof ? `${proof.agentName ?? "Agent"} execution proof | BNB Agent Studio` : "Execution proof | BNB Agent Studio",
    description: "A public, user-approved record of a Plow agent execution and its on chain proof.",
  };
}

export default async function PublicProofPage({ params }: PublicProofPageProps) {
  const { jobId } = await params;
  const proof = await getPublicJobProof(jobId);
  if (!proof) notFound();

  const category = getCategoryDefinition(proof.category as Parameters<typeof getCategoryDefinition>[0]);
  const explorerHost = proof.onchainNetwork === "BSC Testnet" ? "https://testnet.bscscan.com" : "https://bscscan.com";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-surface-border px-4 py-4 sm:px-6 sm:py-5">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-brand"><ArrowLeft size={16} />BNB Agent Studio</Link>
          <span className="inline-flex items-center gap-2 text-xs text-muted"><Pulse size={15} className="text-brand" />Public proof</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-12 sm:px-6 sm:pt-16 lg:pt-24">
        <section>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Verified execution record</p>
          <div className="mt-4 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <h1 className="break-words text-4xl font-semibold leading-none tracking-tight text-wrap-balance sm:text-6xl">{proof.agentName ?? "Plow agent"}</h1>
              <p className="mt-4 break-all font-mono text-xs text-muted">Public job proof · {proof.id}</p>
            </div>
            <span className="inline-flex w-fit rounded-full border border-[#5a9876] bg-[#14281f] px-3 py-1.5 text-xs font-semibold text-positive">User approved</span>
          </div>
          <p className="mt-6 max-w-3xl text-lg leading-7 text-muted">This page was explicitly published by the job owner. It excludes the client wallet address and shows the task, result, identity, payment reference, and escrow transactions needed to verify the run.</p>
        </section>

        <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Public proof summary">
          <div className="rounded-2xl border border-surface-border bg-surface p-4"><p className="text-xs text-muted">Category</p><p className="mt-3 text-sm font-semibold">{category?.label ?? proof.category}</p></div>
          <div className="rounded-2xl border border-surface-border bg-surface p-4"><p className="text-xs text-muted">Network</p><p className="mt-3 text-sm font-semibold">{proof.onchainNetwork ?? "BSC Mainnet"} · {proof.onchainChainId ?? 56}</p></div>
          <div className="rounded-2xl border border-surface-border bg-surface p-4"><p className="text-xs text-muted">On chain job</p><p className="mt-3 break-all font-mono text-sm font-semibold">{proof.onchainJobId}</p></div>
          <div className="rounded-2xl border border-surface-border bg-surface p-4"><p className="text-xs text-muted">Payment</p><p className="mt-3 text-sm font-semibold">{proof.price} {proof.currency}</p></div>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <article className="rounded-3xl border border-surface-border bg-surface p-6">
            <h2 className="text-2xl font-semibold">Task submitted</h2>
            <p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-muted">{proof.taskSummary}</p>
            <dl className="mt-6 border-t border-surface-border pt-4 text-sm">
              <div className="flex items-start justify-between gap-4 border-b border-surface-border py-3"><dt className="text-muted">Agent ID</dt><dd className="break-all text-right font-mono">{proof.agentIdentityId ?? proof.agentId}</dd></div>
              <div className="flex items-start justify-between gap-4 py-3"><dt className="text-muted">Terms hash</dt><dd className="max-w-[16rem] break-all text-right font-mono text-xs">{proof.termsHash ?? "Not recorded"}</dd></div>
            </dl>
          </article>
          <article className="rounded-3xl border border-[#5a9876] bg-[#14281f] p-6">
            <h2 className="text-2xl font-semibold text-positive">Result returned</h2>
            <p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-positive">{proof.resultSummary}</p>
            <p className="mt-6 border-t border-[#5a9876]/40 pt-4 text-xs text-positive/80">Completed {proof.executionCompletedAt ? formatDate(proof.executionCompletedAt) : formatDate(proof.updatedAt)}</p>
          </article>
        </section>

        <section className="mt-10 rounded-3xl border border-surface-border bg-surface p-6 sm:p-8" aria-labelledby="public-proof-events">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">On chain evidence</p>
              <h2 id="public-proof-events" className="mt-3 text-2xl font-semibold">Payment, execution, and settlement trail</h2>
            </div>
            {proof.jobContractAddress ? <a href={`${explorerHost}/address/${proof.jobContractAddress}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand">Open escrow contract <ArrowSquareOut size={15} /></a> : null}
          </div>
          <ol className="mt-6 space-y-3" aria-label="Public proof events">
            {proof.events.map((event) => (
              <li key={event.id} className="flex items-start gap-4 rounded-2xl border border-surface-border bg-black/30 p-4">
                <EventIcon state={event.state} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3"><p className="text-sm font-semibold">{event.label}</p><span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${stateStyles[event.state]}`}>{stateLabels[event.state]}</span><span className="font-mono text-xs text-muted">{formatDate(event.occurredAt)}</span></div>
                  <p className="mt-2 text-sm leading-6 text-muted">{event.detail}</p>
                  {event.transactionHash && event.explorerUrl ? <a href={event.explorerUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 break-all font-mono text-xs font-semibold text-brand hover:underline">{event.transactionHash}<ArrowSquareOut size={14} /></a> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
