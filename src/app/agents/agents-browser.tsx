"use client";

import { Funnel, MagnifyingGlass, Scales, SlidersHorizontal } from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AgentCard } from "@/components/marketplace/agent-card";
import { CategoryTabs } from "@/components/marketplace/category-tabs";
import { EmptyState } from "@/components/marketplace/empty-state";
import type { LiveRegistryStatus } from "@/lib/marketplace/registry";
import type { ERC8004ScanSummary } from "@/lib/chain/erc8004-adapter";
import type { Agent, AgentAvailability, RegistryCategory } from "@/lib/marketplace/types";

type FreshnessFilter = "all" | "fresh" | "stale" | "unknown";
type AvailabilityFilter = "all" | AgentAvailability;
type SortOption = "newest" | "price" | "freshness";

function isFresh(agent: Agent) {
  return agent.deployment.availability === "live" && agent.deployment.freshnessState === "fresh";
}

function priceValue(agent: Agent) {
  const parsed = Number.parseFloat(agent.pricing.amount);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function ratingValue(agent: Agent) {
  return agent.reputation.rating !== undefined && agent.reputation.reviewCount > 0
    ? `${agent.reputation.rating.toFixed(1)} / 5`
    : "Unrated";
}

interface AgentsBrowserProps {
  agents: readonly Agent[];
  initialCategory?: RegistryCategory | "all";
  liveAgentsCount: number;
  verifiedLiveAgentsCount: number;
  liveStatus: LiveRegistryStatus;
  scan: ERC8004ScanSummary;
}

function formatCount(value: string) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed.toLocaleString() : value;
}

