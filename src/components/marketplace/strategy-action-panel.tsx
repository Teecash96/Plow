"use client";

import { BellRinging, CheckCircle, FloppyDisk, SpinnerGap, SquaresFour, WarningCircle } from "@phosphor-icons/react";
import { isAddress } from "viem";
import { useState, type FormEvent } from "react";
import { recordRemoteStrategyAction } from "@/lib/marketplace/job-api";
import { updateLocalJob } from "@/lib/marketplace/job-store";
import type { Job } from "@/lib/marketplace/types";

interface StrategyActionPanelProps {
  job: Job;
  onJobChange?: (job: Job) => void;
}

function inputClass() {
  return "mt-2 block w-full rounded-2xl border border-surface-border bg-black px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand";
}

export function StrategyActionPanel({ job, onJobChange }: StrategyActionPanelProps) {
  if (job.category === "rebalancing" || job.category === "uncategorised") return null;

  return <StrategyActionPanelContent job={job} onJobChange={onJobChange} />;
}

function StrategyActionPanelContent({ job, onJobChange }: StrategyActionPanelProps) {
  const actionKind = job.category === "grid-trading" ? "grid-plan" : job.category === "yield-optimisation" ? "yield-route" : "health-monitor";
  const [levels, setLevels] = useState("5");
  const [bandPercent, setBandPercent] = useState("10");
  const [vaultName, setVaultName] = useState("Top route from provider result");
  const [vaultAddress, setVaultAddress] = useState("");
  const [assetSymbol, setAssetSymbol] = useState("");
  const [accountAddress, setAccountAddress] = useState(isAddress(job.clientAddress) ? job.clientAddress : "");
  const [alertThreshold, setAlertThreshold] = useState("1.2");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const action = job.strategyAction;
  const eligible = job.mode !== "simulation"
    && job.status === "active"
    && Boolean(job.onchainJobId)
    && job.payment?.status === "paid"
    && job.permission?.status === "active";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !eligible) return;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const input = actionKind === "grid-plan"
        ? { kind: "grid-plan" as const, levels: Number(levels), bandPercent }
        : actionKind === "yield-route"
          ? { kind: "yield-route" as const, vaultName, ...(vaultAddress.trim() ? { vaultAddress: vaultAddress.trim() } : {}), ...(assetSymbol.trim() ? { assetSymbol: assetSymbol.trim() } : {}) }
          : { kind: "health-monitor" as const, accountAddress, alertThreshold };
      const nextJob = await recordRemoteStrategyAction(job.id, input);
      updateLocalJob(nextJob.id, { strategyAction: nextJob.strategyAction });
      onJobChange?.(nextJob);
      setMessage("Action intent saved. No order, deposit, withdrawal, repayment, or other fund movement was sent.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The strategy action could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const title = job.category === "grid-trading" ? "Bounded grid plan" : job.category === "yield-optimisation" ? "Yield route selection" : "Health factor monitor";
  const description = job.category === "grid-trading"
    ? "Save the exact levels and price band the agent proposed. This is a plan record only until an exchange connector is configured and separately approved."
    : job.category === "yield-optimisation"
      ? "Record the route you want to review. This does not deposit or withdraw funds. A vault address is optional for an evidence only plan."
      : "Arm a threshold monitor for one lending account. It records the alert policy and does not repay debt or move funds.";

  return (
    <section className="mt-12 rounded-3xl border border-surface-border bg-surface p-6 sm:p-8" aria-labelledby="strategy-action-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-black text-brand">{job.category === "health-factor-monitoring" ? <BellRinging size={21} /> : <SquaresFour size={21} />}</span>
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-brand">Strategy action</p>
            <h2 id="strategy-action-heading" className="mt-2 text-2xl font-semibold">{title}</h2>
          </div>
        </div>
        <span className="rounded-full border border-[#9a843c] bg-[#211d0d] px-3 py-1.5 text-xs font-semibold text-[#e8d995]">No automatic funds movement</span>
      </div>
      <p className="mt-5 max-w-3xl text-sm leading-6 text-muted">{description}</p>

      {!eligible ? <div className="mt-5 flex items-start gap-2 rounded-2xl border border-surface-border bg-black px-4 py-3 text-sm leading-6 text-muted" role="status"><WarningCircle size={18} className="mt-0.5 shrink-0 text-brand" />This action becomes available after the live job is active, paid, and bound to an active permission.</div> : null}
      {action ? <div className="mt-5 rounded-2xl border border-[#5a9876] bg-[#14281f] p-4" role="status"><div className="flex items-start gap-2 text-positive"><CheckCircle size={18} className="mt-0.5 shrink-0" /><div><p className="text-sm font-semibold">{action.status === "planned" ? "Grid plan saved" : action.status === "selected" ? "Yield route selected" : "Health monitor armed"}</p><p className="mt-2 text-sm leading-6">Saved at {new Date(action.createdAt).toLocaleString()}. This record is idempotent, so retrying will not create another action.</p></div></div></div> : null}

      {!action && eligible ? <form className="mt-6" onSubmit={submit}>
        {job.category === "grid-trading" ? <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold" htmlFor="grid-levels">Price levels<input id="grid-levels" className={inputClass()} type="number" min={2} max={20} step={1} value={levels} onChange={(event) => setLevels(event.target.value)} /></label><label className="block text-sm font-semibold" htmlFor="grid-band">Band percent<input id="grid-band" className={inputClass()} type="number" min={1} max={50} step="0.01" value={bandPercent} onChange={(event) => setBandPercent(event.target.value)} /></label></div> : null}
        {job.category === "yield-optimisation" ? <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold" htmlFor="yield-route-name">Route name<input id="yield-route-name" className={inputClass()} value={vaultName} maxLength={100} onChange={(event) => setVaultName(event.target.value)} /></label><label className="block text-sm font-semibold" htmlFor="yield-asset-symbol">Asset symbol <span className="font-normal text-muted">optional</span><input id="yield-asset-symbol" className={inputClass()} value={assetSymbol} maxLength={24} onChange={(event) => setAssetSymbol(event.target.value)} placeholder="USDC" /></label><label className="block text-sm font-semibold sm:col-span-2" htmlFor="yield-vault-address">Vault address <span className="font-normal text-muted">optional evidence reference</span><input id="yield-vault-address" className={inputClass()} value={vaultAddress} onChange={(event) => setVaultAddress(event.target.value)} placeholder="0x..." /></label></div> : null}
        {job.category === "health-factor-monitoring" ? <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold sm:col-span-2" htmlFor="health-account">Account to monitor<input id="health-account" className={inputClass()} value={accountAddress} onChange={(event) => setAccountAddress(event.target.value)} placeholder="0x..." /></label><label className="block text-sm font-semibold" htmlFor="health-threshold">Alert below<input id="health-threshold" className={inputClass()} value={alertThreshold} onChange={(event) => setAlertThreshold(event.target.value)} inputMode="decimal" /></label></div> : null}
        <button type="submit" disabled={busy} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-black hover:bg-[#ffd34f] disabled:cursor-not-allowed disabled:opacity-50">{busy ? <SpinnerGap size={17} className="animate-spin" /> : <FloppyDisk size={17} />}{busy ? "Saving action" : "Save bounded action"}</button>
      </form> : null}
      {message ? <p className="mt-4 text-sm leading-6 text-positive" role="status">{message}</p> : null}
      {error ? <p className="mt-4 text-sm leading-6 text-warning" role="alert">{error}</p> : null}
    </section>
  );
}
