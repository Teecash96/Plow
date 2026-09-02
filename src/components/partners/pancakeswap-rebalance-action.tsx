"use client";

import { CheckCircle, LockKey, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { formatUnits } from "viem";
import { useMemo, useState } from "react";
import { connectBscWallet } from "@/lib/chain/erc8183-adapter";
import {
  quotePancakeSwapRebalance,
  quotePancakeSwapRebalanceAtomic,
  executePancakeSwapRebalance,
  getPancakeSwapRebalanceConfig,
  PancakeSwapRebalanceError,
  type PancakeSwapRebalanceQuote,
} from "@/lib/chain/pancakeswap-rebalance";
import {
  recordRemotePancakeSwapAction,
  reserveRemotePancakeSwapAction,
} from "@/lib/marketplace/job-api";
import { updateLocalJob } from "@/lib/marketplace/job-store";
import type { Job } from "@/lib/marketplace/types";

interface PancakeSwapRebalanceActionProps {
  job: Job;
  onJobChange?: (job: Job) => void;
}

function displayAmount(value: bigint, decimals: number) {
  try {
    return formatUnits(value, decimals);
  } catch {
    return "Unavailable";
  }
}

function actionStatusText(job: Job) {
  const action = job.fundMovingAction;
  if (!action) return undefined;
  if (action.status === "reserved") return "Reserved. No second action can start for this job.";
  if (action.status === "approval-submitted") return "The exact token approval is pending. Do not submit another approval.";
  if (action.status === "swap-submitted") return "The swap is broadcast. Wait for its receipt before taking any further action.";
  if (action.status === "confirmed") return "The bounded rebalance is confirmed.";
  return `The previous reservation was released. ${action.failureReason ?? "You can request a new quote."}`;
}

export function PancakeSwapRebalanceAction({ job, onJobChange }: PancakeSwapRebalanceActionProps) {
  const config = useMemo(() => getPancakeSwapRebalanceConfig(), []);
  const [amountIn, setAmountIn] = useState("");
  const [quote, setQuote] = useState<PancakeSwapRebalanceQuote>();
  const [busy, setBusy] = useState<"quote" | "execute" | "release">();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  const action = job.fundMovingAction;
  const eligible = job.mode !== "simulation"
    && job.status === "active"
    && Boolean(job.onchainJobId)
    && job.payment?.status === "paid"
    && job.permission?.status === "active";
  const explorerHost = job.onchainNetwork === "BSC Testnet" ? "https://testnet.bscscan.com" : "https://bscscan.com";
  const hasTransaction = action?.transactionHash;

  function applyJob(nextJob: Job) {
    updateLocalJob(nextJob.id, { fundMovingAction: nextJob.fundMovingAction });
    onJobChange?.(nextJob);
  }

  async function getQuote() {
    if (busy || !eligible || !job.permission || !amountIn.trim()) return;
    setBusy("quote");
    setError(undefined);
    setMessage(undefined);
    try {
      const wallet = await connectBscWallet();
      if (wallet.account.toLowerCase() !== job.clientAddress.toLowerCase()) throw new Error("Connect the wallet that created this job before quoting a rebalance.");
      const nextQuote = await quotePancakeSwapRebalance({ publicClient: wallet.publicClient, permission: job.permission, amountIn, account: wallet.account, config });
      setQuote(nextQuote);
      setMessage("Quote ready. Review the output, minimum received, slippage, and deadline before approving.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The PancakeSwap quote could not be loaded.");
    } finally {
      setBusy(undefined);
    }
  }

  async function execute() {
    if (busy || !eligible || !job.permission || !quote) return;
    setBusy("execute");
    setError(undefined);
    setMessage(undefined);
    try {
      const wallet = await connectBscWallet();
      if (wallet.account.toLowerCase() !== job.clientAddress.toLowerCase()) throw new Error("Connect the wallet that created this job before approving a rebalance.");
      const freshQuote = await quotePancakeSwapRebalanceAtomic({ publicClient: wallet.publicClient, permission: job.permission, amountInAtomic: quote.amountInAtomic, account: wallet.account, config });
      if (freshQuote.quotedAmountOutAtomic !== quote.quotedAmountOutAtomic
        || freshQuote.minimumAmountOutAtomic !== quote.minimumAmountOutAtomic
        || freshQuote.tokenIn.address.toLowerCase() !== quote.tokenIn.address.toLowerCase()
        || freshQuote.tokenOut.address.toLowerCase() !== quote.tokenOut.address.toLowerCase()) {
        throw new Error("The PancakeSwap quote changed. Refresh the quote before approving a wallet transaction.");
      }

      const reservedJob = await reserveRemotePancakeSwapAction(job.id, {
        kind: "pancakeswap-rebalance",
        chainId: freshQuote.chainId,
        routerAddress: freshQuote.routerAddress,
        tokenInAddress: freshQuote.tokenIn.address,
        tokenOutAddress: freshQuote.tokenOut.address,
        tokenInSymbol: freshQuote.tokenIn.symbol,
        tokenOutSymbol: freshQuote.tokenOut.symbol,
        tokenInDecimals: freshQuote.tokenIn.decimals,
        tokenOutDecimals: freshQuote.tokenOut.decimals,
        amountInAtomic: freshQuote.amountInAtomic.toString(),
        quotedAmountOutAtomic: freshQuote.quotedAmountOutAtomic.toString(),
        minimumAmountOutAtomic: freshQuote.minimumAmountOutAtomic.toString(),
        slippageBps: freshQuote.slippageBps,
        deadline: freshQuote.deadline.toString(),
        quotedAt: freshQuote.quotedAt,
      });
      applyJob(reservedJob);

      const result = await executePancakeSwapRebalance({
        wallet,
        permission: job.permission,
        quote: freshQuote,
        config,
        onApprovalSubmitted: async (hash) => {
          const approvalJob = await recordRemotePancakeSwapAction(job.id, { action: "approval-submitted", approvalTransactionHash: hash });
          applyJob(approvalJob);
        },
        onSwapSubmitted: async (hash, approvalHash) => {
          const swapJob = await recordRemotePancakeSwapAction(job.id, { action: "swap-submitted", transactionHash: hash, ...(approvalHash ? { approvalTransactionHash: approvalHash } : {}) });
          applyJob(swapJob);
        },
      });
      const confirmedJob = await recordRemotePancakeSwapAction(job.id, { action: "confirmed", transactionHash: result.transactionHash });
      applyJob(confirmedJob);
      setMessage("Rebalance confirmed. The input token moved through the configured PancakeSwap pair.");
    } catch (caught) {
      const rebalanceError = caught instanceof PancakeSwapRebalanceError ? caught : undefined;
      if (rebalanceError?.broadcastTransactionHash) {
        setError(`${rebalanceError.message} Check the transaction before doing anything else: ${explorerHost}/tx/${rebalanceError.broadcastTransactionHash}`);
      } else {
        setError(caught instanceof Error ? caught.message : "The PancakeSwap rebalance failed.");
      }
    } finally {
      setBusy(undefined);
    }
  }

  async function releaseReservation() {
    if (busy || !action || action.status !== "reserved" || action.approvalTransactionHash || action.transactionHash) return;
    setBusy("release");
    setError(undefined);
    try {
      const releasedJob = await recordRemotePancakeSwapAction(job.id, { action: "release", failureReason: "The wallet action was not started." });
      applyJob(releasedJob);
      setMessage("Unused reservation released. No wallet transaction was sent.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The reservation could not be released.");
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section className="mt-12 rounded-3xl border border-surface-border bg-surface p-6 sm:p-8" aria-labelledby="pancakeswap-rebalance-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-black text-brand"><LockKey size={21} /></span>
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-brand">PancakeSwap action</p>
            <h2 id="pancakeswap-rebalance-heading" className="mt-2 text-2xl font-semibold">Bounded token rebalance</h2>
          </div>
        </div>
        <span className="rounded-full border border-[#9a843c] bg-[#211d0d] px-3 py-1.5 text-xs font-semibold text-[#e8d995]">Approval required</span>
      </div>

      <p className="mt-5 max-w-3xl text-sm leading-6 text-muted">This action swaps one fixed ERC 20 pair through the configured PancakeSwap router. It uses the client wallet, an exact allowance, a fixed path, a five minute deadline, and a maximum configured slippage. It never sends native BNB and it never runs automatically after the agent result.</p>

      {!config.enabled ? <div className="mt-5 flex items-start gap-2 rounded-2xl border border-[#9a843c] bg-[#211d0d] px-4 py-3 text-sm leading-6 text-[#e8d995]" role="status"><WarningCircle size={18} className="mt-0.5 shrink-0" />{config.reason}</div> : null}
      {config.enabled && !eligible ? <div className="mt-5 flex items-start gap-2 rounded-2xl border border-surface-border bg-black px-4 py-3 text-sm leading-6 text-muted" role="status"><WarningCircle size={18} className="mt-0.5 shrink-0 text-brand" />This action becomes available only after this live rebalancing job is active, paid, and bound to an active permission.</div> : null}

      {config.enabled && eligible && action?.status === "confirmed" && action.transactionHash ? <div className="mt-5 rounded-2xl border border-[#5a9876] bg-[#14281f] p-4"><div className="flex items-start gap-2 text-positive"><CheckCircle size={18} className="mt-0.5 shrink-0" /><p className="text-sm leading-6">{actionStatusText(job)}</p></div><a href={`${explorerHost}/tx/${action.transactionHash}`} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-semibold text-brand hover:underline">View confirmed swap</a></div> : null}

      {config.enabled && eligible && action && action.status !== "confirmed" && action.status !== "failed" ? <div className="mt-5 rounded-2xl border border-[#9a843c] bg-[#211d0d] p-4"><p className="text-sm leading-6 text-[#e8d995]">{actionStatusText(job)}</p>{action.approvalTransactionHash ? <a href={`${explorerHost}/tx/${action.approvalTransactionHash}`} target="_blank" rel="noreferrer" className="mt-3 mr-4 inline-flex text-sm font-semibold text-brand hover:underline">View approval transaction</a> : null}{hasTransaction ? <a href={`${explorerHost}/tx/${hasTransaction}`} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-semibold text-brand hover:underline">View swap transaction</a> : null}{action.status === "reserved" && !action.approvalTransactionHash && !action.transactionHash ? <button type="button" onClick={releaseReservation} disabled={Boolean(busy)} className="mt-4 block min-h-10 rounded-full border border-surface-border px-3 py-2 text-xs font-semibold text-muted hover:border-[#6a6a6a] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50">{busy === "release" ? "Releasing" : "Release unused reservation"}</button> : null}</div> : null}

      {config.enabled && eligible && (!action || action.status === "failed") ? <div className="mt-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"><label className="block text-sm font-semibold" htmlFor="pancakeswap-rebalance-amount">Input amount <span className="font-normal text-muted">{config.paymentTokenAddress ? "in the configured payment token" : "in the configured input token"}</span><input id="pancakeswap-rebalance-amount" value={amountIn} onChange={(event) => { setAmountIn(event.target.value); setQuote(undefined); setError(undefined); }} inputMode="decimal" placeholder="0.00" className="mt-2 w-full rounded-2xl border border-surface-border bg-black px-4 py-3 font-mono text-sm outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand" /></label><button type="button" onClick={getQuote} disabled={Boolean(busy) || !amountIn.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-surface-border px-4 py-2 text-sm font-semibold text-muted hover:border-[#6a6a6a] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50">{busy === "quote" ? <SpinnerGap size={17} className="animate-spin" /> : null}{busy === "quote" ? "Loading quote" : "Get safe quote"}</button></div> : null}

      {quote && (!action || action.status === "failed") ? <div className="mt-6 rounded-2xl border border-surface-border bg-black p-4"><p className="text-xs uppercase tracking-[0.12em] text-muted">Review before wallet approval</p><dl className="mt-4 grid gap-3 sm:grid-cols-2"><div><dt className="text-xs text-muted">Pair</dt><dd className="mt-1 font-semibold">{quote.tokenIn.symbol} to {quote.tokenOut.symbol}</dd></div><div><dt className="text-xs text-muted">Input</dt><dd className="mt-1 font-mono text-sm">{displayAmount(quote.amountInAtomic, quote.tokenIn.decimals)} {quote.tokenIn.symbol}</dd></div><div><dt className="text-xs text-muted">Quoted output</dt><dd className="mt-1 font-mono text-sm">{displayAmount(quote.quotedAmountOutAtomic, quote.tokenOut.decimals)} {quote.tokenOut.symbol}</dd></div><div><dt className="text-xs text-muted">Minimum output</dt><dd className="mt-1 font-mono text-sm">{displayAmount(quote.minimumAmountOutAtomic, quote.tokenOut.decimals)} {quote.tokenOut.symbol}</dd></div><div><dt className="text-xs text-muted">Max slippage</dt><dd className="mt-1 font-mono text-sm">{(quote.slippageBps / 100).toFixed(2)}%</dd></div><div><dt className="text-xs text-muted">Deadline</dt><dd className="mt-1 font-mono text-sm">{new Date(Number(quote.deadline) * 1000).toLocaleTimeString()}</dd></div></dl><p className="mt-4 text-xs leading-5 text-muted">The wallet may show one exact approval and one swap confirmation. Nothing is sent until you approve each wallet prompt.</p><button type="button" onClick={execute} disabled={Boolean(busy)} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-black hover:bg-[#ffd34f] disabled:cursor-not-allowed disabled:opacity-50">{busy === "execute" ? <SpinnerGap size={17} className="animate-spin" /> : <LockKey size={17} />}{busy === "execute" ? "Waiting for wallet" : "Approve and rebalance"}</button></div> : null}

      {message ? <p className="mt-4 text-sm leading-6 text-positive" role="status">{message}</p> : null}
      {error ? <div className="mt-4 flex items-start gap-2 rounded-2xl border border-[#ad6565] bg-[#281313] px-4 py-3 text-sm leading-6 text-[#f0b4b4]" role="alert"><WarningCircle size={18} className="mt-0.5 shrink-0" />{error}</div> : null}
    </section>
  );
}
