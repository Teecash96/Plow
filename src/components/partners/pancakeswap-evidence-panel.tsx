import { ArrowsClockwise, Coins, Globe } from "@phosphor-icons/react/ssr";
import type { PancakeSwapEvidence, PancakeSwapEvidenceItem } from "@/lib/marketplace/types";

function statusClass(status: PancakeSwapEvidence["status"] | PancakeSwapEvidenceItem["status"]) {
  if (status === "live") return "border-[#5a9876] bg-[#10261c] text-positive";
  if (status === "demo") return "border-[#9a843c] bg-[#211d0d] text-[#e8d995]";
  return "border-surface-border text-muted";
}

function EvidenceRow({ label, item }: { label: string; item: PancakeSwapEvidenceItem }) {
  return (
    <div className="rounded-2xl border border-surface-border bg-black p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold">{label}</p><span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${statusClass(item.status)}`}>{item.status}</span></div>
      <p className="mt-3 text-sm">{item.value ?? "Not enough data"}</p>
      <p className="mt-2 font-mono text-xs text-muted">Captured {item.capturedAt}</p>
      {item.note ? <p className="mt-3 text-xs leading-5 text-muted">{item.note}</p> : null}
      {item.transactionHash ? <p className="mt-3 break-all font-mono text-xs text-muted">Transaction: {item.explorerUrl ? <a href={item.explorerUrl} target="_blank" rel="noreferrer" className="text-brand underline decoration-brand/40 underline-offset-4 hover:decoration-brand">{item.transactionHash}</a> : item.transactionHash}</p> : null}
      {item.explorerUrl ? <a href={item.explorerUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-xs font-semibold text-brand underline decoration-brand/40 underline-offset-4 hover:decoration-brand">Open transaction</a> : null}
    </div>
  );
}

export function PancakeSwapEvidencePanel({ evidence }: { evidence?: PancakeSwapEvidence }) {
  return (
    <section className="rounded-3xl border border-surface-border bg-surface p-6" aria-labelledby="pancakeswap-evidence-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-black text-brand"><Globe size={21} /></span>
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-brand">PancakeSwap</p>
            <h2 id="pancakeswap-evidence-heading" className="mt-2 text-2xl font-semibold">Pool and LP evidence</h2>
          </div>
        </div>
        <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold capitalize ${statusClass(evidence?.status ?? "unavailable")}`}>{evidence?.status ?? "unavailable"}</span>
      </div>

      {!evidence ? (
        <div className="mt-6 rounded-2xl border border-dashed border-surface-border bg-black p-5">
          <p className="text-sm font-semibold">No PancakeSwap evidence connected</p>
          <p className="mt-2 text-sm leading-6 text-muted">This category can show pool, range, fee, and transaction evidence when a verified PancakeSwap feed is attached.</p>
        </div>
      ) : (
        <>
          <dl className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-surface-border bg-black p-4"><dt className="text-xs text-muted">Pool or pair</dt><dd className="mt-2 text-sm font-semibold">{evidence.pair}</dd></div>
            <div className="rounded-2xl border border-surface-border bg-black p-4"><dt className="text-xs text-muted">Pool address</dt><dd className="mt-2 break-all font-mono text-xs">{evidence.poolAddress}</dd></div>
            <div className="rounded-2xl border border-surface-border bg-black p-4"><dt className="text-xs text-muted">Fee tier</dt><dd className="mt-2 text-sm font-semibold">{evidence.feeTier ?? "Not available"}</dd></div>
          </dl>
          <div className="mt-5 flex items-start gap-2 rounded-2xl border border-surface-border bg-black px-4 py-3 text-sm leading-6 text-muted"><Coins size={17} className="mt-1 shrink-0 text-brand" /><span>{evidence.benefitStatement}</span></div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-muted"><ArrowsClockwise size={15} />Range updates</div>
              <div className="space-y-3">{evidence.rangeUpdates.length ? evidence.rangeUpdates.map((item, index) => <EvidenceRow key={`${item.capturedAt}-${index}`} label={`Update ${index + 1}`} item={item} />) : <EvidenceRow label="Range updates" item={{ status: "unavailable", capturedAt: "Not available" }} />}</div>
            </div>
            <div>
              <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-muted"><Coins size={15} />Fee capture</div>
              <EvidenceRow label="Fee capture" item={evidence.feeCapture} />
            </div>
          </div>
          {evidence.poolUrl ? <a href={evidence.poolUrl} target="_blank" rel="noreferrer" className="mt-5 inline-flex text-xs font-semibold text-brand underline decoration-brand/40 underline-offset-4 hover:decoration-brand">Open PancakeSwap pool</a> : null}
          <p className="mt-4 text-xs text-muted">Source: {evidence.source}. Empty values are not live claims.</p>
        </>
      )}
    </section>
  );
}
