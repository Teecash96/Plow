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
  Play,
  ShieldCheck,
  Wallet,
  WarningCircle,
} from "@phosphor-icons/react";
import { PERMIT2_ADDRESS } from "@x402/evm";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  connectBscWallet,
  createERC8183Job,
  ERC8183TransactionError,
  ensureERC20Allowance,
  fundERC8183Job,
  getERC8183Config,
  hashJobTerms,
  parseERC20Amount,
  readPaymentToken,
  readERC8183DisputeWindow,
  registerERC8183Job,
  setERC8183Budget,
  verifyERC8183Deployment,
} from "@/lib/chain/erc8183-adapter";
import { getPancakeSwapRebalanceConfig } from "@/lib/chain/pancakeswap-rebalance";
import { SetupChecklist } from "@/components/hire/setup-checklist";
import { AltanaPermissionPanel } from "@/components/partners/altana-permission-panel";
import { getCategoryDefinition } from "@/lib/marketplace/categories";
import { createRemoteJob, executeRemoteJob, getRemoteJob, listRemoteJobs, recordFundingBroadcastRemoteJob, reconcileRemoteJob, updateRemoteJob } from "@/lib/marketplace/job-api";
import { appendLocalStatus, createLocalJob, updateLocalJob } from "@/lib/marketplace/job-store";
import { getHireSetupStatus } from "@/lib/marketplace/hire-setup";
import { getHireResumeMode, type HireResumeMode } from "@/lib/marketplace/hire-resume";
import { permissionExpiryForDuration } from "@/lib/marketplace/permission-policy";
import { assertHirePermissionPlan } from "@/lib/marketplace/hire-permission-plan";
import { createSandboxJob, saveSandboxJob } from "@/lib/marketplace/sandbox";
import { isAgentHireable, type Agent, type AgentCategory, type Job } from "@/lib/marketplace/types";
import { sameDecimal } from "@/lib/marketplace/service-readiness";
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

const EXPIRATION_OPTIONS = ["1 hour", "24 hours", "7 days", "14 days"] as const;
const DEFAULT_EXPIRATION = "14 days" as const;

type HireStage = "checking" | "connecting" | "creating" | "registering" | "payment" | "budget" | "funding" | "starting";

const HIRE_STAGE_LABELS: Record<HireStage, string> = {
  checking: "Checking requirements",
  connecting: "Connecting wallet",
  creating: "Creating job",
  registering: "Registering job",
  payment: "Preparing payment",
  budget: "Setting budget",
  funding: "Funding escrow",
  starting: "Starting agent",
};

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
  if (value === "14 days") return BigInt(now + 14 * 24 * 60 * 60);
  return BigInt(now + 24 * 60 * 60);
}

function isNumericAmount(value: string) {
  return /^\d+(?:\.\d+)?$/.test(value.trim());
}

function multipliedAmount(value: string, multiplier: number) {
  const normalized = value.trim();
  if (!isNumericAmount(normalized) || !Number.isInteger(multiplier) || multiplier < 1) return "";
  const [whole, fraction = ""] = normalized.split(".");
  const scaled = BigInt(`${whole}${fraction}`) * BigInt(multiplier);
  if (!fraction) return scaled.toString();
  const padded = scaled.toString().padStart(fraction.length + 1, "0");
  const splitAt = padded.length - fraction.length;
  return `${padded.slice(0, splitAt)}.${padded.slice(splitAt)}`.replace(/\.?0+$/, "");
}

function twiceAmount(value: string) {
  return multipliedAmount(value, 2);
}

function fourTimesAmount(value: string) {
  return multipliedAmount(value, 4);
}

