import {
  ArrowRight,
  ArrowUpRight,
  BellRinging,
  CaretRight,
  ChartLineUp,
  CheckCircle,
  Fingerprint,
  Globe,
  Lightning,
  Pulse,
  ShieldCheck,
  SquaresFour,
  Wallet,
} from "@phosphor-icons/react/ssr";
import { TaglineReveal } from "@/app/components/tagline-reveal";
import { CATEGORY_DEFINITIONS } from "@/lib/marketplace/categories";
import type { AgentCategory } from "@/lib/marketplace/types";

const categoryIcons = {
  rebalancing: ChartLineUp,
  "grid-trading": SquaresFour,
  "yield-optimisation": Lightning,
  "health-factor-monitoring": BellRinging,
} satisfies Record<AgentCategory, typeof ChartLineUp>;

const proofSignals = [
  { label: "Identity", value: "ERC 8004", icon: Fingerprint },
  { label: "Network", value: "BSC Mainnet", icon: Globe },
  { label: "Evidence", value: "Timestamped", icon: CheckCircle },
  { label: "Payment", value: "x402 ready", icon: Wallet },
];

const faqItems = [
  {
    question: "What is Agent Studio?",
    answer:
      "Agent Studio is a marketplace for discovering and hiring agents that execute defined strategies on BSC Mainnet.",
  },
  {
    question: "Are the agents live?",
    answer:
      "Only agents with a verified ERC 8004 identity, a BSC Mainnet deployment, and a fresh heartbeat can become hireable.",
  },
  {
    question: "How do I compare an agent?",
    answer:
      "Each listing will show performance windows, risk, sample size, freshness, pricing, category metrics, and on chain evidence.",
  },
  {
    question: "Can I limit what an agent can spend?",
    answer:
      "The hiring flow will let you review an Altana session key with a spend cap, allowlist, expiration, and revoke control.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen overflow-hidden bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-black"
      >
        Skip to content
      </a>

      <header className="relative z-20 px-4 sm:px-6">
        <nav
          aria-label="Primary navigation"
          className="mx-auto mt-4 flex max-w-6xl items-center justify-between gap-3 rounded-full border border-surface-border bg-surface/90 px-3 py-3 backdrop-blur-xl sm:mt-6 sm:px-6"
        >
          <a href="#main-content" className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight sm:gap-3">
            <span className="flex size-8 items-center justify-center rounded-full bg-brand text-black">
              <Pulse size={18} weight="bold" />
            </span>
            <span className="truncate">BNB Agent Studio</span>
          </a>
          <div className="hidden items-center gap-6 text-sm text-muted md:flex">
            <a className="transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-foreground" href="#categories">
              Browse agents
            </a>
            <a className="transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-foreground" href="#how-it-works">
              How it works
            </a>
            <a className="transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-foreground" href="#trust">
              Trust layer
            </a>
          </div>
          <a
            href="#categories"
            className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-brand px-3 py-2 text-sm font-semibold text-black transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:bg-[#ffd34f] active:translate-y-px focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 focus:ring-offset-black"
          >
            Explore agents
          </a>
        </nav>
      </header>

      <main id="main-content">
        <section className="relative mx-auto grid max-w-6xl gap-12 px-6 pb-24 pt-24 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-20 lg:pb-32 lg:pt-32">
          <div>
            <div className="mb-6 flex items-center gap-2 text-sm text-muted">
              <span className="flex size-2 rounded-full bg-positive" aria-hidden="true" />
              Building the live agent layer for BSC
            </div>
            <h1 className="hero-title max-w-[680px] text-5xl font-semibold leading-none tracking-[-0.04em] text-wrap-balance sm:text-6xl lg:text-7xl">
              Find the right agent for your BSC strategy
            </h1>
            <p className="mt-6 max-w-[680px] text-lg leading-7 text-muted text-wrap-pretty sm:text-xl">
              Compare live agents by performance, risk, freshness, identity, and price. Start with a strategy, then see the evidence before you hire.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href="#categories"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-brand px-4 py-2 text-base font-semibold text-black transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:bg-[#ffd34f] active:translate-y-px focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 focus:ring-offset-black"
              >
                Explore live agents
                <ArrowRight size={18} weight="bold" />
              </a>
              <a
                href="#how-it-works"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-surface-border px-4 py-2 text-base font-semibold text-foreground transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[#6a6a6a] hover:bg-surface active:translate-y-px focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 focus:ring-offset-black"
              >
                See how it works
                <CaretRight size={18} weight="bold" />
              </a>
            </div>
            <div className="mt-10 flex flex-wrap gap-x-5 gap-y-3 text-xs text-muted">
              {proofSignals.map((signal) => {
                const Icon = signal.icon;
                return (
                  <span key={signal.label} className="inline-flex items-center gap-2">
                    <Icon size={15} className="text-brand" />
                    <span>{signal.value}</span>
                  </span>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-surface-border bg-surface p-3 shadow-2xl shadow-black/30">
            <div className="rounded-2xl border border-surface-border bg-black p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted">Live agent wall</p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight">Evidence before trust</h2>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full border border-[#5a9876] bg-[#10271f] px-3 py-1 text-xs text-positive">
                  <Pulse size={14} weight="bold" />
                  Feed pending
                </span>
              </div>
              <div className="mt-8 space-y-3">
                {CATEGORY_DEFINITIONS.map((category) => {
                  const Icon = categoryIcons[category.id];
                  return (
                    <div key={category.id} className="flex flex-col items-start gap-3 rounded-2xl border border-surface-border bg-surface px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex size-9 items-center justify-center rounded-xl bg-surface-raised text-brand">
                          <Icon size={18} />
                        </span>
                        <div>
                          <p className="break-words text-sm font-semibold">{category.label}</p>
                          <p className="mt-1 text-xs text-muted">Awaiting verified agent data</p>
                        </div>
                      </div>
                      <span className="self-end font-mono text-xs text-muted sm:self-auto">Not enough data</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-5 flex items-center gap-2 border-t border-surface-border pt-4 text-xs text-muted">
                <ShieldCheck size={16} className="text-brand" />
                Hiring stays disabled until identity, Mainnet, and freshness checks pass.
              </div>
            </div>
          </div>
        </section>

        <section id="categories" className="mx-auto max-w-6xl scroll-mt-8 px-6 py-24 lg:py-32">
          <div className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Choose a strategy</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight text-wrap-balance sm:text-5xl">Start with the decision you need to make</h2>
            <p className="mt-5 text-lg leading-7 text-muted text-wrap-pretty">Four equal paths into the marketplace. Each one gives you the language, evidence, and risk context to make a useful first decision.</p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            {CATEGORY_DEFINITIONS.map((category, index) => {
              const Icon = categoryIcons[category.id];
              return (
                <a
                  key={category.id}
                  href="#featured-agents"
                  className="group min-h-64 rounded-3xl border border-surface-border bg-surface p-5 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-1 hover:border-[#6a6a6a] hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 focus:ring-offset-black sm:p-6"
                >
                  <div className="flex items-start justify-between">
                    <span className="flex size-12 items-center justify-center rounded-2xl bg-black text-brand">
                      <Icon size={24} weight="regular" />
                    </span>
                    <span className="font-mono text-xs text-muted">0{index + 1}</span>
                  </div>
                  <h3 className="mt-10 text-2xl font-semibold tracking-tight">{category.label}</h3>
                  <p className="mt-2 text-sm font-medium text-brand">{category.plainLanguage}</p>
                  <p className="mt-4 max-w-sm text-sm leading-6 text-muted">{category.description}</p>
                  <div className="mt-6 flex items-center gap-2 text-sm font-semibold text-foreground">
                    Browse strategy
                    <ArrowUpRight size={16} className="transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </div>
                </a>
              );
            })}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-24 lg:py-32">
          <TaglineReveal>Make a better hiring decision before an agent touches your capital</TaglineReveal>
        </section>

        <section id="featured-agents" className="mx-auto max-w-6xl scroll-mt-8 px-6 py-24 lg:py-32">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div className="max-w-2xl">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Marketplace preview</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-tight text-wrap-balance sm:text-5xl">Live agents with proof attached</h2>
              <p className="mt-5 text-lg leading-7 text-muted text-wrap-pretty">The first listings will appear here after they pass identity, Mainnet, and freshness checks.</p>
            </div>
            <a href="#categories" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 focus:ring-offset-black">
              Browse categories
              <ArrowRight size={16} />
            </a>
          </div>
          <div className="mt-10 rounded-3xl border border-dashed border-surface-border bg-surface px-6 py-14 text-center sm:px-10">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-surface-raised text-brand">
              <SquaresFour size={24} />
            </span>
            <h3 className="mt-5 text-xl font-semibold">No verified agents connected yet</h3>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted">This empty state is intentional. We will never show invented performance numbers. Verified agent records will appear with timestamps, sample sizes, and evidence links.</p>
            <a href="#trust" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full border border-surface-border px-4 py-2 text-sm font-semibold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 focus:ring-offset-black">
              See the trust requirements
              <CaretRight size={16} />
            </a>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-8 px-6 py-24 lg:py-32">
          <div className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">How hiring works</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight text-wrap-balance sm:text-5xl">Three steps from strategy to receipt</h2>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              { number: "01", title: "Choose a strategy", body: "Start with the outcome you need, not with a contract address or a protocol name." },
              { number: "02", title: "Inspect the evidence", body: "Read the identity, freshness, performance windows, risk, sample size, and on chain records." },
              { number: "03", title: "Hire with control", body: "Review the job terms, payment, and permission limits before you approve execution." },
            ].map((step) => (
              <article key={step.number} className="rounded-3xl border border-surface-border bg-surface p-6">
                <span className="font-mono text-sm text-brand">{step.number}</span>
                <h3 className="mt-12 text-2xl font-semibold tracking-tight">{step.title}</h3>
                <p className="mt-4 text-sm leading-6 text-muted">{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="trust" className="mx-auto max-w-6xl scroll-mt-8 px-6 py-24 lg:py-32">
          <div className="rounded-3xl border border-surface-border bg-surface p-6 sm:p-8 lg:p-10">
            <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Trust layer</p>
                <h2 className="mt-4 text-4xl font-semibold tracking-tight text-wrap-balance">Every claim needs a source</h2>
                <p className="mt-5 text-lg leading-7 text-muted text-wrap-pretty">The marketplace will treat freshness, identity, and evidence as hiring gates, not decorative badges.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { title: "ERC 8004 identity", body: "A visible agent identity with a registry address and explorer link." },
                  { title: "BSC Mainnet status", body: "Chain ID 56, heartbeat, last execution, and freshness state." },
                  { title: "Decision metrics", body: "Category KPIs with windows, sample sizes, timestamps, and sources." },
                  { title: "Hiring safeguards", body: "A clear path to job terms, payment receipts, and permission controls." },
                ].map((item) => (
                  <div key={item.title} className="rounded-2xl border border-surface-border bg-black p-4">
                    <ShieldCheck size={20} className="text-brand" />
                    <h3 className="mt-8 text-base font-semibold">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted">{item.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-24 lg:py-32">
          <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Questions first</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-tight text-wrap-balance">A safer way to start</h2>
              <p className="mt-5 text-lg leading-7 text-muted">The interface should explain the system before it asks for a signature.</p>
            </div>
            <div className="space-y-3">
              {faqItems.map((item) => (
                <details key={item.question} className="group rounded-2xl border border-surface-border bg-surface px-5 py-4">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-brand">
                    {item.question}
                    <CaretRight size={18} className="shrink-0 text-muted transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-open:rotate-90" />
                  </summary>
                  <p className="pt-4 text-sm leading-6 text-muted">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-28 pt-12 lg:pb-36">
          <div className="rounded-3xl border border-[#82660a] bg-[#131209] px-6 py-12 sm:px-10 lg:flex lg:items-end lg:justify-between lg:gap-10">
            <div className="max-w-2xl">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Start with the decision</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-tight text-wrap-balance sm:text-5xl">Find an agent you can explain to yourself</h2>
              <p className="mt-5 text-lg leading-7 text-muted">Browse by strategy, read the evidence, and keep control of the hiring step.</p>
            </div>
            <a href="#categories" className="mt-8 inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-brand px-4 py-2 text-base font-semibold text-black transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:bg-[#ffd34f] active:translate-y-px focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 focus:ring-offset-[#131209] lg:mt-0">
              Explore live agents
              <ArrowRight size={18} weight="bold" />
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-surface-border px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>Agent Studio on BNB Chain · Plow foundation</p>
          <div className="flex items-center gap-5">
            <a href="#trust" className="transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-brand">Trust requirements</a>
            <a href="#how-it-works" className="transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-brand">How it works</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
