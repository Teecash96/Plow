"use client";

import { ArrowClockwise, ArrowLeft, CheckCircle, Clock, Code, FolderOpen, LockKey, Play, Receipt, SpinnerGap, Star, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  claimERC8183Refund,
  connectBscWallet,
  disputeERC8183Job,
  settleERC8183Job,
  verifyERC8183Deployment,
} from "@/lib/chain/erc8183-adapter";
import { EmptyState } from "@/components/marketplace/empty-state";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { JobProofTimeline } from "@/components/jobs/job-proof-timeline";
import { SetupChecklist } from "@/components/hire/setup-checklist";
import { AltanaPermissionPanel } from "@/components/partners/altana-permission-panel";
import { PancakeSwapRebalanceAction } from "@/components/partners/pancakeswap-rebalance-action";
import { getCategoryDefinition } from "@/lib/marketplace/categories";
import { getHireResumeMode } from "@/lib/marketplace/hire-resume";
import { evaluateRemoteJob, getRemoteJob, JobPersistenceUnavailableError, recoverRemoteFunding, reconcileRemoteJob, submitRemoteJobReview, updateRemoteJob } from "@/lib/marketplace/job-api";
import { getLocalJob, updateLocalJob } from "@/lib/marketplace/job-store";
import { getHireSetupStatus } from "@/lib/marketplace/hire-setup";
import { evaluatorRefreshDelay, type JobEvaluatorResult } from "@/lib/marketplace/evaluator";
import type { Job } from "@/lib/marketplace/types";

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date pending" : date.toLocaleString();
}

function formatRemaining(value: string, now: number) {
  const target = Date.parse(value);
  if (!Number.isFinite(target) || now <= 0) return "an unknown time";
  const totalSeconds = Math.max(0, Math.ceil((target - now) / 1_000));
  if (totalSeconds === 0) return "now";
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 border-b border-surface-border py-3 text-sm last:border-b-0"><dt className="text-muted">{label}</dt><dd className="max-w-[16rem] break-words text-right font-medium text-wrap-pretty">{value}</dd></div>;
}