function commaSeparatedValues(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function uniqueValues(values: readonly (string | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function getSupportedCategories(agent: Agent | undefined) {
  if (!agent) return [] as readonly AgentCategory[];
  if (agent.supportedCategories?.length) return agent.supportedCategories;
  return agent.category === "uncategorised" ? [] : [agent.category];
}

function TokenApprovalOption({
  enabled,
  onEnabledChange,
  reserve,
  onReserveChange,
  budget,
  currency,
}: {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  reserve: string;
  onReserveChange: (value: string) => void;
  budget: string;
  currency: string;
}) {
  const suggestedReserve = fourTimesAmount(budget);
  return (
    <div className="rounded-2xl border border-surface-border bg-black p-4">
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
          className="mt-1 size-4 accent-brand"
        />
        <span>
          <span className="font-semibold">Reuse a bounded token approval</span>
          <span className="mt-1 block text-xs leading-5 text-muted">Approve the configured ERC 8183 contract and Permit2 up to a fixed reserve. This can remove approval prompts on later jobs. It does not remove the required job transactions.</span>
        </span>
      </label>
      {enabled ? (
        <label className="mt-4 block text-sm font-semibold" htmlFor="approval-reserve">
          Approval reserve <span className="font-normal text-muted">in {currency}</span>
          <input
            id="approval-reserve"
            value={reserve}
            onChange={(event) => onReserveChange(event.target.value)}
            inputMode="decimal"
            placeholder={suggestedReserve ? `Auto: ${suggestedReserve}` : "Set a fixed reserve"}
            aria-describedby="approval-reserve-help"
            className="mt-2 w-full rounded-2xl border border-surface-border bg-surface px-4 py-3 font-mono text-sm outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand"
          />
          <span id="approval-reserve-help" className="mt-2 block text-xs font-normal leading-5 text-muted">The reserve defaults to four times this job budget. The contract can still spend only the approved job amount during this run. Revoke allowances in the wallet when you no longer trust a spender.</span>
        </label>
      ) : null}
    </div>
  );
}

export function HireWizard({ agent, agentId }: HireWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [task, setTask] = useState("");
  const [budget, setBudget] = useState(agent?.pricing.amount && isNumericAmount(agent.pricing.amount) ? agent.pricing.amount : "");
  const [reuseTokenApproval, setReuseTokenApproval] = useState(false);
  const [approvalReserve, setApprovalReserve] = useState("");
  const [spendCap, setSpendCap] = useState("");
  const [allowlist, setAllowlist] = useState("");
  const [allowlistedTokens, setAllowlistedTokens] = useState("");
  const [expiration, setExpiration] = useState<string>(DEFAULT_EXPIRATION);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hireStage, setHireStage] = useState<HireStage>();
  const [error, setError] = useState<string>();
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string>();
  const [createdJobId, setCreatedJobId] = useState<string>();
  const [resumeJob, setResumeJob] = useState<Job>();
  const [jobPersistenceReady, setJobPersistenceReady] = useState<boolean>();
  const [categorySelection, setCategorySelection] = useState<AgentCategory>(() => {
    const supported = getSupportedCategories(agent);
    return (agent?.category !== "uncategorised" && agent && supported.includes(agent.category)
      ? agent.category
      : supported[0]) as AgentCategory;
  });
  const supportedCategories = useMemo(() => getSupportedCategories(agent), [agent]);
  const selectedCategory = categorySelection && supportedCategories.includes(categorySelection)
    ? categorySelection
    : supportedCategories[0];
  const category = selectedCategory ? getCategoryDefinition(selectedCategory) : undefined;
  const taskPlaceholder = selectedCategory === "health-factor-monitoring"
    ? "Example: monitor my lending position and alert below 1.2. Include account 0x... to monitor another wallet."
    : selectedCategory === "yield-optimisation"
      ? "Example: compare the configured yield routes and return current onchain share prices."
      : "Example: review this BSC liquidity position and return a range adjustment recommendation with the supporting evidence.";
  const currency = agent?.pricing.currency ?? "Configured token";
  const ercConfig = useMemo(() => getERC8183Config(), []);
  const pancakeSwapRebalanceConfig = useMemo(() => getPancakeSwapRebalanceConfig(), []);
  const x402Config = useMemo(() => getX402Config(), []);
  const setup = useMemo(() => getHireSetupStatus(agent), [agent]);
  const combinedSettlementEnabled = process.env.NEXT_PUBLIC_HIRE_COMBINED_SETTLEMENT === "true";
  const identityReady = Boolean(
    agent
    && agent.mode === "live"
    && agent.verified
    && agent.identity.ownerAddress,
  );
  const serviceReady = isAgentHireable(agent);
  useEffect(() => {
    let active = true;
    void listRemoteJobs()
      .then(() => {
        if (active) setJobPersistenceReady(true);
      })
      .catch(() => {
        if (active) setJobPersistenceReady(false);
      });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const resumeJobId = new URL(window.location.href).searchParams.get("resumeJobId");
    if (!resumeJobId) return;
    let active = true;
    void getRemoteJob(resumeJobId)
      .then((job) => {
        if (!active) return;
        if (!job
          || job.agentIdentityId !== agent?.identity.agentId
          || !getHireResumeMode(job)
          || !job.permission) {
          setError("This job is not ready to resume. Open jobs with a pending or already paid x402 payment can be resumed.");
          return;
        }
        setError(undefined);
        setResumeJob(job);
        setTask(job.taskSummary);
        setBudget(job.price);
        if (supportedCategories.includes(job.category as AgentCategory)) setCategorySelection(job.category as AgentCategory);
        setExpiration(EXPIRATION_OPTIONS.includes(job.terms.expiresAt as (typeof EXPIRATION_OPTIONS)[number]) ? job.terms.expiresAt : DEFAULT_EXPIRATION);
      })
      .catch(() => {
        if (active) setError("The saved job could not be loaded for resuming.");
      });
    return () => { active = false; };
  }, [agent?.identity.agentId, supportedCategories]);
  const canSubmit = Boolean(
    agent
    && task.trim()
    && budget.trim()
    && selectedCategory
    && identityReady
    && serviceReady
    && jobPersistenceReady === true
    && setup.ready
    && !busy,
  );

  const permissionPreview = useMemo(() => ({
    provider: "Altana" as const,
    spendCap: spendCap.trim() || twiceAmount(budget) || "Not set",
    currency,
    allowlistedContracts: uniqueValues([ercConfig.contractAddress, ercConfig.routerAddress, ercConfig.policyAddress, pancakeSwapRebalanceConfig.routerAddress, PERMIT2_ADDRESS, ...commaSeparatedValues(allowlist)]),
    allowlistedTokens: uniqueValues([ercConfig.paymentTokenAddress, pancakeSwapRebalanceConfig.tokenInAddress, pancakeSwapRebalanceConfig.tokenOutAddress, ...commaSeparatedValues(allowlistedTokens)]),
    expiresAt: expiration,
    expiresAtTimestamp: permissionExpiryForDuration(expiration),
    status: "draft" as const,
    templateId: "altana-hire-draft",
    revokeSupported: false,
    lastUpdatedAt: "Before submission",
    source: "job" as const,
  }), [allowlist, allowlistedTokens, budget, currency, ercConfig.contractAddress, ercConfig.paymentTokenAddress, ercConfig.policyAddress, ercConfig.routerAddress, expiration, pancakeSwapRebalanceConfig.routerAddress, pancakeSwapRebalanceConfig.tokenInAddress, pancakeSwapRebalanceConfig.tokenOutAddress, spendCap]);

  const termsPreview = useMemo(() => ({
    agentId: agent?.identity.agentId ?? agentId,
    category: selectedCategory ?? "uncategorised",
    taskSummary: task.trim() || "Task not defined",
    budget: budget.trim() || "Budget not defined",
    expiresAt: expiration,
  }), [agent, agentId, budget, expiration, selectedCategory, task]);
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

  async function saveLocalDraft() {
    if (!agent || !task.trim()) return;
    setBusy(true);
    setError(undefined);
    const job = createLocalJob({
      agent,
      category: selectedCategory,
      taskSummary: task.trim(),
      price: budget || "Not set",
      currency,
      permission: permissionPreview,
      expiresAt: expiration,
      termsHash,
    });
    try {
      await createRemoteJob(job);
    } catch {
      // Local drafts remain available when the optional database is not configured.
    } finally {
      setBusy(false);
      router.push(`/jobs/${job.id}`);
    }
  }

  function runSandboxSimulation() {
    if (!agent || !task.trim() || sandboxBusy) {
      if (!task.trim()) setAttempted(true);
      return;
    }
    setSandboxBusy(true);
    setError(undefined);
    try {
      const job = createSandboxJob({
        agent,
        category: selectedCategory,
        taskSummary: task.trim(),
        price: budget.trim() || agent.pricing.amount || "Demo only",
        currency,
        permission: permissionPreview,
        expiresAt: expiration,
        termsHash,
      });
      saveSandboxJob(job);
      router.push(`/jobs/${job.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The sandbox could not be started.");
    } finally {
      setSandboxBusy(false);
    }
  }

  async function submitRealHire() {
    if (!agent || !task.trim()) return;
    setBusy(true);
    setError(undefined);
    setHireStage("checking");
    let localJobId: string | undefined;
    const existingJob = resumeJob;
    try {
      if (!identityReady) throw new Error("This agent is not eligible for on chain hiring. A verified live ERC 8004 identity and provider address are required.");
      if (!selectedCategory || !supportedCategories.includes(selectedCategory)) throw new Error("Choose a strategy category supported by this provider.");
      if (!serviceReady) throw new Error(agent.hiring.reason ?? "Pricing, freshness, and execution checks are required before hiring.");
      if (!sameDecimal(agent.pricing.amount, budget) || agent.pricing.currency.toLowerCase() !== currency.toLowerCase()) {
        throw new Error("The budget must match the agent's verified x402 price.");
      }
      if (!ercConfig.enabled) throw new Error(ercConfig.reason ?? "ERC8183 is not configured for this deployment.");
      if (!x402Config.enabled) throw new Error(x402Config.reason ?? "x402 is not configured for this deployment.");
      if (!combinedSettlementEnabled) throw new Error("Combined settlement is disabled. Set NEXT_PUBLIC_HIRE_COMBINED_SETTLEMENT=true only after the x402 resource and ERC8183 escrow have been tested together.");
      if (!ercConfig.contractAddress || !ercConfig.paymentTokenAddress || !ercConfig.routerAddress || !ercConfig.policyAddress) throw new Error("The ERC 8183 contract, payment token, evaluator router, and policy must be configured before live hiring.");

      setHireStage("connecting");
      const wallet = await connectBscWallet();
      setWalletAddress(wallet.account);
      if (existingJob && wallet.account.toLowerCase() !== existingJob.clientAddress.toLowerCase()) {
        throw new Error("Connect the wallet that created this job before resuming it.");
      }
      setHireStage("checking");
      await verifyERC8183Deployment(wallet.publicClient);
      const paymentToken = await readPaymentToken(wallet.publicClient, ercConfig.paymentTokenAddress);
      const amount = parseERC20Amount(budget, paymentToken.decimals);
      const approvalAmount = reuseTokenApproval
        ? parseERC20Amount(approvalReserve.trim() || fourTimesAmount(budget), paymentToken.decimals)
        : amount;
      const expiredAt = expiryTimestamp(expiration);
      const disputeWindow = await readERC8183DisputeWindow(wallet.publicClient);
      if (expiredAt <= BigInt(Math.floor(Date.now() / 1000)) + disputeWindow + BigInt(600)) {
        throw new Error("The selected expiry is too short for the evaluator dispute window. Choose a longer expiry.");
      }
      const evaluator = ercConfig.routerAddress;
      const permission = existingJob?.permission ?? {
        ...permissionPreview,
        status: "active" as const,
        lastUpdatedAt: new Date().toISOString(),
      };
      assertHirePermissionPlan({
        permission,
        contractAddress: ercConfig.contractAddress,
        tokenAddress: paymentToken.address,
        amountAtomic: amount,
        tokenDecimals: paymentToken.decimals,
        currency: paymentToken.symbol,
      });
      const pendingJob = existingJob ?? createLocalJob({
          agent,
          category: selectedCategory,
          taskSummary: task.trim(),
          price: budget,
          currency: paymentToken.symbol,
          clientAddress: wallet.account,
          status: "pending",
          permission,
          expiresAt: expiration,
          termsHash,
          onchainNetwork: ercConfig.networkName,
          onchainChainId: ercConfig.chainId,
          jobContractAddress: ercConfig.contractAddress,
          payment: {
            protocol: "x402",
            status: "pending",
            amount: budget,
            currency: paymentToken.symbol,
          },
        escrow: { status: "open" },
      });
      localJobId = pendingJob.id;
      let jobState = pendingJob;
      let resumeMode: HireResumeMode | undefined;
      let fundingConfirmed = false;
      let onchainJobId = pendingJob.onchainJobId;
      if (!existingJob) {
        await createRemoteJob(pendingJob);
        const description = JSON.stringify({
          marketplace: "BNB Agent Studio",
          marketplaceJobId: pendingJob.id,
          marketplaceAgentId: pendingJob.agentId,
          agentId: agent.identity.agentId,
          client: wallet.account,
          task: task.trim(),
          category: selectedCategory,
          termsHash,
        });

        setHireStage("creating");
        const created = await createERC8183Job({
          walletClient: wallet.walletClient,
          publicClient: wallet.publicClient,
          account: wallet.account,
          provider: agent.identity.ownerAddress as `0x${string}`,
          evaluator,
          expiredAt,
          description,
          hookAddress: ercConfig.routerAddress,
          permission,
        });
        onchainJobId = created.jobId;
        setCreatedJobId(created.jobId);

        updateLocalJob(pendingJob.id, { onchainJobId: created.jobId });
        jobState = await reconcileRemoteJob(pendingJob.id, {
          onchainJobId: created.jobId,
          transactionHash: created.transactionHash,
          transactionEvent: "creation",
        });

        setHireStage("registering");
        const registered = await registerERC8183Job({
          walletClient: wallet.walletClient,
          publicClient: wallet.publicClient,
          account: wallet.account,
          jobId: BigInt(created.jobId),
          permission,
        });
        jobState = await reconcileRemoteJob(pendingJob.id, {
          transactionHash: registered.transactionHash,
          transactionEvent: "registration",
        });
      } else {
        if (!onchainJobId) throw new Error("The saved job has no on chain job ID.");
        setCreatedJobId(onchainJobId);
        const pendingFundingHash = pendingJob.escrow?.pendingFundingTransactionHash;
        let reconciled;
        try {
          reconciled = await reconcileRemoteJob(
            pendingJob.id,
            pendingFundingHash
              ? { transactionHash: pendingFundingHash, transactionEvent: "funding" }
              : undefined,
          );
        } catch (error) {
          if (pendingFundingHash) {
            throw new Error(`A funding transaction is already broadcast but not confirmed. Verify it before retrying: ${pendingFundingHash}`);
          }
          throw error;
        }
        resumeMode = getHireResumeMode(reconciled);
        fundingConfirmed = reconciled.escrow?.status === "funded";
        if (!resumeMode && !fundingConfirmed) {
          throw new Error("The saved job is no longer ready for payment and funding.");
        }
        jobState = reconciled;
      }
      if (!onchainJobId) throw new Error("The ERC 8183 job ID is missing.");

      if (!fundingConfirmed && !jobState.escrow?.budgetTransactionHash) {
        setHireStage("budget");
        const budgetTransaction = await setERC8183Budget({
          walletClient: wallet.walletClient,
          publicClient: wallet.publicClient,
          account: wallet.account,
          jobId: BigInt(onchainJobId),
          amount,
          permission,
          tokenAddress: paymentToken.address,
          tokenDecimals: paymentToken.decimals,
        });
        jobState = await reconcileRemoteJob(pendingJob.id, {
          transactionHash: budgetTransaction.transactionHash,
          transactionEvent: "budget",
        });
      }
      if (!fundingConfirmed) {
        await ensureERC20Allowance({
          walletClient: wallet.walletClient,
          publicClient: wallet.publicClient,
          account: wallet.account,
          spender: ercConfig.contractAddress as `0x${string}`,
          amount,
          approvalAmount,
          tokenAddress: paymentToken.address,
          permission,
          tokenDecimals: paymentToken.decimals,
        });
      }

      let paidPayment = jobState.payment?.status === "paid" ? jobState.payment : undefined;
      if (!fundingConfirmed && !paidPayment) {
        setHireStage("payment");
        const expected = {
          // x402 binds to the durable marketplace job. The ERC 8183 numeric ID
          // is stored separately as onchainJobId and is not the database key.
          jobId: pendingJob.id,
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
        const settlement = await settleX402Payment({
          wallet,
          publicClient: wallet.publicClient,
          paymentRequired: challenge.paymentRequired,
          verification,
          expected,
          permission,
          tokenDecimals: paymentToken.decimals,
          currency: paymentToken.symbol,
          spentAmountAtomic: BigInt(0),
          approvalAmount,
        });
        if (settlement.status !== "paid") throw new Error(settlement.reason ?? "The x402 payment was not settled.");
        paidPayment = {
          protocol: "x402",
          status: "paid",
          amount: budget,
          currency: paymentToken.symbol,
          receiptId: settlement.receiptId,
          transactionHash: settlement.transactionHash,
          paidAt: new Date().toISOString(),
        };
        const paidJob = updateLocalJob(pendingJob.id, { payment: paidPayment });
        if (paidJob && !settlement.serverRecorded) await updateRemoteJob(pendingJob.id, { payment: paidJob.payment });
      } else if (!fundingConfirmed && resumeMode === "funding-only") {
        setHireStage("funding");
      }
      if (!fundingConfirmed) {
        if (!paidPayment) throw new Error("The job payment could not be verified before funding.");

        setHireStage("funding");
        const funded = await fundERC8183Job({
          walletClient: wallet.walletClient,
          publicClient: wallet.publicClient,
          account: wallet.account,
          jobId: BigInt(onchainJobId),
          amount,
          permission,
          tokenAddress: paymentToken.address,
          tokenDecimals: paymentToken.decimals,
          spentAmountAtomic: amount,
          onTransactionBroadcast: async (hash) => {
            updateLocalJob(pendingJob.id, {
              escrow: {
                ...(jobState.escrow ?? { status: "open" }),
                pendingFundingTransactionHash: hash,
                pendingFundingAt: new Date().toISOString(),
              },
            });
            await recordFundingBroadcastRemoteJob(pendingJob.id, hash);
          },
        });
        const activeJob = updateLocalJob(pendingJob.id, {
          status: "active",
          payment: paidPayment,
        });
        const reconciledJob = await reconcileRemoteJob(pendingJob.id, {
          transactionHash: funded.transactionHash,
          transactionEvent: "funding",
        });
        if (activeJob) {
          updateLocalJob(pendingJob.id, {
            status: reconciledJob.status,
            payment: reconciledJob.payment ?? activeJob.payment,
            escrow: reconciledJob.escrow,
            statusHistory: reconciledJob.statusHistory,
          });
        }
      }
      setHireStage("starting");
      try {
        const startedJob = await executeRemoteJob(pendingJob.id);
        updateLocalJob(pendingJob.id, {
          status: startedJob.status,
          resultSummary: startedJob.resultSummary,
          resultUri: startedJob.resultUri,
          execution: startedJob.execution,
          escrow: startedJob.escrow,
          statusHistory: startedJob.statusHistory,
        });
      } catch (executionError) {
        const startMessage = executionError instanceof Error ? executionError.message : "The agent could not start.";
        setError(`The job is funded, but the agent did not start. ${startMessage} Open the job page to retry.`);
      }
      router.push(`/jobs/${pendingJob.id}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The hire could not be submitted.";
      setError(message);
      if (localJobId) {
        if (existingJob || caught instanceof ERC8183TransactionError) {
          updateLocalJob(localJobId, { status: "pending" });
        } else {
          updateLocalJob(localJobId, { status: "failed" });
          const failedJob = appendLocalStatus(localJobId, "failed", message);
          if (failedJob) {
            try {
              await updateRemoteJob(localJobId, {
                status: failedJob.status,
                statusHistory: failedJob.statusHistory,
              });
            } catch {
              // Keep the local failure visible when the server is unavailable.
            }
          }
        }
      }
    } finally {
      setBusy(false);
      setHireStage(undefined);
    }
  }

  if (process.env.NEXT_PUBLIC_QUICK_HIRE !== "false") {
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
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Quick hire</p>
            <h1 className="mt-4 text-4xl font-semibold leading-none tracking-tight text-wrap-balance sm:text-6xl">Hire and run an agent in one click</h1>
            <p className="mt-6 text-lg leading-7 text-muted text-wrap-pretty">Describe the task once. Plow checks the agent, creates and funds the escrow, verifies x402 payment, then starts the agent for you.</p>
          </section>

          {!agent ? (
            <div className="mt-8">
              <PreviewNotice danger>
                Agent <span className="font-mono">{agentId}</span> is not connected to the verified registry. No wallet action is available.
              </PreviewNotice>
            </div>
          ) : null}

          {resumeJob ? <div className="mt-8"><PreviewNotice>Resuming open on chain job <span className="font-mono">{resumeJob.onchainJobId}</span>. No new job will be created.</PreviewNotice></div> : null}

          {agent && !identityReady ? (
            <div className="mt-8">
              <PreviewNotice danger>
                This agent is not eligible for real hiring. Only a live, verified ERC 8004 identity with an on chain provider address can receive a job. Demo agents stay local only.
              </PreviewNotice>
            </div>
          ) : null}

          {agent && identityReady && !serviceReady ? (
            <div className="mt-8">
              <PreviewNotice danger>
                {agent.hiring.reason ?? "Pricing, freshness, and execution checks are required before hiring."} Demo and unverified service records stay in preview mode.
              </PreviewNotice>
            </div>
          ) : null}

          {agent && identityReady && serviceReady && jobPersistenceReady === false ? (
            <div className="mt-8">
              <PreviewNotice danger>
                Durable job storage is unavailable. Set DATABASE_URL and apply db/001_jobs.sql before live hiring. The final wallet transaction stays disabled until the pending server record can be written.
              </PreviewNotice>
            </div>
          ) : null}

          <div className="mt-8">
            <SetupChecklist status={setup} compact />
          </div>

          <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_23rem] lg:items-start">
            <section className="rounded-3xl border border-surface-border bg-surface p-5 sm:p-8">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-black text-brand"><NotePencil size={21} /></span>
                <div>
                  <h2 className="text-2xl font-semibold">Start a task</h2>
                  <p className="mt-2 text-sm leading-6 text-muted">The button below runs the complete safe path. You will still approve the wallet requests required by the chain.</p>
                </div>
              </div>

              <label className="mt-8 block text-sm font-semibold" htmlFor="task">Task description
                <textarea id="task" value={task} onChange={(event) => setTask(event.target.value)} rows={7} placeholder={taskPlaceholder} className="mt-3 w-full resize-y rounded-2xl border border-surface-border bg-black px-4 py-3 text-sm leading-6 text-foreground outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand" />
              </label>
              {selectedCategory === "health-factor-monitoring" ? <p className="mt-3 text-xs leading-5 text-muted">Include “account 0x...” or “borrower 0x...” to monitor a specific public position. Otherwise the connected wallet is checked.</p> : null}
              {attempted && !task.trim() ? <p className="mt-2 text-sm text-negative">Add a task description before continuing.</p> : null}

              {supportedCategories.length > 1 ? <label className="mt-5 block text-sm font-semibold" htmlFor="category">Strategy category
                <select id="category" value={selectedCategory ?? ""} onChange={(event) => setCategorySelection(event.target.value as AgentCategory)} className="mt-2 min-h-11 w-full rounded-2xl border border-surface-border bg-black px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand">
                  {supportedCategories.map((supportedCategory) => <option key={supportedCategory} value={supportedCategory}>{getCategoryDefinition(supportedCategory)?.label ?? supportedCategory}</option>)}
                </select>
                <span className="mt-2 block text-xs font-normal text-muted">This category is written into the job terms and sent to the provider.</span>
              </label> : null}

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold" htmlFor="budget">Approved budget <span className="font-normal text-muted">{currency}</span>
                  <input id="budget" value={budget} onChange={(event) => setBudget(event.target.value)} inputMode="decimal" placeholder="Required for an on chain job" className="mt-2 w-full rounded-2xl border border-surface-border bg-black px-4 py-3 font-mono text-sm outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand" />
                </label>
                <label className="block text-sm font-semibold" htmlFor="expiration">Expiration
                  <select id="expiration" value={expiration} onChange={(event) => setExpiration(event.target.value)} className="mt-2 min-h-11 w-full rounded-2xl border border-surface-border bg-black px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand">{EXPIRATION_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select>
                </label>
              </div>

              <div className="mt-5">
                <TokenApprovalOption
                  enabled={reuseTokenApproval}
                  onEnabledChange={setReuseTokenApproval}
                  reserve={approvalReserve}
                  onReserveChange={setApprovalReserve}
                  budget={budget}
                  currency={currency}
                />
              </div>

              <details className="mt-6 rounded-2xl border border-surface-border bg-black px-4">
                <summary className="cursor-pointer py-4 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand">Advanced settings</summary>
                <div className="space-y-5 border-t border-surface-border pb-5 pt-5">
                  <label className="block text-sm font-semibold" htmlFor="spend-cap">Spend cap <span className="font-normal text-muted">in {currency}</span>
                    <input id="spend-cap" value={spendCap} onChange={(event) => setSpendCap(event.target.value)} placeholder={budget ? `Auto: ${twiceAmount(budget) || "2 × budget"}` : "Auto after budget"} className="mt-2 w-full rounded-2xl border border-surface-border bg-surface px-4 py-3 font-mono text-sm outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand" />
                  </label>
                  <label className="block text-sm font-semibold" htmlFor="allowlist">Extra contracts <span className="font-normal text-muted">comma separated</span>
                    <input id="allowlist" value={allowlist} onChange={(event) => setAllowlist(event.target.value)} placeholder="Configured contracts are included automatically" className="mt-2 w-full rounded-2xl border border-surface-border bg-surface px-4 py-3 font-mono text-sm outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand" />
                  </label>
                  <label className="block text-sm font-semibold" htmlFor="allowlisted-tokens">Extra tokens <span className="font-normal text-muted">comma separated</span>
                    <input id="allowlisted-tokens" value={allowlistedTokens} onChange={(event) => setAllowlistedTokens(event.target.value)} placeholder="Configured payment token is included automatically" className="mt-2 w-full rounded-2xl border border-surface-border bg-surface px-4 py-3 font-mono text-sm outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand" />
                  </label>
                  <AltanaPermissionPanel permission={permissionPreview} />
                </div>
              </details>

              <div className="mt-6 rounded-2xl border border-surface-border bg-black p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-brand"><Check size={16} weight="bold" />The one click path</div>
                <p className="mt-3 text-sm leading-6 text-muted">Plow creates the job, registers the evaluator, prepares the budget, verifies and settles x402, funds escrow, and starts the agent automatically. A new job still needs separate on chain create and funding transactions. x402 wallet signatures are not transactions.</p>
                <ol className="mt-4 grid gap-2 text-xs text-muted sm:grid-cols-2">
                  <li>1. Check agent and wallet</li>
                  <li>2. Create and register escrow</li>
                  <li>3. Verify and settle payment</li>
                  <li>4. Fund and start the agent</li>
                </ol>
              </div>

              <div className="mt-6 rounded-2xl border border-[#9a843c] bg-[#211d0d] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#e8d995]"><ShieldCheck size={16} />No funds sandbox</div>
                <p className="mt-3 text-sm leading-6 text-[#e8d995]">Test the complete hire story locally while you get the configured payment token. This creates a browser only simulation and makes no wallet, payment, database, provider, or blockchain request.</p>
                <button type="button" onClick={runSandboxSimulation} disabled={!agent || !task.trim() || sandboxBusy} className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[#9a843c] px-4 py-2 text-sm font-semibold text-[#e8d995] transition-colors hover:bg-[#302810] disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand">{sandboxBusy ? "Starting simulation" : "Run no funds simulation"} <Play size={16} weight="fill" /></button>
              </div>

              {!ercConfig.enabled ? <div className="mt-6"><PreviewNotice danger>{ercConfig.reason}</PreviewNotice></div> : null}
              {ercConfig.enabled && !x402Config.enabled ? <div className="mt-6"><PreviewNotice danger>{x402Config.reason}</PreviewNotice></div> : null}
              {ercConfig.enabled && x402Config.enabled && !combinedSettlementEnabled ? <div className="mt-6"><PreviewNotice danger>Real hiring is locked until the deployment owner enables the tested combined settlement flag.</PreviewNotice></div> : null}
              {agent?.mode === "demo" ? <div className="mt-6"><PreviewNotice danger>Demo agents cannot be hired on chain.</PreviewNotice></div> : null}
              {error ? <div className="mt-6 flex items-start gap-2 rounded-2xl border border-[#ad6565] bg-[#281313] px-4 py-3 text-sm leading-6 text-[#f0b4b4]" role="alert"><WarningCircle size={18} className="mt-1 shrink-0" />{error}</div> : null}

              <div className="mt-8 flex flex-col gap-3 border-t border-surface-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={saveLocalDraft} disabled={!agent || !task.trim() || busy || sandboxBusy} className="inline-flex min-h-11 items-center justify-center rounded-full border border-surface-border px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-[#6a6a6a] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand">Save as draft</button>
                <button type="button" onClick={submitRealHire} disabled={!canSubmit || sandboxBusy} aria-busy={busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-semibold text-black transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#ffd34f] active:translate-y-px disabled:cursor-not-allowed disabled:bg-[#5a5230] disabled:text-[#b9ae7b] focus:outline-none focus:ring-2 focus:ring-brand">{busy ? HIRE_STAGE_LABELS[hireStage ?? "checking"] : "Hire and run task"} <Check size={17} weight="bold" /></button>
              </div>
              <p className="mt-3 text-center text-xs text-muted sm:text-right">The agent starts automatically after funding.</p>
            </section>

            <aside className="order-first rounded-3xl border border-surface-border bg-surface p-4 lg:order-none lg:sticky lg:top-6 lg:p-5">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Quick path summary</p>
              <div className="mt-5 flex items-start gap-3">
                <span className="flex size-10 items-center justify-center rounded-2xl bg-black text-brand"><Fingerprint size={20} /></span>
                <div><p className="text-sm font-semibold">{agent?.name ?? "Agent not connected"}</p><p className="mt-1 font-mono text-xs text-muted">{agent?.identity.agentId ?? agentId}</p></div>
              </div>
              <dl className="mt-6 border-y border-surface-border py-2">
                <SummaryRow label="Category" value={category?.label ?? "Category pending"} />
                <SummaryRow label="Budget" value={`${budget || "Not set"} ${currency}`} />
                <SummaryRow label="Spend cap" value={permissionPreview.spendCap} />
                <SummaryRow label="Token approval" value={reuseTokenApproval ? `Reusable up to ${approvalReserve || fourTimesAmount(budget) || "reserve not set"} ${currency}` : "Exact amount when needed"} />
                <SummaryRow label="Wallet actions" value="Four job transactions. Two approval transactions only when needed." />
                <SummaryRow label="Network" value={`${ercConfig.networkName}, chain ${ercConfig.chainId}`} />
                <SummaryRow label="Wallet" value={walletAddress ?? "Connected at start"} />
                <SummaryRow label="Status" value={busy ? HIRE_STAGE_LABELS[hireStage ?? "checking"] : createdJobId ? `On chain ${createdJobId}` : "Ready when checks pass"} />
              </dl>
              <div className="mt-5 rounded-2xl border border-surface-border bg-black p-4">
                <div className="flex items-center gap-2 text-xs text-muted"><ShieldCheck size={16} className="text-brand" /> Safe defaults</div>
                <p className="mt-3 text-sm leading-6 text-muted">The configured contracts and payment token are allowlisted automatically. The default cap covers the x402 payment and escrow funding. Reuse a bounded token approval above to avoid approval prompts on later jobs.</p>
              </div>
              <div className="mt-5 flex items-start gap-2 text-xs leading-5 text-muted"><Clock size={15} className="mt-0.5 shrink-0 text-brand" /> {busy ? "Working through the verified transaction sequence." : "No wallet request is made until the main action is enabled."}</div>
            </aside>
          </div>
        </main>
      </div>
    );
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

        {agent && identityReady && !serviceReady ? (
          <PreviewNotice danger>
            {agent.hiring.reason ?? "Pricing, freshness, and execution checks are required before hiring."} Demo and unverified service records stay in preview mode.
          </PreviewNotice>
        ) : null}

        {agent && identityReady && serviceReady && jobPersistenceReady === false ? (
          <PreviewNotice danger>
            Durable job storage is unavailable. Set DATABASE_URL and apply db/001_jobs.sql before live hiring. The final wallet transaction stays disabled until the pending server record can be written.
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
                  <textarea id="task" value={task} onChange={(event) => setTask(event.target.value)} rows={7} placeholder={taskPlaceholder} className="mt-3 w-full resize-y rounded-2xl border border-surface-border bg-black px-4 py-3 text-sm leading-6 text-foreground outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand" />
                  {selectedCategory === "health-factor-monitoring" ? <p className="mt-3 text-xs leading-5 text-muted">Include “account 0x...” or “borrower 0x...” to monitor a specific public position. Otherwise the connected wallet is checked.</p> : null}
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
                  <p className="mt-3 text-sm leading-6 text-muted">Define the smallest permission scope the job may need. Plow checks the spend cap, expiration, and allowlists before every wallet transaction. The x402 payment and ERC 8183 escrow are separate spends, so the cap must cover both.</p>
                  <div className="mt-8 space-y-5">
                    <label className="block text-sm font-semibold" htmlFor="spend-cap">Spend cap <span className="font-normal text-muted">in {currency}</span><input id="spend-cap" value={spendCap} onChange={(event) => setSpendCap(event.target.value)} placeholder={budget ? "At least twice the budget" : "Set a maximum"} className="mt-2 w-full rounded-2xl border border-surface-border bg-black px-4 py-3 font-mono text-sm outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand" /></label>
                    <label className="block text-sm font-semibold" htmlFor="allowlist">Allowlisted contracts <span className="font-normal text-muted">comma separated</span><input id="allowlist" value={allowlist} onChange={(event) => setAllowlist(event.target.value)} placeholder="No contracts added" className="mt-2 w-full rounded-2xl border border-surface-border bg-black px-4 py-3 font-mono text-sm outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand" /></label>
                    <label className="block text-sm font-semibold" htmlFor="allowlisted-tokens">Allowlisted tokens <span className="font-normal text-muted">comma separated</span><input id="allowlisted-tokens" value={allowlistedTokens} onChange={(event) => setAllowlistedTokens(event.target.value)} placeholder="No tokens added" className="mt-2 w-full rounded-2xl border border-surface-border bg-black px-4 py-3 font-mono text-sm outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand" /></label>
                    <label className="block text-sm font-semibold" htmlFor="expiration">Expiration<select id="expiration" value={expiration} onChange={(event) => setExpiration(event.target.value)} className="mt-2 min-h-11 w-full rounded-2xl border border-surface-border bg-black px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand">{EXPIRATION_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
                    <TokenApprovalOption
                      enabled={reuseTokenApproval}
                      onEnabledChange={setReuseTokenApproval}
                      reserve={approvalReserve}
                      onReserveChange={setApprovalReserve}
                      budget={budget}
                      currency={currency}
                    />
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
                  <p className="mt-3 text-sm leading-6 text-muted">The real path creates the job, sets the ERC 8183 budget, verifies and settles x402, approves the payment token if needed, then funds the job. A reusable reserve removes approval prompts after the first approval, but the required job transactions remain. x402 wallet signatures are not transactions.</p>
                  <div className="mt-8 space-y-3">
                    <SummaryRow label="Agent" value={agent?.name ?? "Agent not connected"} />
                    <SummaryRow label="Task" value={task || "Task not defined"} />
                    <SummaryRow label="Budget" value={`${budget || "Not set"} ${currency}`} />
                    <SummaryRow label="Permission cap" value={permissionPreview.spendCap} />
                    <SummaryRow label="Token approval" value={reuseTokenApproval ? `Reusable up to ${approvalReserve || fourTimesAmount(budget) || "reserve not set"} ${currency}` : "Exact amount when needed"} />
                    <SummaryRow label="Wallet actions" value="Four job transactions. Two approval transactions only when needed." />
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
                {step < STEPS.length - 1 ? <button type="button" onClick={nextStep} disabled={busy || sandboxBusy} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-black transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#ffd34f] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand">Continue <ArrowRight size={16} /></button> : <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row"><button type="button" onClick={runSandboxSimulation} disabled={!agent || !task.trim() || busy || sandboxBusy} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-[#9a843c] px-4 py-2 text-sm font-semibold text-[#e8d995] transition-colors hover:bg-[#211d0d] disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand sm:w-auto">{sandboxBusy ? "Starting simulation" : "Run no funds simulation"} <Play size={16} weight="fill" /></button><button type="button" onClick={saveLocalDraft} disabled={!agent || !task.trim() || busy || sandboxBusy} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-surface-border px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-[#6a6a6a] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand sm:w-auto">Save local draft</button><button type="button" onClick={submitRealHire} disabled={!canSubmit || sandboxBusy} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-black transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#ffd34f] active:translate-y-px disabled:cursor-not-allowed disabled:bg-[#5a5230] disabled:text-[#b9ae7b] focus:outline-none focus:ring-2 focus:ring-brand sm:w-auto">{busy ? "Submitting" : "Connect wallet and submit"} <Check size={16} weight="bold" /></button></div>}
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