export function AgentsBrowser({ agents, initialCategory = "all", liveAgentsCount, verifiedLiveAgentsCount, liveStatus, scan }: AgentsBrowserProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<RegistryCategory | "all">(initialCategory);
  const [freshness, setFreshness] = useState<FreshnessFilter>("all");
  const [availability, setAvailability] = useState<AvailabilityFilter>("all");
  const [sort, setSort] = useState<SortOption>("newest");
  const [compared, setCompared] = useState<string[]>([]);
  const [comparisonOpen, setComparisonOpen] = useState(false);

  const filteredAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...agents]
      .filter((agent) => {
        if (category !== "all" && agent.category !== category) return false;
        if (availability !== "all" && agent.deployment.availability !== availability) return false;
        if (freshness === "fresh" && !isFresh(agent)) return false;
        if (freshness === "stale" && agent.deployment.freshnessState !== "stale") return false;
        if (freshness === "unknown" && agent.deployment.freshnessState !== "unknown") return false;
        if (!normalizedQuery) return true;
        return [agent.name, agent.id, agent.slug, agent.tagline, agent.description, ...(agent.categoryEvidence?.matchedKeywords ?? [])].some((value) => value.toLowerCase().includes(normalizedQuery));
      })
      .sort((left, right) => {
        if (sort === "price") return priceValue(left) - priceValue(right);
        if (sort === "freshness") return left.deployment.freshnessSeconds - right.deployment.freshnessSeconds;
        return right.deployment.heartbeatAt.localeCompare(left.deployment.heartbeatAt);
      });
  }, [agents, availability, category, freshness, query, sort]);

  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<RegistryCategory | "all", number>> = { all: agents.length };
    for (const agent of agents) counts[agent.category] = (counts[agent.category] ?? 0) + 1;
    return counts;
  }, [agents]);

  const comparedAgents = useMemo(
    () => compared.map((agentId) => agents.find((agent) => agent.id === agentId)).filter((agent): agent is Agent => Boolean(agent)),
    [agents, compared],
  );

  function toggleCompare(agentId: string) {
    setCompared((current) => {
      if (current.includes(agentId)) return current.filter((id) => id !== agentId);
      if (current.length >= 3) return current;
      return [...current, agentId];
    });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-surface-border px-4 py-4 sm:px-6 sm:py-5">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3 text-sm font-semibold tracking-tight">
            <span className="flex size-8 items-center justify-center rounded-full bg-brand text-black">P</span>
            BNB Agent Studio
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/provider" className="inline-flex min-h-11 items-center text-sm text-muted transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-brand">Provider setup</Link>
            <Link href="/" className="inline-flex min-h-11 items-center text-sm text-muted transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-brand">Back home</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-28 pt-12 sm:px-6 sm:pt-16 lg:pt-24">
        <section>
          <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
            <div className="max-w-3xl">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Marketplace</p>
              <h1 className="mt-4 text-4xl font-semibold leading-none tracking-tight text-wrap-balance sm:text-6xl">Browse agents by the decision you need to make</h1>
              <p className="mt-6 max-w-2xl text-lg leading-7 text-muted text-wrap-pretty">Use the strategy tabs and filters to narrow the field. Only verified agent records can become hireable.</p>
            </div>
            <div className="w-full rounded-2xl border border-surface-border bg-surface px-5 py-4 lg:w-auto lg:min-w-48">
              <p className="text-xs text-muted">Agent records</p>
              <p className="mt-2 font-mono text-3xl text-foreground">{agents.length}</p>
            </div>
          </div>
        </section>

        <section className="mt-12" aria-label="Category tabs">
          <CategoryTabs value={category} onChange={setCategory} counts={categoryCounts} />
        </section>

        <section className="mt-6 rounded-3xl border border-surface-border bg-surface p-4 sm:p-5" aria-label="Agent filters">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="flex min-h-11 flex-1 items-center gap-3 rounded-2xl border border-surface-border bg-black px-4 focus-within:ring-2 focus-within:ring-brand">
              <MagnifyingGlass size={18} className="text-muted" />
              <span className="sr-only">Search agents</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, ID, or description"
                className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
              />
            </label>
            <div className="grid gap-3 sm:flex sm:flex-wrap">
              <label className="flex min-h-11 w-full items-center gap-2 rounded-2xl border border-surface-border bg-black px-3 text-sm text-muted focus-within:ring-2 focus-within:ring-brand sm:w-auto">
                <Funnel size={16} />
                <span className="sr-only">Freshness</span>
                <select value={freshness} onChange={(event) => setFreshness(event.target.value as FreshnessFilter)} className="w-full bg-transparent text-sm text-foreground outline-none sm:w-auto">
                  <option value="all">All freshness</option>
                  <option value="fresh">Fresh</option>
                  <option value="stale">Stale</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <label className="flex min-h-11 w-full items-center gap-2 rounded-2xl border border-surface-border bg-black px-3 text-sm text-muted focus-within:ring-2 focus-within:ring-brand sm:w-auto">
                <SlidersHorizontal size={16} />
                <span className="sr-only">Availability</span>
                <select value={availability} onChange={(event) => setAvailability(event.target.value as AvailabilityFilter)} className="w-full bg-transparent text-sm text-foreground outline-none sm:w-auto">
                  <option value="all">All availability</option>
                  <option value="live">Live</option>
                  <option value="stale">Stale</option>
                  <option value="offline">Offline</option>
                  <option value="unverified">Unverified</option>
                </select>
              </label>
              <label className="flex min-h-11 w-full items-center gap-2 rounded-2xl border border-surface-border bg-black px-3 text-sm text-muted focus-within:ring-2 focus-within:ring-brand sm:w-auto">
                <Scales size={16} />
                <span className="sr-only">Sort agents</span>
                <select value={sort} onChange={(event) => setSort(event.target.value as SortOption)} className="w-full bg-transparent text-sm text-foreground outline-none sm:w-auto">
                  <option value="newest">Newest</option>
                  <option value="price">Price</option>
                  <option value="freshness">Freshness</option>
                </select>
              </label>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
            <p>{filteredAgents.length} agent records match these filters.</p>
            <p>Live cards use structured telemetry when a source is connected. Empty values remain honest.</p>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-surface-border bg-surface px-4 py-3 text-sm" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted">Registry coverage</p>
            <p className="font-mono text-xs text-muted">{formatCount(scan.scannedBlocks)} blocks scanned · {verifiedLiveAgentsCount} verified live · {liveAgentsCount} live records</p>
          </div>
          <p className="mt-2 text-xs text-muted">Category tab counts include the four demo fixtures. Live category labels use metadata evidence and can remain Uncategorised.</p>
          {liveStatus === "unavailable" ? (
            <p className="text-[#e8d995]">Live ERC 8004 discovery is temporarily unavailable. Demo records remain visible. No live agent claims are shown.</p>
          ) : liveStatus === "stale" ? (
            <p className="text-[#e8d995]">Showing cached live identities while the BSC registry refreshes. The last successful identity read remains visible.</p>
          ) : liveStatus === "empty" ? (
            <p className="text-muted">No live ERC 8004 registrations were found in the current BSC scan window. Demo records are marked clearly.</p>
          ) : (
            <p className="text-positive">Live ERC 8004 registrations are shown with identity, service, heartbeat, and provider telemetry status. Performance history remains empty until a verified history source exists.</p>
          )}
          {scan.warning ? <p className="mt-2 text-xs leading-5 text-muted">{scan.warning}</p> : null}
          {scan.indexer?.used && scan.indexer.returned > 0 ? <p className="mt-2 text-xs leading-5 text-muted">The registry indexer added {scan.indexer.returned} candidate records. On chain token URI checks remain authoritative.</p> : null}
        </section>

        <section className="mt-10" aria-live="polite">
          {filteredAgents.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredAgents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} selected={compared.includes(agent.id)} onToggleCompare={toggleCompare} />
              ))}
            </div>
          ) : (
            <EmptyState
              search={Boolean(query || category !== "all" || freshness !== "all" || availability !== "all")}
              title={agents.length === 0 ? "No agent records are connected yet" : "No agents match these filters"}
              description={agents.length === 0 ? "The browse surface is ready, but we will not invent listings or performance numbers. Records will appear after the registry or demo source returns data." : "Change the search or filters to see other records."}
              actionLabel={agents.length === 0 ? "Return home" : "Clear filters"}
              actionHref={agents.length === 0 ? "/" : "/agents"}
            />
          )}
        </section>
      </main>

      {comparisonOpen && comparedAgents.length >= 2 ? (
        <section className="fixed inset-x-0 bottom-[5.25rem] z-30 mx-auto max-h-[70vh] w-[min(90rem,calc(100%-2rem))] overflow-y-auto rounded-3xl border border-brand/50 bg-[#181818]/98 p-4 shadow-2xl shadow-black/50 backdrop-blur-xl sm:bottom-[6rem] sm:p-6" aria-label="Agent comparison results">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Comparison</p>
              <h2 className="mt-2 text-2xl font-semibold">Make the tradeoff visible</h2>
              <p className="mt-2 text-sm text-muted">These values come from the current registry records. Not enough data means Plow has no verified claim.</p>
            </div>
            <button type="button" onClick={() => setComparisonOpen(false)} className="inline-flex min-h-11 items-center rounded-full border border-surface-border px-3 py-2 text-sm font-semibold text-muted hover:border-[#6a6a6a] hover:text-foreground focus:outline-none focus:ring-2 focus:ring-brand">Close comparison</button>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {comparedAgents.map((agent) => {
              const primaryMetric = agent.categoryMetrics[0];
              const live = agent.mode === "live" && agent.verified && agent.deployment.availability === "live";
              return (
                <article key={agent.id} className="rounded-2xl border border-surface-border bg-black p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words text-base font-semibold">{agent.name}</h3>
                      <p className="mt-1 text-xs text-muted">{agent.category === "uncategorised" ? "Uncategorised" : agent.category}</p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-semibold ${live ? "border-[#5a9876] text-positive" : "border-surface-border text-muted"}`}>{live ? "Live" : agent.mode === "demo" ? "Demo" : "Pending"}</span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div><dt className="text-muted">Price</dt><dd className="mt-1 font-semibold">{agent.pricing.amount} {agent.pricing.currency}</dd></div>
                    <div><dt className="text-muted">Freshness</dt><dd className="mt-1 font-semibold capitalize">{agent.deployment.freshnessState}</dd></div>
                    <div><dt className="text-muted">Verified jobs</dt><dd className="mt-1 font-semibold">{agent.reputation.completedJobs}</dd></div>
                    <div><dt className="text-muted">Rating</dt><dd className="mt-1 font-semibold">{ratingValue(agent)}</dd></div>
                    <div className="col-span-2"><dt className="text-muted">Primary metric</dt><dd className="mt-1 break-words font-semibold">{primaryMetric?.value ?? "Not enough data"}</dd></div>
                    <div className="col-span-2"><dt className="text-muted">ERC 8004 identity</dt><dd className="mt-1 break-all font-mono">{agent.identity.agentId}</dd></div>
                  </dl>
                  <Link href={`/agents/${agent.slug}`} className="mt-4 inline-flex min-h-10 items-center text-sm font-semibold text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand">Open listing</Link>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <aside aria-label="Agent comparison" className="pointer-events-none fixed inset-x-0 bottom-3 z-30 flex justify-center px-4 sm:bottom-4 sm:px-6">
        <div className="pointer-events-auto flex w-full max-w-xl items-center justify-between gap-3 rounded-2xl border border-surface-border bg-[#181818]/95 px-3 py-3 shadow-2xl shadow-black/40 backdrop-blur-xl sm:gap-4 sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Scales size={20} className="text-brand" />
            <div>
              <p className="text-sm font-semibold text-wrap-pretty">Compare up to three agents</p>
              <p className="text-xs text-muted">{compared.length} selected</p>
            </div>
          </div>
          <button type="button" disabled={compared.length < 2} onClick={() => setComparisonOpen(true)} className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-brand px-3 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:bg-[#5a5230] disabled:text-[#b9ae7b] sm:px-4">
            Compare selected
          </button>
        </div>
      </aside>
    </div>
  );
}
