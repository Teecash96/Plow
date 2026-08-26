"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  Code,
  Fingerprint,
  LockKey,
  NotePencil,
  ShieldCheck,
  Wallet,
  WarningCircle,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  connectBscWallet,
  createERC8183Job,
  ensureERC20Allowance,
  fundERC8183Job,
  getERC8183Config,
  hashJobTerms,
  parseERC20Amount,
  readPaymentToken,
  setERC8183Budget,
  verifyERC8183Deployment,
} from "@/lib/chain/erc8183-adapter";
import { SetupChecklist } from "@/components/hire/setup-checklist";
import { AltanaPermissionPanel } from "@/components/partners/altana-permission-panel";
import { getCategoryDefinition } from "@/lib/marketplace/categories";
import { appendLocalStatus, createLocalJob, updateLocalJob } from "@/lib/marketplace/job-store";
import { getHireSetupStatus } from "@/lib/marketplace/hire-setup";
import type { Agent } from "@/lib/marketplace/types";
import {
  getX402Config,
  requestX402Challenge,
  settleX402Payment,
  verifyX402Challenge,
} from "@/lib/payments/x402-adapter";

interface HireWizardProps {
  agent?: Agent;
  agentId: string;
}

const STEPS = [
  { label: "Task definition", icon: NotePencil },
  { label: "Review terms", icon: Code },
  { label: "Permissions", icon: LockKey },
  { label: "Job preview", icon: Code },
  { label: "Payment preview", icon: Wallet },
  { label: "Confirm and submit", icon: Check },
] as const;

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-surface-border py-3 text-sm last:border-b-0">
      <dt className="text-muted">{label}</dt>
      <dd className="max-w-[16rem] break-words text-right font-medium text-wrap-pretty">{value}</dd>
    </div>
  );
}

