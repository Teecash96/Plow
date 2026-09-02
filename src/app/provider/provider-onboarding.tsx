"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle,
  Fingerprint,
  Globe,
  ShieldCheck,
  SpinnerGap,
  Wallet,
  WarningCircle,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  connectErc8004Wallet,
  registerErc8004Identity,
  setErc8004AgentUri,
  type Erc8004RegistrationResult,
  type Erc8004TransactionResult,
} from "@/lib/chain/erc8004-wallet";
import { PROVIDER_HEALTH_PATH, PROVIDER_METADATA_PATH } from "@/lib/marketplace/provider-paths";

interface ProviderOnboardingProps {
  initialAgentId?: string;
  initialMetadataUrl?: string;
  initialProviderUrl?: string;
  initialProviderReady: boolean;
  initialProviderReason: string;
}

type BusyAction = "register" | "check" | "publish" | undefined;
type ServiceCheck = {
  status: "ready" | "unavailable";
  detail: string;
  agentId?: string;
};

function normalisePublicUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || !hostname) return undefined;
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) return undefined;
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function isAgentId(value: string) {
  return /^\d+$/.test(value.trim());
}

function shorten(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

async function responseJson(response: Response) {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function ProviderOnboarding({
  initialAgentId,
  initialMetadataUrl,
  initialProviderUrl,
  initialProviderReady,
  initialProviderReason,
}: ProviderOnboardingProps) {
  const [providerUrl, setProviderUrl] = useState(initialProviderUrl ?? "");
  const [agentId, setAgentId] = useState(initialAgentId ?? "");
  const [walletAddress, setWalletAddress] = useState<string>();
  const [busy, setBusy] = useState<BusyAction>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [registration, setRegistration] = useState<Erc8004RegistrationResult>();
  const [published, setPublished] = useState<Erc8004TransactionResult>();
  const [serviceCheck, setServiceCheck] = useState<ServiceCheck>();

  const publicBaseUrl = useMemo(() => normalisePublicUrl(providerUrl), [providerUrl]);
  const selectedAgentId = agentId.trim();
  const scopedMetadataUrl = publicBaseUrl && isAgentId(selectedAgentId)
    ? `${publicBaseUrl}${PROVIDER_METADATA_PATH}?agentId=${encodeURIComponent(selectedAgentId)}`
    : undefined;
  const metadataUrl = scopedMetadataUrl ?? initialMetadataUrl;
  const healthUrl = publicBaseUrl && isAgentId(selectedAgentId)
    ? `${publicBaseUrl}${PROVIDER_HEALTH_PATH}?agentId=${encodeURIComponent(selectedAgentId)}`
    : undefined;
  const serviceMatchesIdentity = serviceCheck?.status === "ready" && serviceCheck.agentId === agentId.trim();
  const canCheck = Boolean(publicBaseUrl && isAgentId(agentId) && !busy);
  const canPublish = Boolean(metadataUrl && serviceMatchesIdentity && !busy);

  function clearMessages() {
    setError(undefined);
    setNotice(undefined);
  }

  async function createIdentity() {
    clearMessages();
    setBusy("register");
    try {
      const wallet = await connectErc8004Wallet();
      setWalletAddress(wallet.account);
      const result = await registerErc8004Identity(wallet);
      setAgentId(result.agentId);
      setRegistration(result);
      setServiceCheck(undefined);
      setNotice(`Identity ${result.agentId} was registered. Configure the provider with this ID before publishing its metadata URI.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The ERC 8004 identity could not be registered.");
    } finally {
      setBusy(undefined);
    }
  }

  async function checkProvider() {
    clearMessages();
    if (!publicBaseUrl || !healthUrl || !metadataUrl) {
      setError("Enter a public HTTPS provider URL before checking the service.");
      return;
    }
    if (!isAgentId(agentId)) {
      setError("Enter the numeric ERC 8004 agent ID before checking the service.");
      return;
    }
    setBusy("check");
    try {
      const [healthResponse, metadataResponse] = await Promise.all([
        fetch(healthUrl, { cache: "no-store" }),
        fetch(metadataUrl, { cache: "no-store" }),
      ]);
      const health = await responseJson(healthResponse);
      const metadata = await responseJson(metadataResponse);
      const healthAgentId = typeof health.agentId === "string" ? health.agentId : undefined;
      const metadataAgentId = typeof metadata.agentId === "string" ? metadata.agentId : undefined;
      if (!healthResponse.ok || !metadataResponse.ok) {
        const reason = typeof health.reason === "string" ? health.reason : typeof metadata.error === "string" ? metadata.error : "The provider service did not return ready responses.";
        setServiceCheck({ status: "unavailable", detail: reason, agentId: healthAgentId });
        return;
      }
      if (healthAgentId !== agentId.trim() || metadataAgentId !== agentId.trim()) {
        setServiceCheck({ status: "unavailable", detail: "The provider service is ready for a different ERC 8004 agent ID.", agentId: healthAgentId ?? metadataAgentId });
        return;
      }
      setServiceCheck({ status: "ready", detail: "Health and metadata match this identity.", agentId: agentId.trim() });
    } catch {
      setServiceCheck({ status: "unavailable", detail: "The browser could not reach both provider endpoints. Use the deployed HTTPS URL and check again." });
    } finally {
      setBusy(undefined);
    }
  }

  async function publishMetadata() {
    clearMessages();
    if (!metadataUrl || !canPublish) {
      setError("Check the provider service and confirm that its configured agent ID matches this identity.");
      return;
    }
    setBusy("publish");
    try {
      const wallet = await connectErc8004Wallet();
      setWalletAddress(wallet.account);
      const result = await setErc8004AgentUri(wallet, agentId, metadataUrl);
      setPublished(result);
      setNotice("The ERC 8004 identity now points to the provider metadata URL.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The provider metadata URI could not be published.");
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-surface-border px-4 py-4 sm:px-6 sm:py-5">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3 text-sm font-semibold tracking-tight">
            <span className="flex size-8 items-center justify-center rounded-full bg-brand text-black">P</span>
            BNB Agent Studio
          </Link>
          <Link href="/agents" className="inline-flex min-h-11 items-center gap-2 text-sm text-muted transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-brand">
            <ArrowLeft size={16} /> Browse agents
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-12 sm:px-6 sm:pt-16 lg:pt-24">
        <section className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">Provider setup</p>
          <h1 className="mt-4 text-4xl font-semibold leading-none tracking-tight text-wrap-balance sm:text-6xl">Create an identity you control</h1>
          <p className="mt-6 text-lg leading-7 text-muted text-wrap-pretty">Register a new ERC 8004 identity with your wallet, connect its Plow service, then publish the service metadata on chain.</p>
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-3" aria-label="Provider setup steps">
          {[
            { number: "01", title: "Register", body: "Create a new identity on BSC Mainnet." },
            { number: "02", title: "Configure", body: "Set the provider environment to the new identity." },
            { number: "03", title: "Publish", body: "Point the identity to verified HTTPS metadata." },
          ].map((step) => (
            <article key={step.number} className="rounded-3xl border border-surface-border bg-surface p-5">
              <span className="font-mono text-sm text-brand">{step.number}</span>
              <h2 className="mt-8 text-xl font-semibold">{step.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{step.body}</p>
            </article>
          ))}
        </section>

        <section className="mt-10 rounded-3xl border border-[#9a843c] bg-[#211d0d] p-5 sm:p-6" aria-label="Network warning">
          <div className="flex items-start gap-3">
            <WarningCircle size={24} className="mt-0.5 shrink-0 text-brand" />
            <div>
              <h2 className="font-semibold">BSC Mainnet wallet required</h2>
              <p className="mt-2 text-sm leading-6 text-[#e8d995]">The ERC 8004 identity registry is on BSC Mainnet, chain 56. Your wallet must hold a small amount of BNB for gas. This is separate from the BSC Testnet hire flow.</p>
              <p className="mt-2 text-sm leading-6 text-[#e8d995]">Plow never asks for a private key. Your wallet signs each transaction.</p>
            </div>
          </div>
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <article className="rounded-3xl border border-surface-border bg-surface p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <Fingerprint size={24} className="mt-0.5 text-brand" />
                <div>
                  <h2 className="text-2xl font-semibold">1. Register an identity</h2>
                  <p className="mt-2 text-sm leading-6 text-muted">This sends one wallet transaction to the official ERC 8004 identity registry. The contract assigns the agent ID.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void createIdentity()}
                disabled={Boolean(busy)}
                className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand px-5 py-3 text-sm font-semibold text-black hover:bg-[#ffd34f] disabled:cursor-not-allowed disabled:bg-[#5a5230] disabled:text-[#b9ae7b] focus:outline-none focus:ring-2 focus:ring-brand"
              >
                {busy === "register" ? <SpinnerGap size={18} className="animate-spin" /> : <Wallet size={18} />}
                {busy === "register" ? "Waiting for wallet" : "Create new ERC 8004 identity"}
              </button>
              {registration ? (
                <div className="mt-5 rounded-2xl border border-[#5a9876] bg-[#10271f] p-4 text-sm text-positive">
                  <p className="font-semibold">Identity registered: {registration.agentId}</p>
                  <div className="mt-2 flex flex-wrap gap-4">
                    <a href={registration.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 underline underline-offset-4">View transaction <ArrowUpRight size={15} /></a>
                    <a href={registration.agentExplorerUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 underline underline-offset-4">View identity <ArrowUpRight size={15} /></a>
                  </div>
                </div>
              ) : null}
            </article>

            <article className="rounded-3xl border border-surface-border bg-surface p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <Globe size={24} className="mt-0.5 text-brand" />
                <div>
                  <h2 className="text-2xl font-semibold">2. Connect the provider</h2>
                  <p className="mt-2 text-sm leading-6 text-muted">The URL must be the public HTTPS origin where the Plow provider routes are deployed. Localhost cannot be published on chain.</p>
                </div>
              </div>
              <label className="mt-6 block text-sm font-semibold" htmlFor="provider-url">Public provider URL</label>
              <input
                id="provider-url"
                value={providerUrl}
                onChange={(event) => { setProviderUrl(event.target.value); setServiceCheck(undefined); }}
                placeholder="https://your-provider.example"
                className="mt-2 min-h-12 w-full rounded-2xl border border-surface-border bg-black px-4 text-sm text-foreground outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand"
              />
              <label className="mt-5 block text-sm font-semibold" htmlFor="agent-id">ERC 8004 agent ID</label>
              <input
                id="agent-id"
                inputMode="numeric"
                value={agentId}
                onChange={(event) => { setAgentId(event.target.value); setServiceCheck(undefined); }}
                placeholder="Assigned after registration"
                className="mt-2 min-h-12 w-full rounded-2xl border border-surface-border bg-black px-4 font-mono text-sm text-foreground outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand"
              />
              <button
                type="button"
                onClick={() => void checkProvider()}
                disabled={!canCheck}
                className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-surface-border px-4 py-2 text-sm font-semibold text-muted hover:border-[#6a6a6a] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand"
              >
                {busy === "check" ? <SpinnerGap size={17} className="animate-spin" /> : <ShieldCheck size={17} />}
                {busy === "check" ? "Checking service" : "Check provider service"}
              </button>
              {serviceCheck ? (
                <div className={`mt-5 rounded-2xl border p-4 text-sm ${serviceCheck.status === "ready" ? "border-[#5a9876] bg-[#10271f] text-positive" : "border-[#ad6565] bg-[#281313] text-[#f0b4b4]"}`}>
                  <p className="font-semibold">{serviceCheck.status === "ready" ? "Provider service ready" : "Provider service not ready"}</p>
                  <p className="mt-1 leading-6">{serviceCheck.detail}</p>
                </div>
              ) : (
                <p className="mt-4 text-xs leading-5 text-muted">{initialProviderReady ? "The server reports a configured provider. Check it again after entering the identity ID." : initialProviderReason}</p>
              )}
            </article>

            <article className="rounded-3xl border border-surface-border bg-surface p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <CheckCircle size={24} className="mt-0.5 text-brand" />
                <div>
                  <h2 className="text-2xl font-semibold">3. Publish the metadata URI</h2>
                  <p className="mt-2 text-sm leading-6 text-muted">After the provider check passes, this verifies wallet ownership and sends one wallet transaction to set the identity URI.</p>
                </div>
              </div>
              <div className="mt-6 rounded-2xl border border-surface-border bg-black p-4">
                <p className="text-xs text-muted">Metadata URI</p>
                <p className="mt-2 break-all font-mono text-sm">{metadataUrl ?? "Enter a public HTTPS URL"}</p>
              </div>
              <button
                type="button"
                onClick={() => void publishMetadata()}
                disabled={!canPublish}
                className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand px-5 py-3 text-sm font-semibold text-black hover:bg-[#ffd34f] disabled:cursor-not-allowed disabled:bg-[#5a5230] disabled:text-[#b9ae7b] focus:outline-none focus:ring-2 focus:ring-brand"
              >
                {busy === "publish" ? <SpinnerGap size={18} className="animate-spin" /> : <Fingerprint size={18} />}
                {busy === "publish" ? "Waiting for wallet" : "Publish metadata URI"}
              </button>
              {published ? (
                <div className="mt-5 rounded-2xl border border-[#5a9876] bg-[#10271f] p-4 text-sm text-positive">
                  <p className="font-semibold">Metadata URI published.</p>
                  <a href={published.explorerUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-1.5 underline underline-offset-4">View transaction <ArrowUpRight size={15} /></a>
                </div>
              ) : null}
            </article>
          </div>

          <aside className="space-y-6">
            <div className="rounded-3xl border border-surface-border bg-surface p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <ShieldCheck size={22} className="mt-0.5 text-brand" />
                <div>
                  <h2 className="text-lg font-semibold">What this protects</h2>
                  <ul className="mt-4 space-y-3 text-sm leading-6 text-muted">
                    <li>Only the connected wallet owner can update the identity URI.</li>
                    <li>The URI must use HTTPS and cannot point to localhost.</li>
                    <li>The service check must match the identity before publishing.</li>
                    <li>No private key is collected or sent to Plow.</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-surface-border bg-surface p-5 sm:p-6">
              <h2 className="text-lg font-semibold">Provider environment</h2>
              <p className="mt-2 text-sm leading-6 text-muted">Add these values to the deployed provider environment after registration. Use one profile for each independent marketplace identity. Keep all keys server side.</p>
              <pre className="mt-4 overflow-x-auto rounded-2xl border border-surface-border bg-black p-4 font-mono text-xs leading-6 text-[#e8d995]">{`PLOW_PROVIDER_ENABLED=true
PLOW_PROVIDER_PUBLIC_URL=${publicBaseUrl || "<public HTTPS URL>"}
PLOW_PROVIDER_REQUEST_SECRET=<server secret>
PLOW_PROVIDER_PROFILES='[{"agentId":"${agentId || "<agent ID>"}","categories":["rebalancing"],"price":"0.25","currency":"U","privateKey":"<identity owner key>"}]'`}</pre>
              <p className="mt-4 text-xs leading-5 text-muted">The four categories are rebalancing, grid trading, yield optimisation, and health factor monitoring. One identity may advertise all four. Four separate listings need four identities and four signer keys. This page never collects those keys.</p>
            </div>

            {walletAddress ? (
              <div className="rounded-3xl border border-surface-border bg-surface p-5 text-sm">
                <p className="text-xs text-muted">Connected wallet</p>
                <p className="mt-2 break-all font-mono">{shorten(walletAddress)}</p>
              </div>
            ) : null}
          </aside>
        </section>

        {error ? <p role="alert" className="mt-8 rounded-2xl border border-[#ad6565] bg-[#281313] px-4 py-3 text-sm leading-6 text-[#f0b4b4]">{error}</p> : null}
        {notice ? <p role="status" className="mt-8 rounded-2xl border border-[#5a9876] bg-[#10271f] px-4 py-3 text-sm leading-6 text-positive">{notice}</p> : null}
      </main>
    </div>
  );
}
