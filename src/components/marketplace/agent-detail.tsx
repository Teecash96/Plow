import {
  ArrowLeft,
  ChartLineUp,
  CheckCircle,
  Clock,
  Code,
  Fingerprint,
  Globe,
  Pulse,
  ShieldCheck,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { EmptyState } from "@/components/marketplace/empty-state";
import { AltanaPermissionPanel } from "@/components/partners/altana-permission-panel";
import { PancakeSwapEvidencePanel } from "@/components/partners/pancakeswap-evidence-panel";
import { TermiXReportPanel } from "@/components/partners/terminx-report-panel";
import { getCategoryDefinition } from "@/lib/marketplace/categories";
import { isAgentHireable, type Agent } from "@/lib/marketplace/types";

interface AgentDetailProps {
  agent?: Agent;
  agentId: string;
}

function valueOrPending(value?: string | number) {
  return value === undefined || value === "" ? "Not enough data" : String(value);
}

function ratingValue(agent?: Agent) {
  return agent?.reputation.rating !== undefined && agent.reputation.reviewCount > 0
    ? `${agent.reputation.rating.toFixed(1)} / 5`
    : "Unrated";
}

function ratingDetail(agent?: Agent) {
  if (!agent?.reputation.reviewCount) return "No verified reviews yet";
  return `${agent.reputation.reviewCount.toLocaleString()} verified review${agent.reputation.reviewCount === 1 ? "" : "s"}${agent.reputation.positivePercent !== undefined ? ` · ${agent.reputation.positivePercent}% positive` : ""}`;
}

function verifiedJobsValue(agent?: Agent) {
  return agent ? agent.reputation.completedJobs.toLocaleString() : "Not enough data";
}

function latestJobValue(agent?: Agent) {
  return agent?.reputation.latestJobId ?? "None yet";
}

function DetailMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-surface-border bg-black p-4">
    <p className="text-xs text-muted">{label}</p>
      <p className="mt-4 break-words text-xl font-semibold">{value}</p>
      <p className="mt-2 break-words text-xs leading-5 text-muted">{detail}</p>
    </div>
  );
}

function PlaceholderPanel({ title, description, icon: Icon }: { title: string; description: string; icon: typeof ChartLineUp }) {
  return (
    <div className="rounded-3xl border border-dashed border-surface-border bg-surface p-5">
      <span className="flex size-10 items-center justify-center rounded-xl bg-surface-raised text-brand">
        <Icon size={20} />
      </span>
      <h3 className="mt-8 text-lg font-semibold">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-muted">{description}</p>
      <p className="mt-6 font-mono text-xs uppercase tracking-[0.14em] text-muted">Reserved for verified data</p>
    </div>
  );
}