function PreviewNotice({ children, danger = false }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${danger ? "border-[#ad6565] bg-[#281313] text-[#f0b4b4]" : "border-[#9a843c] bg-[#211d0d] text-[#e8d995]"}`}>
      {children}
    </div>
  );
}

function expiryTimestamp(value: string) {
  const now = Math.floor(Date.now() / 1000);
  if (value === "1 hour") return BigInt(now + 60 * 60);
  if (value === "7 days") return BigInt(now + 7 * 24 * 60 * 60);
  return BigInt(now + 24 * 60 * 60);
}

function isNumericAmount(value: string) {
  return /^\d+(?:\.\d+)?$/.test(value.trim());
}

export function HireWizard({ agent, agentId }: HireWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [task, setTask] = useState("");
  const [budget, setBudget] = useState(agent?.pricing.amount && isNumericAmount(agent.pricing.amount) ? agent.pricing.amount : "");
  const [spendCap, setSpendCap] = useState("");
  const [allowlist, setAllowlist] = useState("");
  const [allowlistedTokens, setAllowlistedTokens] = useState("");
  const [expiration, setExpiration] = useState("24 hours");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [walletAddress, setWalletAddress] = useState<string>();
  const [createdJobId, setCreatedJobId] = useState<string>();
  const category = agent ? getCategoryDefinition(agent.category) : undefined;
  const currency = agent?.pricing.currency ?? "Configured token";
  const ercConfig = useMemo(() => getERC8183Config(), []);
  const x402Config = useMemo(() => getX402Config(), []);
  const setup = useMemo(() => getHireSetupStatus(agent), [agent]);
  const combinedSettlementEnabled = process.env.NEXT_PUBLIC_HIRE_COMBINED_SETTLEMENT === "true";
  const identityReady = Boolean(
    agent
    && agent.mode === "live"
    && agent.verified
    && agent.identity.ownerAddress
    && agent.deployment.chainId === ercConfig.chainId,
  );
  const canSubmit = Boolean(
    agent
    && task.trim()
    && budget.trim()
    && identityReady
    && setup.ready
    && !busy,
  );

  const permissionPreview = useMemo(() => ({
    provider: "Altana" as const,
    spendCap: spendCap || budget || "Not set",
    currency,
    allowlistedContracts: allowlist.split(",").map((item) => item.trim()).filter(Boolean),
    allowlistedTokens: allowlistedTokens.split(",").map((item) => item.trim()).filter(Boolean),
    expiresAt: expiration,
    status: "draft" as const,
    templateId: "altana-hire-draft",
    revokeSupported: false,
    lastUpdatedAt: "Before submission",
    source: "job" as const,
  }), [allowlist, allowlistedTokens, budget, currency, expiration, spendCap]);

  const termsPreview = useMemo(() => ({
    agentId: agent?.identity.agentId ?? agentId,
    category: agent?.category ?? "uncategorised",
    taskSummary: task.trim() || "Task not defined",
    budget: budget.trim() || "Budget not defined",
    expiresAt: expiration,
  }), [agent, agentId, budget, expiration, task]);
  const termsHash = useMemo(() => hashJobTerms(termsPreview), [termsPreview]);

  function nextStep() {
    if (step === 0 && !task.trim()) {
      setAttempted(true);
      return;
    }
    setAttempted(false);
    setError(undefined);
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  function previousStep() {
    setAttempted(false);
    setError(undefined);
    setStep((current) => Math.max(current - 1, 0));
  }

  function saveLocalDraft() {
    if (!agent || !task.trim()) return;
    const job = createLocalJob({
      agent,
      taskSummary: task.trim(),
      price: budget || "Not set",
      currency,
      permission: permissionPreview,
      expiresAt: expiration,
      termsHash,
    });
    router.push(`/jobs/${job.id}`);
  }

  async function submitRealHire() {
    if (!agent || !task.trim()) return;
    setBusy(true);
    setError(undefined);
    let localJobId: string | undefined;
    try {
      if (!identityReady) throw new Error("This agent is not eligible for on chain hiring. A verified live ERC 8004 identity and provider address are required.");
      if (!ercConfig.enabled) throw new Error(ercConfig.reason ?? "ERC8183 is not configured for this deployment.");
      if (!x402Config.enabled) throw new Error(x402Config.reason ?? "x402 is not configured for this deployment.");
      if (!combinedSettlementEnabled) throw new Error("Combined settlement is disabled. Set NEXT_PUBLIC_HIRE_COMBINED_SETTLEMENT=true only after the x402 resource and ERC8183 escrow have been tested together.");

      const wallet = await connectBscWallet();
      setWalletAddress(wallet.account);
      await verifyERC8183Deployment(wallet.publicClient);
      const paymentToken = await readPaymentToken(wallet.publicClient, ercConfig.paymentTokenAddress);
      const amount = parseERC20Amount(budget, paymentToken.decimals);
      const evaluator = ercConfig.evaluatorAddress ?? wallet.account;
      const description = JSON.stringify({
        marketplace: "BNB Agent Studio",
        agentId: agent.identity.agentId,
        client: wallet.account,
        task: task.trim(),
        category: agent.category,
        termsHash,
      });

      const created = await createERC8183Job({
        walletClient: wallet.walletClient,
        publicClient: wallet.publicClient,
        account: wallet.account,
        provider: agent.identity.ownerAddress as `0x${string}`,
        evaluator,
        expiredAt: expiryTimestamp(expiration),
        description,
        hookAddress: ercConfig.hookAddress,
      });
      setCreatedJobId(created.jobId);

      const pendingJob = createLocalJob({
        agent,
        taskSummary: task.trim(),
        price: budget,
        currency: paymentToken.symbol,
        clientAddress: wallet.account,
        status: "pending",
        permission: permissionPreview,
        expiresAt: expiration,
        termsHash,
        onchainJobId: created.jobId,
        onchainNetwork: ercConfig.networkName,
        onchainChainId: ercConfig.chainId,
        jobContractAddress: ercConfig.contractAddress,
        payment: {
          protocol: "x402",
          status: "pending",
          amount: budget,
          currency: paymentToken.symbol,
        },
      });
      localJobId = pendingJob.id;

      const expected = {
        jobId: created.jobId,
        agentId: agent.identity.agentId,
        amount: amount.toString(),
        network: x402Config.network,
        asset: paymentToken.address,
        recipient: agent.identity.ownerAddress as `0x${string}`,
        resource: x402Config.resourceUrl,
        knownReceiptIds: [],
      };
      const challenge = await requestX402Challenge(expected);
      if (challenge.status !== "challenge" || !challenge.paymentRequired) throw new Error(challenge.reason ?? "The x402 resource did not issue a payment challenge.");
      const verification = verifyX402Challenge(challenge.paymentRequired, expected);
      if (!verification.valid) throw new Error(verification.reason ?? "The x402 challenge failed verification.");

      await setERC8183Budget({
        walletClient: wallet.walletClient,
        publicClient: wallet.publicClient,
        account: wallet.account,
        jobId: BigInt(created.jobId),
        amount,
      });
      await ensureERC20Allowance({
        walletClient: wallet.walletClient,
        publicClient: wallet.publicClient,
        account: wallet.account,
        spender: ercConfig.contractAddress as `0x${string}`,
        amount,
        tokenAddress: paymentToken.address,
      });

      const settlement = await settleX402Payment({
        wallet,
        publicClient: wallet.publicClient,
        paymentRequired: challenge.paymentRequired,
        verification,
        expected,
      });
      if (settlement.status !== "paid") throw new Error(settlement.reason ?? "The x402 payment was not settled.");
      updateLocalJob(pendingJob.id, {
        payment: {
          protocol: "x402",
          status: "paid",
          amount: budget,
          currency: paymentToken.symbol,
          receiptId: settlement.receiptId,
          transactionHash: settlement.transactionHash,
          paidAt: new Date().toISOString(),
        },
      });

      const funded = await fundERC8183Job({
        walletClient: wallet.walletClient,
        publicClient: wallet.publicClient,
        account: wallet.account,
        jobId: BigInt(created.jobId),
        amount,
      });
      updateLocalJob(pendingJob.id, {
        status: "active",
        payment: {
          protocol: "x402",
          status: "paid",
          amount: budget,
          currency: paymentToken.symbol,
          receiptId: settlement.receiptId,
          transactionHash: settlement.transactionHash ?? funded.transactionHash,
          paidAt: new Date().toISOString(),
        },
      });
      appendLocalStatus(pendingJob.id, "active", `ERC8183 job ${created.jobId} was funded on ${ercConfig.networkName}.`);
      router.push(`/jobs/${pendingJob.id}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The hire could not be submitted.";
      setError(message);
      if (localJobId) {
        updateLocalJob(localJobId, { status: "failed" });
        appendLocalStatus(localJobId, "failed", message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-surface-border px-4 py-4 sm:px-6 sm:py-5">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <a href={`/agents/${agentId}`} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-brand">
            <ArrowLeft size={16} />
            Back to agent
          </a>
          <Link href="/jobs" className="inline-flex min-h-11 items-center text-sm font-semibold tracking-tight">View jobs</Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-28 pt-10 sm:px-6 sm:pt-12 lg:pt-20">
        <section className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Hire foundation</p>
          <h1 className="mt-4 text-4xl font-semibold leading-none tracking-tight text-wrap-balance sm:text-6xl">Review the job before anything is signed</h1>
          <p className="mt-6 text-lg leading-7 text-muted text-wrap-pretty">The final action can create an ERC 8183 job on the configured BSC network, verify an x402 challenge, and fund the job. It stays disabled until every required setup check passes.</p>
        </section>

        {!agent ? (
          <PreviewNotice danger>
            Agent <span className="font-mono">{agentId}</span> is not connected to the verified registry. No wallet action is available.
          </PreviewNotice>
        ) : null}

        {agent && !identityReady ? (
          <PreviewNotice danger>
            This agent is not eligible for real hiring. Only a live, verified ERC 8004 identity with an on chain provider address can receive a job. Demo agents stay local only.
          </PreviewNotice>
        ) : null}

        <div className="mt-8">
          <SetupChecklist status={setup} compact />
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-[1fr_23rem] lg:items-start">
          <section>
            <ol className="grid grid-cols-2 gap-2 xl:grid-cols-3" aria-label="Hiring steps">
              {STEPS.map((item, index) => {
                const Icon = item.icon;
                const active = index === step;
                const complete = index < step;
                return (
                  <li key={item.label}>
                    <button type="button" onClick={() => index <= step && setStep(index)} aria-current={active ? "step" : undefined} className={`flex min-h-11 w-full min-w-0 items-center gap-2 rounded-2xl border px-3 py-3 text-left text-sm transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] focus:outline-none focus:ring-2 focus:ring-brand sm:gap-3 sm:px-4 ${active ? "border-brand bg-brand text-black" : "border-surface-border bg-surface text-muted hover:border-[#6a6a6a] hover:text-foreground"}`}>
                      <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${active ? "bg-black text-brand" : complete ? "bg-[#193f2f] text-positive" : "bg-surface-raised"}`}>
                        {complete ? <Check size={15} weight="bold" /> : <Icon size={15} />}
                      </span>
                      <span className="min-w-0 break-words">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ol>

            <div className="mt-6 rounded-3xl border border-surface-border bg-surface p-5 sm:p-8">
              {step === 0 ? (
                <div>
                  <div className="flex items-center gap-3"><NotePencil size={22} className="text-brand" /><h2 className="text-2xl font-semibold">What should the agent do?</h2></div>
                  <p className="mt-3 text-sm leading-6 text-muted">Describe one clear task. The request becomes part of the on chain job description and the x402 resource context.</p>
                  <label className="mt-8 block text-sm font-semibold" htmlFor="task">Task description</label>
                  <textarea id="task" value={task} onChange={(event) => setTask(event.target.value)} rows={7} placeholder="Example: review this BSC liquidity position and return a range adjustment recommendation with the supporting evidence." className="mt-3 w-full resize-y rounded-2xl border border-surface-border bg-black px-4 py-3 text-sm leading-6 text-foreground outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand" />
                  {attempted && !task.trim() ? <p className="mt-2 text-sm text-negative">Add a task description before continuing.</p> : null}
                  <p className="mt-3 text-xs text-muted">The task is not sent until you confirm the wallet transaction sequence.</p>
                </div>
              ) : null}

              {step === 1 ? (
                <div>
                  <div className="flex items-center gap-3"><Code size={22} className="text-brand" /><h2 className="text-2xl font-semibold">Review the terms</h2></div>
                  <p className="mt-3 text-sm leading-6 text-muted">Live agents do not publish a verified price until their service quote is connected. Enter the token budget you approve for this job.</p>
                  <label className="mt-8 block text-sm font-semibold" htmlFor="budget">Approved budget <span className="font-normal text-muted">{currency}</span><input id="budget" value={budget} onChange={(event) => setBudget(event.target.value)} inputMode="decimal" placeholder="Required for an on chain job" className="mt-2 w-full rounded-2xl border border-surface-border bg-black px-4 py-3 font-mono text-sm outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand" /></label>
                  <dl className="mt-8 rounded-2xl border border-surface-border bg-black px-4">
                    <SummaryRow label="Agent" value={agent?.name ?? "Agent not connected"} />
                    <SummaryRow label="ERC 8004 ID" value={agent?.identity.agentId ?? agentId} />
                    <SummaryRow label="Category" value={category?.label ?? "Category pending"} />
                    <SummaryRow label="Budget" value={`${budget || "Not set"} ${currency}`} />
                    <SummaryRow label="Task" value={task || "Task not defined"} />
                  </dl>
                </div>
              ) : null}

              {step === 2 ? (
                <div>
                  <div className="flex items-center gap-3"><LockKey size={22} className="text-brand" /><h2 className="text-2xl font-semibold">Set permission boundaries</h2></div>
                  <p className="mt-3 text-sm leading-6 text-muted">Define the smallest permission scope the job may need. These values are stored with the job and are ready for an Altana session key adapter, but they are not enforced yet.</p>
                  <div className="mt-8 space-y-5">
                    <label className="block text-sm font-semibold" htmlFor="spend-cap">Spend cap <span className="font-normal text-muted">in {currency}</span><input id="spend-cap" value={spendCap} onChange={(event) => setSpendCap(event.target.value)} placeholder={budget || "Set a maximum"} className="mt-2 w-full rounded-2xl border border-surface-border bg-black px-4 py-3 font-mono text-sm outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand" /></label>
                    <label className="block text-sm font-semibold" htmlFor="allowlist">Allowlisted contracts <span className="font-normal text-muted">comma separated</span><input id="allowlist" value={allowlist} onChange={(event) => setAllowlist(event.target.value)} placeholder="No contracts added" className="mt-2 w-full rounded-2xl border border-surface-border bg-black px-4 py-3 font-mono text-sm outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand" /></label>
                    <label className="block text-sm font-semibold" htmlFor="allowlisted-tokens">Allowlisted tokens <span className="font-normal text-muted">comma separated</span><input id="allowlisted-tokens" value={allowlistedTokens} onChange={(event) => setAllowlistedTokens(event.target.value)} placeholder="No tokens added" className="mt-2 w-full rounded-2xl border border-surface-border bg-black px-4 py-3 font-mono text-sm outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand" /></label>
                    <label className="block text-sm font-semibold" htmlFor="expiration">Expiration<select id="expiration" value={expiration} onChange={(event) => setExpiration(event.target.value)} className="mt-2 min-h-11 w-full rounded-2xl border border-surface-border bg-black px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand"><option>1 hour</option><option>24 hours</option><option>7 days</option></select></label>
                  </div>
                  <div className="mt-6"><AltanaPermissionPanel permission={permissionPreview} /></div>
                </div>
              ) : null}

              {step === 3 ? (
                <div>
                  <div className="flex items-center gap-3"><Code size={22} className="text-brand" /><h2 className="text-2xl font-semibold">Preview the ERC 8183 job</h2></div>
                  <p className="mt-3 text-sm leading-6 text-muted">These terms are hashed before the job is created. The adapter reads the JobCreated receipt and stores the returned job ID locally.</p>
                  <dl className="mt-8 rounded-2xl border border-surface-border bg-black px-4">
                    <SummaryRow label="Protocol" value="ERC 8183" />
                    <SummaryRow label="Provider" value={agent?.identity.ownerAddress ?? "Provider address pending"} />
                    <SummaryRow label="Task" value={task || "Task not defined"} />
                    <SummaryRow label="Category" value={category?.label ?? "Category pending"} />
                    <SummaryRow label="Expiration" value={expiration} />
                    <SummaryRow label="Terms hash" value={termsHash} />
                    <SummaryRow label="Network" value={`${ercConfig.networkName}, chain ${ercConfig.chainId}`} />
                  </dl>
                </div>
              ) : null}

              {step === 4 ? (
                <div>
                  <div className="flex items-center gap-3"><Wallet size={22} className="text-brand" /><h2 className="text-2xl font-semibold">Preview the x402 payment</h2></div>
                  <p className="mt-3 text-sm leading-6 text-muted">The configured resource must return a 402 challenge that matches this job ID, agent ID, token, recipient, amount, and the selected BSC network. The wallet signs only after those checks pass.</p>
                  <dl className="mt-8 rounded-2xl border border-surface-border bg-black px-4">
                    <SummaryRow label="Payment protocol" value="x402 exact" />
                    <SummaryRow label="Amount" value={`${budget || "Not set"} ${currency}`} />
                    <SummaryRow label="Network" value={x402Config.network} />
                    <SummaryRow label="Resource" value={x402Config.resourceUrl ?? "Not configured"} />
                    <SummaryRow label="Payment status" value="Challenge required" />
                    <SummaryRow label="Receipt" value="Created only after a valid response" />
                  </dl>
                </div>
              ) : null}

              {step === 5 ? (
                <div>
                  <div className="flex items-center gap-3"><Check size={22} className="text-brand" /><h2 className="text-2xl font-semibold">Confirm and submit</h2></div>
                  <p className="mt-3 text-sm leading-6 text-muted">The real path creates the job, sets the ERC 8183 budget, verifies and settles x402, approves the payment token if needed, then funds the job. Every transaction can be rejected by the wallet.</p>
                  <div className="mt-8 space-y-3">
                    <SummaryRow label="Agent" value={agent?.name ?? "Agent not connected"} />
                    <SummaryRow label="Task" value={task || "Task not defined"} />
                    <SummaryRow label="Budget" value={`${budget || "Not set"} ${currency}`} />
                    <SummaryRow label="Permission cap" value={permissionPreview.spendCap} />
                    <SummaryRow label="Permission scope" value={`${permissionPreview.allowlistedContracts.length} contracts · ${permissionPreview.allowlistedTokens.length} tokens`} />
                    <SummaryRow label="Job status" value={createdJobId ? `Created, ID ${createdJobId}` : "Not submitted"} />
                    <SummaryRow label="Wallet" value={walletAddress ?? "Not connected"} />
                  </div>
                  {!ercConfig.enabled ? <PreviewNotice danger>{ercConfig.reason}</PreviewNotice> : null}
                  {ercConfig.enabled && !x402Config.enabled ? <PreviewNotice danger>{x402Config.reason}</PreviewNotice> : null}
                  {ercConfig.enabled && x402Config.enabled && !combinedSettlementEnabled ? <PreviewNotice danger>Real submission is locked until the deployment owner enables the tested combined settlement flag. This prevents an x402 charge and an ERC 8183 escrow charge from being made accidentally.</PreviewNotice> : null}
                  {agent?.mode === "demo" ? <PreviewNotice danger>Demo agents cannot be hired on chain.</PreviewNotice> : null}
                  {error ? <div className="mt-4 flex items-start gap-2 rounded-2xl border border-[#ad6565] bg-[#281313] px-4 py-3 text-sm leading-6 text-[#f0b4b4]" role="alert"><WarningCircle size={18} className="mt-1 shrink-0" />{error}</div> : null}
                </div>
              ) : null}

              <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-surface-border pt-5">
                <button type="button" onClick={previousStep} disabled={step === 0 || busy} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-surface-border px-4 py-2 text-sm font-semibold text-muted transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-black hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand"><ArrowLeft size={16} /> Back</button>
                {step < STEPS.length - 1 ? <button type="button" onClick={nextStep} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-black transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#ffd34f] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand">Continue <ArrowRight size={16} /></button> : <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row"><button type="button" onClick={saveLocalDraft} disabled={!agent || !task.trim() || busy} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-surface-border px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-[#6a6a6a] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand sm:w-auto">Save local draft</button><button type="button" onClick={submitRealHire} disabled={!canSubmit} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-black transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#ffd34f] active:translate-y-px disabled:cursor-not-allowed disabled:bg-[#5a5230] disabled:text-[#b9ae7b] focus:outline-none focus:ring-2 focus:ring-brand sm:w-auto">{busy ? "Submitting" : "Connect wallet and submit"} <Check size={16} weight="bold" /></button></div>}
              </div>
            </div>
          </section>

          <aside className="order-first rounded-3xl border border-surface-border bg-surface p-4 lg:order-none lg:sticky lg:top-6 lg:p-5">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Job summary</p>
            <div className="mt-5 flex items-start gap-3">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-black text-brand"><Fingerprint size={20} /></span>
              <div><p className="text-sm font-semibold">{agent?.name ?? "Agent not connected"}</p><p className="mt-1 font-mono text-xs text-muted">{agent?.identity.agentId ?? agentId}</p></div>
            </div>
            <dl className="mt-6 border-y border-surface-border py-2">
              <SummaryRow label="Step" value={`${step + 1} of ${STEPS.length}`} />
              <SummaryRow label="Category" value={category?.label ?? "Category pending"} />
              <SummaryRow label="Budget" value={`${budget || "Not set"} ${currency}`} />
              <SummaryRow label="Network" value={`${ercConfig.networkName}, chain ${ercConfig.chainId}`} />
              <SummaryRow label="Status" value={busy ? "Submitting" : createdJobId ? `On chain ${createdJobId}` : "Preview"} />
            </dl>
            <div className="mt-5 rounded-2xl border border-surface-border bg-black p-4">
              <div className="flex items-center gap-2 text-xs text-muted"><ShieldCheck size={16} className="text-brand" /> Permission preview</div>
              <p className="mt-3 text-sm font-semibold">Spend cap: {permissionPreview.spendCap}</p>
              <p className="mt-1 text-xs text-muted">Contracts: {permissionPreview.allowlistedContracts.length || "Not set"}</p>
              <p className="mt-1 text-xs text-muted">Tokens: {permissionPreview.allowlistedTokens.length || "Not set"}</p>
              <p className="mt-1 text-xs text-muted">Expires: {permissionPreview.expiresAt}</p>
            </div>
            <div className="mt-5 flex items-start gap-2 text-xs leading-5 text-muted"><Clock size={15} className="mt-0.5 shrink-0 text-brand" /> No wallet transaction is requested until the final action is enabled by configuration and verification.</div>
          </aside>
        </div>
      </main>
    </div>
  );
}
