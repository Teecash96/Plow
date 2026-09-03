"use client";

import {
  ArrowUpRight,
  CheckCircle,
  Clock,
  Fingerprint,
  Heartbeat,
  ShieldCheck,
} from "@phosphor-icons/react";
import { getCategoryDefinition } from "@/lib/marketplace/categories";
import { isAgentHireable, type Agent, type AgentCategory } from "@/lib/marketplace/types";

interface AgentCardProps {
  agent: Agent;
  selected?: boolean;
  onToggleCompare?: (agentId: string) => void;
}

function displayValue(value?: string | number) {
  return value === undefined || value === "" ? "Not enough data" : String(value);
}

export function AgentCard({ agent, selected = false, onToggleCompare }: AgentCardProps) {
  const category = getCategoryDefinition(agent.category);
  const primaryMetric = agent.categoryMetrics[0];
  const isHireable = isAgentHireable(agent);
  const isLiveVerified = agent.mode === "live" && agent.verified && agent.deployment.availability === "live";

  return (
    <article className="group flex min-h-[30rem] flex-col rounded-3xl border border-surface-border bg-surface p-4 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-1 hover:border-[#6a6a6a] hover:bg-surface-raised sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className={`inline-flex items-center gap-1.5 ${agent.verified ? "text-positive" : "text-warning"}`}>
              {agent.verified ? <CheckCircle size={14} weight="fill" /> : <Fingerprint size={14} />}
              {agent.verified ? `${agent.identity.standard} verified` : agent.mode === "live" ? `${agent.identity.standard} candidate` : `${agent.identity.standard} style ID`}
            </span>
            <span aria-hidden="true">·</span>
            <span>{category?.label ?? "Uncategorised"}</span>
          </div>
          <h2 className="mt-4 break-words text-2xl font-semibold tracking-tight text-wrap-balance">{agent.name}</h2>
          <p className="mt-1 break-all font-mono text-xs text-muted">{agent.id}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {agent.mode === "demo" ? <span className="inline-flex rounded-full border border-[#9a843c] bg-[#211d0d] px-2.5 py-1 text-xs font-semibold text-[#e8d995]">Demo fixture</span> : isLiveVerified ? <span className="inline-flex rounded-full border border-[#5a9876] bg-[#10261c] px-2.5 py-1 text-xs font-semibold text-positive">Live on BSC</span> : <span className="inline-flex rounded-full border border-[#9a843c] bg-[#211d0d] px-2.5 py-1 text-xs font-semibold text-warning">Registry candidate</span>}
            {agent.listingMode === "independent" ? <span className="inline-flex rounded-full border border-brand/50 bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand">Independent listing</span> : agent.supportedCategories && agent.supportedCategories.length > 1 ? <span className="inline-flex rounded-full border border-surface-border px-2.5 py-1 text-xs font-semibold text-muted">Shared multi strategy</span> : null}
          </div>
        </div>
        {onToggleCompare ? (
          <button
            type="button"
            aria-pressed={selected}
            onClick={() => onToggleCompare(agent.id)}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] focus:outline-none focus:ring-2 focus:ring-brand ${
              selected ? "border-brand bg-brand text-black" : "border-surface-border text-muted hover:border-[#6a6a6a] hover:text-foreground"
            }`}
          >
            {selected ? "Compared" : "Compare"}
          </button>
        ) : null}
      </div>

      <p className="mt-5 min-h-12 text-sm leading-6 text-muted text-wrap-pretty">{agent.tagline || "Agent description will appear after verification."}</p>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-surface-border bg-black p-3">
          <div className="flex items-center gap-2 text-xs text-muted">
            <Fingerprint size={15} className="text-brand" />
            Identity
          </div>
          <p className="mt-3 break-all text-sm font-semibold">{agent.identity.agentId || "Not available"}</p>
        </div>
        <div className="rounded-2xl border border-surface-border bg-black p-3">
          <div className="flex items-center gap-2 text-xs text-muted">
            <ShieldCheck size={15} className="text-brand" />
            Mainnet
          </div>
          <p className="mt-3 text-sm font-semibold">{agent.deployment.network}</p>
        </div>
      </div>

      <dl className="mt-6 space-y-3 border-y border-surface-border py-5 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="flex items-center gap-2 text-muted"><Heartbeat size={15} /> Status</dt>
          <dd className="min-w-0 break-words text-right font-semibold capitalize">{agent.mode === "demo" ? "Demo only" : isLiveVerified ? "Live on BSC" : "Verification pending"}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="flex items-center gap-2 text-muted"><Clock size={15} /> Last heartbeat</dt>
          <dd className="max-w-[12rem] break-all text-right font-mono text-xs">{displayValue(agent.deployment.heartbeatAt)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted">Freshness</dt>
          <dd className="font-semibold capitalize">{agent.deployment.freshnessState}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted">Price</dt>
          <dd className="max-w-[12rem] break-words text-right font-semibold">{displayValue(agent.pricing.amount)} {agent.pricing.currency}</dd>
        </div>
      </dl>

      <div className="mt-5 rounded-2xl border border-surface-border bg-black p-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted">{primaryMetric?.label ?? category?.metricLabels[0] ?? "Primary metric"}</p>
          <span className="font-mono text-xs text-muted">{primaryMetric?.sampleSize ? `${primaryMetric.sampleSize} samples` : "Sample unavailable"}</span>
        </div>
        <p className="mt-3 break-words text-xl font-semibold">{displayValue(primaryMetric?.value)}</p>
        <p className="mt-1 text-xs text-muted">{primaryMetric?.capturedAt ? `Captured ${primaryMetric.capturedAt}` : "Waiting for a verified data source"}</p>
      </div>

      <div className="mt-auto flex gap-3 pt-6">
        <a
          href={`/agents/${agent.slug}`}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full border border-surface-border px-4 py-2 text-sm font-semibold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[#6a6a6a] hover:bg-black focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 focus:ring-offset-surface"
        >
          View
          <ArrowUpRight size={16} />
        </a>
        <a
          href={`/hire/${agent.slug}`}
          className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] active:translate-y-px focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 focus:ring-offset-surface ${isHireable ? "bg-brand text-black hover:bg-[#ffd34f]" : "border border-surface-border text-muted hover:border-[#6a6a6a] hover:bg-black hover:text-foreground"}`}
          title={isHireable ? "Start a task with this agent" : agent.hiring.reason ?? "This agent is not ready for hiring"}
        >
          {isHireable ? "Start task" : "Preview"}
        </a>
      </div>
    </article>
  );
}

export function AgentCardPlaceholder({ category }: { category?: AgentCategory }) {
  const categoryDefinition = category ? getCategoryDefinition(category) : undefined;

  return (
    <article className="flex min-h-[30rem] flex-col rounded-3xl border border-dashed border-surface-border bg-surface p-5">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="size-2 rounded-full bg-[#6a6a6a]" />
        {categoryDefinition?.label ?? "Agent category"}
      </div>
      <div className="mt-8 h-8 w-2/3 rounded-lg bg-surface-raised" />
      <div className="mt-3 h-4 w-1/2 rounded bg-surface-raised" />
      <div className="mt-8 grid grid-cols-2 gap-3">
        <div className="h-20 rounded-2xl bg-black" />
        <div className="h-20 rounded-2xl bg-black" />
      </div>
      <div className="mt-6 space-y-3">
        <div className="h-4 rounded bg-surface-raised" />
        <div className="h-4 rounded bg-surface-raised" />
        <div className="h-4 rounded bg-surface-raised" />
      </div>
      <div className="mt-auto pt-6 text-sm text-muted">Agent data will appear after verification.</div>
    </article>
  );
}
