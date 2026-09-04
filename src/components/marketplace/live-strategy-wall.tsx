import {
  BellRinging,
  ChartLineUp,
  CheckCircle,
  Globe,
  Lightning,
  SquaresFour,
  WarningCircle,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { CATEGORY_DEFINITIONS } from "@/lib/marketplace/categories";
import { getMarketplaceRegistry } from "@/lib/marketplace/registry";
import { buildProviderTelemetrySnapshot, type MarketplaceTelemetrySnapshot } from "@/lib/marketplace/provider-strategies";
import { getProviderServiceConfig, getProviderServiceListingId } from "@/lib/marketplace/provider-service";
import { isAgentHireable, type AgentCategory, type Agent } from "@/lib/marketplace/types";

const categoryIcons = {
  rebalancing: ChartLineUp,
  "grid-trading": SquaresFour,
  "yield-optimisation": Lightning,
  "health-factor-monitoring": BellRinging,
} satisfies Record<AgentCategory, typeof ChartLineUp>;

const strategyNames: Record<AgentCategory, string> = {
  rebalancing: "Range Steward",
  "grid-trading": "Grid Pilot",
  "yield-optimisation": "Yield Scout",
  "health-factor-monitoring": "Health Sentinel",
};

function previewSnapshot(category: AgentCategory): MarketplaceTelemetrySnapshot {
  return {
    category,
    status: "unavailable",
    capturedAt: new Date().toISOString(),
    source: "BSC Mainnet RPC",
    headline: "Preview listing only",
    metrics: [],
    detail: "Configure a live provider profile to replace this preview with BSC Mainnet telemetry.",
  };
}

function statusLabel(snapshot: MarketplaceTelemetrySnapshot, agent?: Agent) {
  if (agent?.mode === "demo") return "Preview only";
  if (!agent) return "Provider setup needed";
  if (agent.verified && snapshot.status === "live") return "Live on BSC";
  if (agent.verified) return "Live identity · partial data";
  return "Identity verification pending";
}

function statusClass(snapshot: MarketplaceTelemetrySnapshot, agent?: Agent) {
  if (agent?.mode === "demo" || !agent) return "border-[#9a843c] bg-[#211d0d] text-[#e8d995]";
  if (agent.verified && snapshot.status === "live") return "border-[#5a9876] bg-[#10261c] text-positive";
  return "border-[#9a843c] bg-[#211d0d] text-[#e8d995]";
}

function formatCapture(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return `${new Date(timestamp).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function strategyLink(agent: Agent | undefined, category: AgentCategory, listingId: string) {
  if (agent?.listingId === listingId) return `/hire/${encodeURIComponent(agent.slug)}`;
  return agent?.slug
    ? `/hire/${encodeURIComponent(agent.slug)}?category=${encodeURIComponent(category)}`
    : `/agents?category=${encodeURIComponent(category)}`;
}

function StrategyCard({
  category,
  snapshot,
  agent,
  providerName,
  providerAgentId,
  price,
  currency,
  listingId,
  compact = false,
}: {
  category: AgentCategory;
  snapshot: MarketplaceTelemetrySnapshot;
  agent?: Agent;
  providerName: string;
  providerAgentId?: string;
  price?: string;
  currency?: string;
  listingId: string;
  compact?: boolean;
}) {
  const definition = CATEGORY_DEFINITIONS.find((candidate) => candidate.id === category);
  const Icon = categoryIcons[category];
  const hireable = isAgentHireable(agent);
  const detailLink = strategyLink(agent, category, listingId);
  const displayedMetrics = snapshot.metrics.slice(0, 4);

  return (
    <article id={`strategy-${category}`} className={`scroll-mt-8 border border-surface-border bg-surface ${compact ? "rounded-2xl p-3" : "rounded-3xl p-4 sm:p-5"}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`flex shrink-0 items-center justify-center rounded-2xl bg-black text-brand ${compact ? "size-9" : "size-11"}`}><Icon size={compact ? 18 : 22} /></span>
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-brand">{agent ? "Connected service listing" : "Strategy slot"}</p>
            <h3 className={`${compact ? "mt-1 text-lg" : "mt-2 text-xl"} break-words font-semibold tracking-tight`}>{strategyNames[category]}</h3>
            <p className="mt-1 text-xs text-muted">{definition?.label} · {definition?.plainLanguage}</p>
          </div>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold ${statusClass(snapshot, agent)}`}>
          {agent?.verified && snapshot.status === "live" ? <CheckCircle size={13} weight="fill" /> : <WarningCircle size={13} />}
          {statusLabel(snapshot, agent)}
        </span>
      </div>

      <p className={`${compact ? "mt-3 text-xs leading-5" : "mt-4 min-h-12 text-sm leading-6"} text-muted`}>{compact ? definition?.plainLanguage : definition?.description}</p>

      <dl className={`${compact ? "mt-3 gap-2" : "mt-5 gap-3"} grid sm:grid-cols-2`}>
        {displayedMetrics.length > 0 ? displayedMetrics.slice(0, compact ? 2 : 4).map((metric) => (
          <div key={`${category}-${metric.label}`} className="rounded-2xl border border-surface-border bg-black p-3">
            <dt className="text-xs text-muted">{metric.label}</dt>
            <dd className="mt-2 break-words text-sm font-semibold">{metric.value}</dd>
            {metric.detail ? <dd className="mt-1 break-words text-[11px] leading-4 text-muted">{metric.detail}</dd> : null}
          </div>
        )) : (
          <div className="rounded-2xl border border-dashed border-surface-border bg-black p-3 sm:col-span-2">
            <dt className="text-xs text-muted">Telemetry</dt>
            <dd className="mt-2 text-sm font-semibold">Awaiting live provider data</dd>
            <dd className="mt-1 text-[11px] leading-4 text-muted">{snapshot.detail}</dd>
          </div>
        )}
      </dl>

      <div className={`${compact ? "mt-3 p-3" : "mt-5 p-4"} rounded-2xl border border-surface-border bg-black`}>
        <div className="flex items-center gap-2 text-xs text-muted"><Globe size={15} className="text-brand" /> BSC Mainnet telemetry</div>
        <p className={`${compact ? "mt-2 text-xs" : "mt-3 text-sm"} break-words font-semibold`}>{snapshot.headline}</p>
        <p className="mt-2 text-xs leading-5 text-muted">{snapshot.detail}</p>
        <p className="mt-3 font-mono text-[11px] text-muted">{snapshot.blockNumber ? `Block ${snapshot.blockNumber} · ` : ""}{formatCapture(snapshot.capturedAt)}</p>
      </div>

      <div className={`${compact ? "mt-3" : "mt-5"} space-y-2 text-xs text-muted`}>
        <p className="break-all font-mono">Listing ID · {listingId}</p>
        <p>{providerName}{providerAgentId ? ` · ERC 8004 #${providerAgentId}` : " · No ERC 8004 identity connected"}</p>
        <p>{price && currency ? `${price} ${currency} per task` : "Price appears after provider configuration"} · Job ID generated after activation</p>
      </div>

      <Link href={detailLink} className={`${compact ? "mt-3 min-h-10 text-xs" : "mt-5 min-h-11 text-sm"} inline-flex w-full items-center justify-center rounded-full px-4 py-2 font-semibold focus:outline-none focus:ring-2 focus:ring-brand ${hireable ? "bg-brand text-black hover:bg-[#ffd34f]" : "border border-surface-border text-muted hover:border-[#6a6a6a] hover:bg-black hover:text-foreground"}`}>
        {hireable ? "Activate strategy" : agent ? "Inspect activation" : "Browse this category"}
      </Link>
    </article>
  );
}