export function JobDetail({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job>();
  const [ready, setReady] = useState(false);
  const [loadedJobId, setLoadedJobId] = useState<string>();
  const [storageNotice, setStorageNotice] = useState<string>();
  const [executionBusy, setExecutionBusy] = useState(false);
  const [executionError, setExecutionError] = useState<string>();
  const [fundingRecoveryBusy, setFundingRecoveryBusy] = useState(false);
  const [fundingRecoveryError, setFundingRecoveryError] = useState<string>();
  const [lifecycleBusy, setLifecycleBusy] = useState<string>();
  const [lifecycleError, setLifecycleError] = useState<string>();
  const [evaluation, setEvaluation] = useState<JobEvaluatorResult>();
  const [evaluationBusy, setEvaluationBusy] = useState(false);
  const [evaluationError, setEvaluationError] = useState<string>();
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string>();
  const [publicProofBusy, setPublicProofBusy] = useState(false);
  const [publicProofError, setPublicProofError] = useState<string>();
  const evaluationRequestId = useRef(0);

  const loadEvaluator = useCallback(async (targetJobId: string) => {
    const requestId = evaluationRequestId.current + 1;
    evaluationRequestId.current = requestId;
    setEvaluationBusy(true);
    setEvaluationError(undefined);
    try {
      const response = await evaluateRemoteJob(targetJobId);
      if (evaluationRequestId.current === requestId) {
        setEvaluation(response.evaluation);
        if (response.job) setJob(response.job);
      }
      return response.evaluation;
    } catch (error) {
      if (evaluationRequestId.current === requestId) {
        const message = error instanceof Error ? error.message : "The evaluator status could not be checked.";
        setEvaluationError(message);
      }
      throw error;
    } finally {
      if (evaluationRequestId.current === requestId) setEvaluationBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      evaluationRequestId.current += 1;
      setEvaluation(undefined);
      setEvaluationError(undefined);
      try {
        const remoteJob = await getRemoteJob(jobId);
        if (!active) return;
        setJob(remoteJob ?? getLocalJob(jobId));
        setStorageNotice(undefined);
        setLoadedJobId(jobId);
      } catch (error) {
        if (!active) return;
        setJob(getLocalJob(jobId));
        setStorageNotice(error instanceof JobPersistenceUnavailableError ? "Server persistence is unavailable. This is the local fallback record." : "The saved jobs service is unavailable. This is the local fallback record.");
        setLoadedJobId(jobId);
      }
      setReady(true);
    };
    void load();
    return () => { active = false; };
  }, [jobId]);

  useEffect(() => {
    const evaluationJobId = job?.status === "submitted" && job.escrow?.status === "submitted" ? job.id : undefined;
    if (!evaluationJobId) return;
    const timer = window.setTimeout(() => {
      void loadEvaluator(evaluationJobId).catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [job?.id, job?.status, job?.escrow?.status, loadEvaluator]);

  useEffect(() => {
    const evaluationJobId = job?.status === "submitted" && job.escrow?.status === "submitted" ? job.id : undefined;
    if (!evaluationJobId || !evaluation || evaluation.ready || evaluation.decision !== "pending") return;
    const delay = evaluatorRefreshDelay(evaluation.settleAt);
    if (delay === undefined) return;
    const timer = window.setTimeout(() => {
      void loadEvaluator(evaluationJobId).catch(() => undefined);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [evaluation, job?.id, job?.status, job?.escrow?.status, loadEvaluator]);

  async function recoverFunding() {
    const pendingFundingHash = job?.escrow?.pendingFundingTransactionHash;
    if (!job || !pendingFundingHash || fundingRecoveryBusy) return;
    setFundingRecoveryBusy(true);
    setFundingRecoveryError(undefined);
    try {
      const recovered = await recoverRemoteFunding(job.id, pendingFundingHash);
      updateLocalJob(job.id, recovered);
      setJob(recovered);
    } catch (error) {
      setFundingRecoveryError(error instanceof Error ? error.message : "The stale funding broadcast could not be recovered.");
    } finally {
      setFundingRecoveryBusy(false);
    }
  }

  async function executeJob() {
    if (!job || executionBusy) return;
    setExecutionBusy(true);
    setExecutionError(undefined);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/execute`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
      });
      const body = await response.json().catch(() => ({})) as { error?: unknown; job?: unknown };
      if (body.job && typeof body.job === "object") setJob(body.job as Job);
      if (!response.ok) {
        throw new Error(typeof body.error === "string" ? body.error : `Agent execution failed with status ${response.status}.`);
      }
      if (!body.job || typeof body.job !== "object") throw new Error("The execution service returned no job record.");
    } catch (error) {
      setExecutionError(error instanceof Error ? error.message : "The agent execution failed.");
    } finally {
      setExecutionBusy(false);
    }
  }

  async function submitReview(score: number, comment: string) {
    if (!job || reviewBusy) return;
    setReviewBusy(true);
    setReviewError(undefined);
    try {
      const reviewedJob = await submitRemoteJobReview(job.id, score, comment);
      updateLocalJob(job.id, reviewedJob);
      setJob(reviewedJob);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "The review could not be saved.");
    } finally {
      setReviewBusy(false);
    }
  }

  async function togglePublicProof() {
    if (!job || publicProofBusy) return;
    setPublicProofBusy(true);
    setPublicProofError(undefined);
    try {
      const updated = await updateRemoteJob(job.id, { publicProof: !job.publicProof });
      updateLocalJob(job.id, updated);
      setJob(updated);
    } catch (error) {
      setPublicProofError(error instanceof Error ? error.message : "The public proof setting could not be updated.");
    } finally {
      setPublicProofBusy(false);
    }
  }

  async function runLifecycleAction(action: "dispute" | "settle" | "refund") {
    if (!job || lifecycleBusy || !job.onchainJobId || !job.permission) return;
    setLifecycleBusy(action);
    setLifecycleError(undefined);
    try {
      const settlementEvaluation = action === "settle" ? await loadEvaluator(job.id) : undefined;
      if (action === "settle" && settlementEvaluation && !settlementEvaluation.ready) {
        throw new Error(settlementEvaluation.message);
      }
      const wallet = await connectBscWallet();
      await verifyERC8183Deployment(wallet.publicClient);
      if (action === "dispute" && wallet.account.toLowerCase() !== job.clientAddress.toLowerCase()) {
        throw new Error("Connect the wallet that created this job before disputing it.");
      }
      const input = {
        walletClient: wallet.walletClient,
        publicClient: wallet.publicClient,
        account: wallet.account,
        jobId: BigInt(job.onchainJobId),
        permission: job.permission,
      };
      const result = action === "dispute"
        ? await disputeERC8183Job(input)
        : action === "settle"
          ? await settleERC8183Job({ ...input, evidence: settlementEvaluation?.evidence })
          : await claimERC8183Refund(input);
      const reconciled = await reconcileRemoteJob(job.id, {
        transactionHash: result.transactionHash,
        transactionEvent: action === "refund" ? "refund" : action,
      });
      updateLocalJob(job.id, {
        status: reconciled.status,
        escrow: reconciled.escrow,
        statusHistory: reconciled.statusHistory,
      });
      setJob(reconciled);
    } catch (error) {
      setLifecycleError(error instanceof Error ? error.message : "The escrow action failed.");
    } finally {
      setLifecycleBusy(undefined);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-surface-border px-4 py-4 sm:px-6 sm:py-5">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Link href="/jobs" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-brand"><ArrowLeft size={16} />Back to jobs</Link>
          <Link href="/" className="inline-flex min-h-11 items-center text-sm font-semibold tracking-tight">BNB Agent Studio</Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-28 pt-10 sm:px-6 sm:pt-12 lg:pt-20">
        {!(ready && loadedJobId === jobId) ? <div className="rounded-3xl border border-surface-border bg-surface px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Loading job</h1><p className="mt-2 text-sm text-muted">Checking the saved job record.</p></div> : !job ? <EmptyState title="Job not found" description="No matching server record or local draft is available for this job ID." actionLabel="Back to jobs" actionHref="/jobs" /> : <JobContent job={job} onJobChange={setJob} onExecute={executeJob} executionBusy={executionBusy} executionError={executionError} onRecoverFunding={recoverFunding} fundingRecoveryBusy={fundingRecoveryBusy} fundingRecoveryError={fundingRecoveryError} onLifecycleAction={runLifecycleAction} lifecycleBusy={lifecycleBusy} lifecycleError={lifecycleError} evaluation={evaluation} evaluationBusy={evaluationBusy} evaluationError={evaluationError} onRefreshEvaluation={() => { if (job) void loadEvaluator(job.id).catch(() => undefined); }} onReviewSubmit={submitReview} reviewBusy={reviewBusy} reviewError={reviewError} onTogglePublicProof={togglePublicProof} publicProofBusy={publicProofBusy} publicProofError={publicProofError} />}
        {storageNotice ? <p className="mt-4 text-sm leading-6 text-warning">{storageNotice}</p> : null}
      </main>
    </div>
  );
}

function JobContent({ job, onJobChange, onExecute, executionBusy, executionError, onRecoverFunding, fundingRecoveryBusy, fundingRecoveryError, onLifecycleAction, lifecycleBusy, lifecycleError, evaluation, evaluationBusy, evaluationError, onRefreshEvaluation, onReviewSubmit, reviewBusy, reviewError, onTogglePublicProof, publicProofBusy, publicProofError }: { job: Job; onJobChange: (job: Job) => void; onExecute: () => void; executionBusy: boolean; executionError?: string; onRecoverFunding: () => void; fundingRecoveryBusy: boolean; fundingRecoveryError?: string; onLifecycleAction: (action: "dispute" | "settle" | "refund") => void; lifecycleBusy?: string; lifecycleError?: string; evaluation?: JobEvaluatorResult; evaluationBusy: boolean; evaluationError?: string; onRefreshEvaluation: () => void; onReviewSubmit: (score: number, comment: string) => void; reviewBusy: boolean; reviewError?: string; onTogglePublicProof: () => void; publicProofBusy: boolean; publicProofError?: string }) {
  const [currentTime, setCurrentTime] = useState(0);
  const [reviewScore, setReviewScore] = useState<number>();
  const [reviewComment, setReviewComment] = useState("");
  const category = getCategoryDefinition(job.category);
  const setup = getHireSetupStatus();
  const explorerHost = job.onchainNetwork === "BSC Testnet" ? "https://testnet.bscscan.com" : "https://bscscan.com";
  const execution = job.execution;
  useEffect(() => {
    const refresh = () => setCurrentTime(Date.now());
    refresh();
    const interval = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(interval);
  }, [job.escrow?.expiresAt]);
  const canExecute = Boolean(job.onchainJobId)
    && job.payment?.status === "paid"
    && (job.status === "active" || job.status === "failed")
    && execution?.status !== "running"
    && execution?.status !== "completed";
  const canRate = job.mode !== "simulation"
    && Boolean(job.onchainJobId)
    && job.payment?.status === "paid"
    && execution?.status === "completed";
  const canReview = job.status === "submitted" && job.escrow?.status === "submitted";
  const settlementReady = evaluation?.ready === true;
  const settlementWaiting = canReview && evaluation?.decision === "pending";
  const canRefund = (job.status === "active" || job.status === "submitted")
    && Boolean(job.escrow?.expiresAt)
    && currentTime > 0
    && Date.parse(job.escrow?.expiresAt ?? "") <= currentTime;
  const canResume = job.mode !== "simulation"
    && Boolean(getHireResumeMode(job));
  const canPublishProof = job.mode !== "simulation"
    && Boolean(job.onchainJobId)
    && job.payment?.status === "paid"
    && job.execution?.status === "completed"
    && Boolean(job.resultSummary)
    && job.status === "completed"
    && job.escrow?.status === "completed"
    && Boolean(job.escrow.settlementTransactionHash);
  const pendingFundingHash = job.escrow?.pendingFundingTransactionHash;
  return (
    <>
      <section className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Job detail</p>
          <h1 className="mt-4 text-4xl font-semibold leading-none tracking-tight text-wrap-balance sm:text-6xl">{job.agentName ?? "Agent not connected"}</h1>
          <p className="mt-4 font-mono text-xs text-muted">{job.id}</p>
          <p className="mt-5 max-w-2xl text-lg leading-7 text-muted text-wrap-pretty">{job.taskSummary}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <JobStatusBadge status={job.status} />
          {canResume ? <Link href={`/hire/${encodeURIComponent(job.agentId)}?resumeJobId=${encodeURIComponent(job.id)}`} className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-black hover:bg-[#ffd34f]">Continue hire</Link> : null}
        </div>
      </section>

      {job.mode === "simulation" ? (
        <section className="mt-8 rounded-3xl border border-[#9a843c] bg-[#211d0d] p-5" role="note">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#e8d995]">Simulation only</p>
          <p className="mt-3 text-sm leading-6 text-[#e8d995]">This job is a local sandbox record. It does not represent a wallet approval, payment token transfer, database write, provider call, or blockchain transaction.</p>
        </section>
      ) : (
        <section className="mt-8">
          <SetupChecklist status={setup} compact />
        </section>
      )}

      {pendingFundingHash ? <section className="mt-8 rounded-3xl border border-[#ad6565] bg-[#281313] p-5" role="alert">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#f0b4b4]">Funding needs verification</p>
        <p className="mt-3 text-sm leading-6 text-[#f0b4b4]">A funding transaction was broadcast, but its receipt is not confirmed. Do not approve another funding transaction until the old hash is checked.</p>
        {job.onchainNetwork ? <a href={`${explorerHost}/tx/${pendingFundingHash}`} target="_blank" rel="noreferrer" className="mt-3 inline-flex break-all font-mono text-xs font-semibold text-brand hover:underline">{pendingFundingHash}</a> : null}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={onRecoverFunding} disabled={fundingRecoveryBusy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[#f0b4b4] px-4 py-2 text-sm font-semibold text-[#f0b4b4] hover:bg-[#3a1c1c] disabled:cursor-not-allowed disabled:opacity-50">{fundingRecoveryBusy ? <SpinnerGap size={17} className="animate-spin" /> : <ArrowClockwise size={17} />}{fundingRecoveryBusy ? "Checking old hash" : "Check hash and unlock retry"}</button>
          <p className="text-xs leading-5 text-[#f0b4b4]">No wallet transaction is sent. The server checks the old hash and the open escrow first.</p>
        </div>
        {fundingRecoveryError ? <p className="mt-3 text-sm leading-6 text-[#f0b4b4]" role="alert">{fundingRecoveryError}</p> : null}
      </section> : null}

      <section className="mt-12 grid gap-4 lg:grid-cols-[1fr_22rem] lg:items-start">
          <div className="rounded-3xl border border-surface-border bg-surface p-6">
            <div className="flex items-center gap-3"><FolderOpen size={22} className="text-brand" /><h2 className="text-2xl font-semibold">Job summary</h2></div>
          <dl className="mt-8"><SummaryRow label="Agent ID" value={job.agentId} /><SummaryRow label="Category" value={category?.label ?? "Category pending"} /><SummaryRow label="Created" value={formatDate(job.createdAt)} /><SummaryRow label="Budget" value={`${job.price} ${job.currency}`} /><SummaryRow label="Client" value={job.clientAddress} /><SummaryRow label="Job source" value={job.mode === "simulation" ? "Sandbox simulation" : job.onchainJobId ? "ERC 8183 on chain" : "Local draft"} /></dl>
        </div>
        <div className="rounded-3xl border border-surface-border bg-surface p-6">
          <div className="flex items-center gap-3"><Code size={22} className="text-brand" /><h2 className="text-lg font-semibold">On chain state</h2></div>
          <dl className="mt-5"><SummaryRow label="Network" value={job.mode === "simulation" ? `${job.simulation?.network ?? "BSC Mainnet"}, simulated locally` : job.onchainNetwork ? `${job.onchainNetwork}, chain ${job.onchainChainId ?? "pending"}` : "Not submitted"} /><SummaryRow label="Job ID" value={job.onchainJobId ?? (job.mode === "simulation" ? "Not created" : "Not created")} /><SummaryRow label="Contract" value={job.jobContractAddress ?? "Not configured"} /><SummaryRow label="Terms hash" value={job.termsHash ?? job.terms.termsHash ?? "Not created"} /><SummaryRow label="Escrow" value={job.mode === "simulation" ? "Simulation only" : job.escrow?.status ?? "Not reconciled"} /><SummaryRow label="Deliverable" value={job.escrow?.deliverableHash ?? "Not submitted"} /></dl>
          {job.onchainJobId && job.jobContractAddress ? <a href={`${explorerHost}/address/${job.jobContractAddress}`} target="_blank" rel="noreferrer" className="mt-5 inline-flex text-sm font-semibold text-brand hover:underline">View contract on BscScan</a> : <p className="mt-5 text-sm leading-6 text-muted">No network receipt is attached to this record.</p>}
        </div>
        <AltanaPermissionPanel permission={job.permission} jobId={job.id} mode="job" />
      </section>

      {job.category === "rebalancing" && job.mode !== "simulation" ? <PancakeSwapRebalanceAction job={job} onJobChange={onJobChange} /> : null}

      <JobProofTimeline job={job} />

      {job.mode !== "simulation" ? <section className="mt-12 rounded-3xl border border-surface-border bg-surface p-6 sm:p-8" aria-labelledby="public-proof-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Public evidence</p>
            <h2 id="public-proof-heading" className="mt-3 text-2xl font-semibold">Share one complete run</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">Publish this record only after a paid on chain execution is settled. The public page includes the task, result, identity, payment reference, and escrow transactions. It excludes the client wallet address.</p>
          </div>
          <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${job.publicProof ? "border-[#5a9876] bg-[#14281f] text-positive" : "border-surface-border bg-black text-muted"}`}>{job.publicProof ? "Public" : "Private"}</span>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {job.publicProof ? <>
            <Link href={`/proof/${encodeURIComponent(job.id)}`} target="_blank" className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-black hover:bg-[#ffd34f] focus:outline-none focus:ring-2 focus:ring-brand">Open public proof</Link>
            <button type="button" onClick={onTogglePublicProof} disabled={publicProofBusy} className="inline-flex min-h-11 items-center justify-center rounded-full border border-surface-border px-4 py-2 text-sm font-semibold text-muted hover:border-[#6a6a6a] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand">{publicProofBusy ? "Updating" : "Make private"}</button>
          </> : <button type="button" onClick={onTogglePublicProof} disabled={!canPublishProof || publicProofBusy} title={!canPublishProof ? "Complete a paid on chain execution before publishing proof" : undefined} className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-black hover:bg-[#ffd34f] disabled:cursor-not-allowed disabled:bg-[#5a5230] disabled:text-[#b9ae7b] focus:outline-none focus:ring-2 focus:ring-brand">{publicProofBusy ? "Publishing" : "Publish public proof"}</button>}
          <p className="text-xs leading-5 text-muted">{canPublishProof ? "You control this sharing decision." : "Available after payment, execution, result submission, and settlement are verified."}</p>
        </div>
        {publicProofError ? <p className="mt-4 text-sm leading-6 text-warning" role="alert">{publicProofError}</p> : null}
      </section> : null}

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
        <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><LockKey size={22} className="text-brand" /><h2 className="text-2xl font-semibold">Result</h2></div>{canExecute ? <button type="button" onClick={onExecute} disabled={executionBusy} aria-busy={executionBusy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-[#ffd34f] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand">{executionBusy ? <SpinnerGap size={17} className="animate-spin" /> : execution?.status === "failed" ? <ArrowClockwise size={17} /> : <Play size={17} weight="fill" />}{executionBusy ? "Running agent" : execution?.status === "failed" ? "Retry agent" : "Run agent"}</button> : null}</div>
        {execution?.status === "running" ? <p className="mt-4 text-sm leading-6 text-muted" aria-live="polite">The agent is working on this job. Refresh this page when it returns a result.</p> : execution?.status === "failed" ? <p className="mt-4 text-sm leading-6 text-warning">The agent did not return a result. {execution.error ?? "You can retry the execution."}</p> : job.resultSummary ? <div className="mt-4 rounded-2xl border border-[#5a9876] bg-[#14281f] p-4"><p className="text-sm leading-6 text-positive">{job.resultSummary}</p>{job.resultUri ? <a href={job.resultUri} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-semibold text-brand hover:underline">Open result evidence</a> : null}</div> : <p className="mt-4 text-sm leading-6 text-muted">The agent can run after the job is active and funded. Its response will appear here.</p>}
        {executionError ? <div className="mt-4 flex items-start gap-2 rounded-2xl border border-[#ad6565] bg-[#281313] px-4 py-3 text-sm leading-6 text-[#f0b4b4]" role="alert"><WarningCircle size={18} className="mt-1 shrink-0" />{executionError}</div> : null}
        {execution?.status === "completed" && !job.resultSummary ? <p className="mt-4 text-sm leading-6 text-warning">The agent marked the job complete, but no result summary was stored.</p> : null}
      </section>

      <section className="mt-12 rounded-3xl border border-surface-border bg-surface p-6 sm:p-8" aria-labelledby="rating-heading">
        <div className="flex items-center gap-3"><Star size={22} className="text-brand" /><h2 id="rating-heading" className="text-2xl font-semibold">Rate this agent</h2></div>
        {job.review ? (
          <div className="mt-5 rounded-2xl border border-[#5a9876] bg-[#14281f] p-4">
            <p className="text-sm font-semibold text-positive">Your rating: {job.review.score} / 5</p>
            {job.review.comment ? <p className="mt-2 text-sm leading-6 text-positive">{job.review.comment}</p> : null}
            <p className="mt-3 text-xs text-positive/80">Saved with job {job.id}.</p>
          </div>
        ) : canRate ? (
          <form className="mt-5" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (reviewScore) onReviewSubmit(reviewScore, reviewComment); }}>
            <fieldset>
              <legend className="text-sm leading-6 text-muted">How useful was the completed result?</legend>
              <div className="mt-4 flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5].map((score) => (
                  <button key={score} type="button" aria-label={`${score} out of 5 stars`} aria-pressed={reviewScore === score} onClick={() => setReviewScore(score)} className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand ${reviewScore === score ? "border-brand bg-brand text-black" : "border-surface-border text-muted hover:border-[#6a6a6a] hover:text-foreground"}`}>
                    <Star size={16} weight={reviewScore === score ? "fill" : "regular"} />{score}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="mt-5 block text-sm font-semibold" htmlFor="agent-review-comment">Comment <span className="font-normal text-muted">optional</span></label>
            <textarea id="agent-review-comment" value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} maxLength={500} rows={3} className="mt-2 block w-full rounded-2xl border border-surface-border bg-black px-4 py-3 text-sm leading-6 outline-none focus:border-brand focus:ring-2 focus:ring-brand" placeholder="What should another buyer know?" />
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <button type="submit" disabled={!reviewScore || reviewBusy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-black hover:bg-[#ffd34f] disabled:cursor-not-allowed disabled:opacity-50">{reviewBusy ? <SpinnerGap size={17} className="animate-spin" /> : <Star size={17} weight="fill" />}{reviewBusy ? "Saving review" : "Submit rating"}</button>
              <p className="text-xs text-muted">One review is allowed for each paid completed job.</p>
            </div>
            {reviewError ? <p className="mt-4 text-sm leading-6 text-warning" role="alert">{reviewError}</p> : null}
          </form>
        ) : (
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">A rating unlocks after this paid job returns a completed result. Simulation jobs and unpaid previews cannot affect agent reputation.</p>
        )}
      </section>

      <section className="mt-12 rounded-3xl border border-surface-border bg-surface p-6 sm:p-8">
        <div className="flex items-center gap-3"><Receipt size={22} className="text-brand" /><h2 className="text-2xl font-semibold">Escrow actions</h2></div>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">The provider submits the result. The configured evaluator policy decides settlement. A refund is available after the on chain expiry time.</p>
        {canReview ? <div className="mt-5 rounded-2xl border border-surface-border bg-black p-4" role="status" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold">Evaluator status</p><button type="button" onClick={onRefreshEvaluation} disabled={evaluationBusy || Boolean(lifecycleBusy)} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-surface-border px-3 py-1.5 text-xs font-semibold text-muted hover:border-[#6a6a6a] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50">{evaluationBusy ? <SpinnerGap size={15} className="animate-spin" /> : <ArrowClockwise size={15} />}{evaluationBusy ? "Checking policy" : "Refresh evaluator"}</button></div>
          <p className="mt-3 text-sm leading-6 text-muted">{evaluationBusy ? "Reading the on chain policy. No wallet prompt will open while the verdict is pending." : settlementWaiting && evaluation?.settleAt ? `Settlement unlocks in ${formatRemaining(evaluation.settleAt, currentTime)}. The page will check again automatically at the unlock time.` : evaluation?.message ?? "Settlement will check the on chain policy before asking for wallet approval."}</p>
          {evaluation?.settleAt ? <p className="mt-2 font-mono text-xs text-muted">Policy unlock time: {formatDate(evaluation.settleAt)}</p> : null}
          {evaluationError ? <p className="mt-3 text-sm leading-6 text-warning" role="alert">{evaluationError}</p> : null}
        </div> : null}
        {canReview ? <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={() => onLifecycleAction("dispute")} disabled={Boolean(lifecycleBusy)} className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#ad6565] px-4 py-2 text-sm font-semibold text-[#f0b4b4] hover:bg-[#281313] disabled:cursor-not-allowed disabled:opacity-50">{lifecycleBusy === "dispute" ? <SpinnerGap size={17} className="mr-2 animate-spin" /> : null}Dispute result</button>
          <button type="button" onClick={() => onLifecycleAction("settle")} disabled={Boolean(lifecycleBusy) || evaluationBusy || !settlementReady} title={!settlementReady ? "Settlement stays locked until the evaluator returns an approved or rejected verdict." : undefined} className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-black hover:bg-[#ffd34f] disabled:cursor-not-allowed disabled:opacity-50">{lifecycleBusy === "settle" || evaluationBusy ? <SpinnerGap size={17} className="mr-2 animate-spin" /> : null}{lifecycleBusy === "settle" ? "Settling" : evaluationBusy ? "Checking evaluator" : settlementWaiting ? "Waiting for unlock" : "Settle job"}</button>
        </div> : null}
        {canRefund ? <button type="button" onClick={() => onLifecycleAction("refund")} disabled={Boolean(lifecycleBusy)} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full border border-surface-border px-4 py-2 text-sm font-semibold text-muted hover:border-[#6a6a6a] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50">{lifecycleBusy === "refund" ? <SpinnerGap size={17} className="mr-2 animate-spin" /> : null}Claim refund</button> : null}
        {!canReview && !canRefund && job.escrow?.status === "submitted" ? <p className="mt-5 text-sm leading-6 text-muted">Settlement is waiting for the evaluator policy window. The job can be disputed during that window.</p> : null}
        {lifecycleError ? <div className="mt-5 flex items-start gap-2 rounded-2xl border border-[#ad6565] bg-[#281313] px-4 py-3 text-sm leading-6 text-[#f0b4b4]" role="alert"><WarningCircle size={18} className="mt-1 shrink-0" />{lifecycleError}</div> : null}
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