export function AgentDetail({ agent, agentId }: AgentDetailProps) {
  const category = agent ? getCategoryDefinition(agent.category) : undefined;
  const metricLabels = category?.metricLabels ?? ["Primary category metric", "Risk context", "Execution evidence"];
  const isHireable = isAgentHireable(agent);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-surface-border px-4 py-4 sm:px-6 sm:py-5">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Link href="/agents" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-brand">
            <ArrowLeft size={16} />
            Back to agents
          </Link>
          <Link href="/" className="inline-flex min-h-11 items-center text-sm font-semibold tracking-tight">BNB Agent Studio</Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-28 pt-10 sm:px-6 sm:pt-12 lg:pt-20">
        <section className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface px-3 py-1.5">
                <Fingerprint size={14} className="text-brand" />
                ERC 8004 identity
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface px-3 py-1.5">
                <Globe size={14} className="text-brand" />
                BSC Mainnet
              </span>
              {agent?.mode === "demo" ? <span className="inline-flex items-center gap-1.5 rounded-full border border-[#9a843c] bg-[#211d0d] px-3 py-1.5 text-[#e8d995]">Demo fixture</span> : agent?.mode === "live" && agent.verified ? <span className="inline-flex items-center gap-1.5 rounded-full border border-[#5a9876] bg-[#10261c] px-3 py-1.5 text-positive">Live on BSC</span> : agent?.mode === "live" ? <span className="inline-flex items-center gap-1.5 rounded-full border border-[#9a843c] bg-[#211d0d] px-3 py-1.5 text-warning">Registry candidate</span> : null}
              <span className="rounded-full border border-surface-border bg-surface px-3 py-1.5">{category?.label ?? "Uncategorised"}</span>
            </div>
            <p className="mt-8 font-mono text-xs uppercase tracking-[0.16em] text-brand">Agent detail</p>
            <h1 className="mt-4 break-words text-4xl font-semibold leading-none tracking-tight text-wrap-balance sm:text-6xl">{agent?.name ?? `Agent ${agentId}`}</h1>
            <p className="mt-5 max-w-2xl text-lg leading-7 text-muted text-wrap-pretty">{agent?.description ?? "This agent profile is ready for an identity, deployment record, category metrics, and evidence sources."}</p>
            {agent ? <p className="mt-5 break-all font-mono text-xs text-muted">Marketplace ID · {agent.id}</p> : null}
          </div>
          <div className="rounded-3xl border border-surface-border bg-surface p-5">
            <p className="text-xs text-muted">Profile readiness</p>
            <div className="mt-5 flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-black text-muted"><Pulse size={20} /></span>
              <div>
                <p className="text-sm font-semibold">{!agent ? "Not connected" : agent.mode === "demo" ? "Demo fixture" : agent.verified ? "Identity found on BSC" : "Awaiting live checks"}</p>
                <p className="mt-1 text-xs text-muted">Hiring stays unavailable until identity, pricing, freshness, and execution checks pass.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Agent status">
          <DetailMetric label="Agent ID" value={valueOrPending(agent?.identity.agentId)} detail="ERC 8004 registry record" />
          <DetailMetric label="Marketplace ID" value={valueOrPending(agent?.id)} detail="Stable Plow listing identifier" />
          <DetailMetric label="Rating" value={ratingValue(agent)} detail={ratingDetail(agent)} />
          <DetailMetric label="Verified jobs" value={verifiedJobsValue(agent)} detail="Paid and completed Plow jobs" />
          <DetailMetric label="Latest job" value={latestJobValue(agent)} detail={agent?.reputation.latestJobId ? "Latest verified Plow job ID" : "Job IDs are generated per hire"} />
          <DetailMetric label="Deployment" value={valueOrPending(agent?.deployment.network)} detail={agent ? `Chain ID ${agent.deployment.chainId}` : "Mainnet record pending"} />
          <DetailMetric label="Last heartbeat" value={valueOrPending(agent?.deployment.heartbeatAt)} detail={agent ? `${agent.deployment.freshnessSeconds} seconds freshness window` : "Freshness record pending"} />
          <DetailMetric label="Price" value={agent ? `${valueOrPending(agent.pricing.amount)} ${agent.pricing.currency}` : "Not enough data"} detail="x402 quote will appear after integration" />
        </section>
        <p className="mt-4 text-sm leading-6 text-muted">Ratings appear only after verified reviews. Job IDs identify individual hires, not the agent.</p>

        <section className="mt-16" aria-labelledby="identity-heading">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Identity and deployment</p>
              <h2 id="identity-heading" className="mt-3 text-3xl font-semibold tracking-tight">Verify the agent before you trust it</h2>
            </div>
          </div>
          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-surface-border bg-surface p-6">
              <div className="flex items-center gap-3">
                <Fingerprint size={22} className="text-brand" />
                <h3 className="text-lg font-semibold">ERC 8004 identity</h3>
              </div>
              <dl className="mt-8 space-y-4 text-sm">
                <div className="flex items-start justify-between gap-4 border-b border-surface-border pb-4"><dt className="text-muted">Registry ID</dt><dd className="max-w-[16rem] break-all font-mono text-right text-xs">{valueOrPending(agent?.identity.agentId)}</dd></div>
                <div className="flex items-start justify-between gap-4 border-b border-surface-border pb-4"><dt className="text-muted">Registry address</dt><dd className="max-w-[16rem] break-all font-mono text-right text-xs">{agent?.identity.explorerUrl ? <a href={agent.identity.explorerUrl} target="_blank" rel="noreferrer" className="break-all underline decoration-surface-border underline-offset-4 hover:text-brand">{valueOrPending(agent.identity.registryAddress)}</a> : valueOrPending(agent?.identity.registryAddress)}</dd></div>
                <div className="flex items-start justify-between gap-4 border-b border-surface-border pb-4"><dt className="text-muted">Verification</dt><dd className="inline-flex items-center gap-1.5 font-semibold"><CheckCircle size={15} className={agent?.verified ? "text-positive" : "text-muted"} /> {agent?.verified ? "Verified on chain" : agent?.mode === "demo" ? "Demo only" : "Not verified"}</dd></div>
                <div className="flex items-start justify-between gap-4"><dt className="text-muted">Agent URI</dt><dd className="max-w-[16rem] text-right text-xs">{agent?.identity.metadataUri ? <a href={agent.identity.metadataUri} target="_blank" rel="noreferrer" className="break-all underline decoration-surface-border underline-offset-4 hover:text-brand">{agent.identity.metadataUri}</a> : "Not available"}</dd></div>
                <div className="flex items-start justify-between gap-4 border-t border-surface-border pt-4"><dt className="text-muted">Metadata</dt><dd className="text-right text-xs capitalize">{agent?.identity.metadataStatus ?? "Not checked"}</dd></div>
                <div className="flex items-start justify-between gap-4"><dt className="text-muted">Capabilities</dt><dd className="max-w-[16rem] text-right text-xs">{agent?.identity.capabilities?.length ? agent.identity.capabilities.join(", ") : "Not published"}</dd></div>
              </dl>
            </div>
            <div className="rounded-3xl border border-surface-border bg-surface p-6">
              <div className="flex items-center gap-3">
                <ShieldCheck size={22} className="text-brand" />
                <h3 className="text-lg font-semibold">BSC Mainnet deployment</h3>
              </div>
              <dl className="mt-8 space-y-4 text-sm">
                <div className="flex items-start justify-between gap-4 border-b border-surface-border pb-4"><dt className="text-muted">Network</dt><dd className="font-semibold">BSC Mainnet</dd></div>
                <div className="flex items-start justify-between gap-4 border-b border-surface-border pb-4"><dt className="text-muted">Chain ID</dt><dd className="font-mono">56</dd></div>
                <div className="flex items-start justify-between gap-4"><dt className="text-muted">Current status</dt><dd className="inline-flex items-center gap-1.5 font-semibold"><span className={`size-2 rounded-full ${agent?.mode === "live" && agent.verified ? "bg-positive" : "bg-[#6a6a6a]"}`} /> {agent?.mode === "live" && agent.verified ? "Live identity" : agent?.mode === "live" ? "Verification pending" : "Not verified"}</dd></div>
                <div className="flex items-start justify-between gap-4"><dt className="text-muted">Service endpoint</dt><dd className="max-w-[16rem] break-all text-right text-xs">{agent?.identity.serviceUri ?? "Not published"}</dd></div>
                <div className="flex items-start justify-between gap-4"><dt className="text-muted">Other endpoints</dt><dd className="max-w-[16rem] break-all text-right text-xs">{agent?.identity.endpoints?.length ? agent.identity.endpoints.join(", ") : "Not published"}</dd></div>
              </dl>
            </div>
          </div>
        </section>

        <section className="mt-16" aria-labelledby="classification-heading">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Category classification</p>
            <h2 id="classification-heading" className="mt-3 text-3xl font-semibold tracking-tight">Make the category decision inspectable</h2>
            <div className="mt-8 rounded-3xl border border-surface-border bg-surface p-6">
              {!agent ? (
                <p className="text-sm text-muted">Classification evidence is not available until the agent record is loaded.</p>
              ) : agent.categoryEvidence ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold">{agent.category === "uncategorised" ? "Uncategorised" : `${category?.label ?? "Category"} ${agent.categorySource === "manual" ? "from curated evidence" : "from metadata"}`}</p>
                      <p className="mt-2 text-sm leading-6 text-muted">{agent.categoryEvidence.reason}</p>
                    </div>
                    <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${agent.category === "uncategorised" ? "border-surface-border text-muted" : "border-[#5a9876] bg-[#10261c] text-positive"}`}>
                      {agent.category === "uncategorised" ? "No meaningful match" : `${agent.categoryEvidence.confidence} confidence`}
                    </span>
                  </div>
                  {agent.categoryEvidence.matchedKeywords.length > 0 ? (
                    <dl className="mt-6 grid gap-4 border-t border-surface-border pt-5 sm:grid-cols-2">
                      <div>
                        <dt className="text-xs text-muted">Matched signals</dt>
                        <dd className="mt-2 text-sm">{agent.categoryEvidence.matchedKeywords.join(", ")}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">Metadata fields</dt>
                        <dd className="mt-2 text-sm">{agent.categoryEvidence.matchedFields.join(", ")}</dd>
                      </div>
                    </dl>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted">{agent.mode === "demo" || agent.categorySource === "demo" ? "Demo category mapping. Live metadata evidence is not attached." : "No classification evidence was published."}</p>
              )}
            </div>
        </section>

        <section className="mt-16" aria-labelledby="metrics-heading">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Category evidence</p>
          <h2 id="metrics-heading" className="mt-3 text-3xl font-semibold tracking-tight">Metrics that match the strategy</h2>
          <p className="mt-4 max-w-2xl text-base leading-6 text-muted">Every value must include a source, timestamp, and sample size. Empty values stay visible until a verified feed exists.</p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {metricLabels.map((label, index) => {
              const metric = agent?.categoryMetrics[index];
              return <DetailMetric key={label} label={label} value={valueOrPending(metric?.value)} detail={metric ? `${metric.source === "demo" ? "Demo only" : `${metric.sampleSize} samples`} · Captured ${metric.capturedAt}` : "Source and sample size pending"} />;
            })}
          </div>
        </section>

        <section className="mt-16" aria-labelledby="evidence-heading">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Evidence</p>
              <h2 id="evidence-heading" className="mt-3 text-3xl font-semibold tracking-tight">Show the record behind every claim</h2>
            </div>
            <Code size={24} className="hidden text-brand sm:block" />
          </div>
          <div className="mt-8">
            {agent?.evidence.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {agent.evidence.map((evidence) => (
                  <div key={evidence.id} className="rounded-3xl border border-surface-border bg-surface p-5">
                    <div className="flex items-center justify-between gap-4"><h3 className="font-semibold">{evidence.label}</h3><span className="text-xs text-muted">{evidence.source} · {evidence.status}</span></div>
                    <p className="mt-3 text-sm text-muted">{evidence.detail ?? "Evidence detail pending"}</p>
                    <p className="mt-5 font-mono text-xs text-muted">Captured {evidence.capturedAt}</p>
                    {evidence.explorerUrl ? <a href={evidence.explorerUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-xs font-semibold text-brand underline decoration-brand/40 underline-offset-4 hover:decoration-brand">Open source</a> : null}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No evidence is attached yet" description="This section will show timestamped identity, performance, risk, execution, benchmark, and payment records when an agent is connected." />
            )}
          </div>
        </section>

        <section className="mt-16" aria-labelledby="partner-heading">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Partner evidence</p>
          <h2 id="partner-heading" className="mt-3 text-3xl font-semibold tracking-tight">Inspect partner evidence before you hire</h2>
          <div className="mt-8 space-y-4">
            <PlaceholderPanel title="Performance history" description="Historical windows, drawdown, and sample size will appear here after the data feed is connected." icon={ChartLineUp} />
            <AltanaPermissionPanel permission={agent?.integrations.altana?.permissionTemplate} />
            <TermiXReportPanel reports={agent?.integrations.termiX?.reports} />
            {agent?.category === "rebalancing" || agent?.category === "yield-optimisation" ? <PancakeSwapEvidencePanel evidence={agent?.integrations.pancakeSwap?.evidence} /> : null}
          </div>
        </section>

        <aside className="sticky bottom-3 z-20 mt-12 rounded-3xl border border-surface-border bg-[#181818]/95 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl sm:bottom-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Clock size={22} className="text-brand" />
              <div>
                <p className="text-sm font-semibold">Ready to start a task?</p>
                <p className="mt-1 text-xs text-muted">Starting a task is disabled until identity, pricing, freshness, and execution checks pass.</p>
              </div>
            </div>
            {isHireable ? <Link href={`/hire/${agent?.slug ?? agentId}`} className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-brand px-5 py-2 text-base font-semibold text-black hover:bg-[#ffd34f] focus:outline-none focus:ring-2 focus:ring-brand sm:w-auto">Start task</Link> : <button type="button" disabled className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#5a5230] px-5 py-2 text-base font-semibold text-[#b9ae7b] sm:w-auto">Preview only</button>}
          </div>
        </aside>
      </main>
    </div>
  );
}