export function StrategyWallSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className="space-y-3" aria-label="Loading strategy telemetry">
      {CATEGORY_DEFINITIONS.map((category) => <div key={category.id} className={`${compact ? "h-24" : "h-28"} animate-pulse rounded-2xl border border-surface-border bg-surface`} />)}
    </div>
  );
}

export async function LiveStrategyWall({ compact = false }: { compact?: boolean } = {}) {
  const config = getProviderServiceConfig();
  const profile = config.profiles[0];
  const registry = profile ? await getMarketplaceRegistry() : undefined;
  const snapshots = profile
    ? await Promise.all(CATEGORY_DEFINITIONS.map((category) => buildProviderTelemetrySnapshot(category.id, { supportedCategories: profile.supportedCategories })))
    : CATEGORY_DEFINITIONS.map((category) => previewSnapshot(category.id));

  return (
    <div className="mt-8 space-y-3">
      {CATEGORY_DEFINITIONS.map((category, index) => (
        (() => {
          const listingId = profile ? getProviderServiceListingId(profile.agentId, category.id) : `preview-${category.id}`;
          const agent = registry?.liveAgents.find((candidate) => candidate.listingId === listingId);
          return <StrategyCard
            key={category.id}
            category={category.id}
            snapshot={snapshots[index]}
            agent={agent}
            providerName={agent?.providerName ?? profile?.name ?? "No provider configured"}
            providerAgentId={agent?.identity.agentId ?? profile?.agentId}
            price={agent?.pricing.amount ?? profile?.price}
            currency={agent?.pricing.currency ?? profile?.currency}
            listingId={listingId}
            compact={compact}
          />;
        })()
      ))}
    </div>
  );
}
