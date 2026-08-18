"use client";

import { CheckCircle, Circle, WarningCircle } from "@phosphor-icons/react";
import type { HireSetupStatus } from "@/lib/marketplace/hire-setup";

export function SetupChecklist({ status, compact = false }: { status: HireSetupStatus; compact?: boolean }) {
  return (
    <section className={`rounded-3xl border ${status.ready ? "border-[#5a9876] bg-[#14281f]" : "border-surface-border bg-surface"} ${compact ? "p-5" : "p-6 sm:p-8"}`} aria-labelledby="hire-setup-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Setup status</p>
          <h2 id="hire-setup-heading" className="mt-3 text-xl font-semibold">{status.ready ? "Live hiring is ready" : "Live hiring is blocked"}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{status.ready ? `All required checks passed for ${status.networkName}.` : `${status.blocked.length} required check${status.blocked.length === 1 ? "" : "s"} still need attention. No payment is accepted while a required check is blocked.`}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${status.ready ? "border-[#4f8569] text-positive" : "border-[#ad6565] text-negative"}`}>{status.ready ? "Ready" : "Blocked"}</span>
      </div>
      <ul className={`mt-6 grid gap-3 ${compact ? "sm:grid-cols-2" : "md:grid-cols-2"}`}>
        {status.checks.map((check) => {
          const Icon = check.state === "ready" ? CheckCircle : check.state === "blocked" ? WarningCircle : Circle;
          return (
            <li key={check.key} className="flex items-start gap-3 rounded-2xl border border-surface-border bg-black/30 px-4 py-3">
              <Icon size={18} weight={check.state === "optional" ? "regular" : "fill"} className={check.state === "ready" ? "mt-0.5 shrink-0 text-positive" : check.state === "blocked" ? "mt-0.5 shrink-0 text-negative" : "mt-0.5 shrink-0 text-muted"} />
              <div className="min-w-0"><p className="text-sm font-semibold">{check.label}{check.state === "optional" ? <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Optional</span> : null}</p><p className="mt-1 text-xs leading-5 text-muted">{check.detail}</p></div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
