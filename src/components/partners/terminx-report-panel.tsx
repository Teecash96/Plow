import { ChartLineUp, Clock, Swap } from "@phosphor-icons/react/ssr";
import type { TermiXAdvantageReport } from "@/lib/marketplace/types";

function statusClass(status: TermiXAdvantageReport["status"]) {
  if (status === "live") return "border-[#5a9876] bg-[#10261c] text-positive";
  if (status === "demo") return "border-[#9a843c] bg-[#211d0d] text-[#e8d995]";
  return "border-surface-border text-muted";
}

export function TermiXReportPanel({ reports }: { reports?: readonly TermiXAdvantageReport[] }) {
  return (
    <section className="rounded-3xl border border-surface-border bg-surface p-6" aria-labelledby="terminx-report-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-black text-brand"><Swap size={21} /></span>
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-brand">TermiX</p>
            <h2 id="terminx-report-heading" className="mt-2 text-2xl font-semibold">Agent Advantage Report</h2>
          </div>
        </div>
        <span className="rounded-full border border-surface-border px-3 py-1.5 text-xs font-semibold text-muted">Human versus agent</span>
      </div>

      {!reports?.length ? (
        <div className="mt-6 rounded-2xl border border-dashed border-surface-border bg-black p-5">
          <p className="text-sm font-semibold">No benchmark report connected</p>
          <p className="mt-2 text-sm leading-6 text-muted">A report will compare both operators on the same task. Time, cost, output quality, sample size, timestamp, and source will remain blank until TermiX evidence is attached.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {reports.map((report) => (
            <article key={report.reportId} className="rounded-2xl border border-surface-border bg-black p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{report.taskDefinition}</p>
                  <p className="mt-2 break-all font-mono text-xs text-muted">{report.reportId} · {report.category}</p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${statusClass(report.status)}`}>{report.status}</span>
              </div>

              <div className="mt-5 hidden max-w-full overflow-x-auto rounded-2xl border border-surface-border sm:block">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <thead className="border-b border-surface-border text-xs text-muted"><tr><th className="px-4 py-3 font-medium">Operator</th><th className="px-4 py-3 font-medium">Time</th><th className="px-4 py-3 font-medium">Cost</th><th className="px-4 py-3 font-medium">Output quality</th></tr></thead>
                  <tbody>
                    <tr className="border-b border-surface-border"><th className="px-4 py-3 font-medium">Human</th><td className="px-4 py-3">{report.human.time}</td><td className="px-4 py-3">{report.human.cost}</td><td className="px-4 py-3">{report.human.outputQuality}</td></tr>
                    <tr><th className="px-4 py-3 font-medium">Agent</th><td className="px-4 py-3">{report.agent.time}</td><td className="px-4 py-3">{report.agent.cost}</td><td className="px-4 py-3">{report.agent.outputQuality}</td></tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-5 grid gap-3 sm:hidden">
                {[
                  { label: "Human", values: report.human },
                  { label: "Agent", values: report.agent },
                ].map((operator) => (
                  <div key={operator.label} className="rounded-2xl border border-surface-border bg-surface p-4">
                    <p className="text-sm font-semibold">{operator.label}</p>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div><dt className="text-muted">Time</dt><dd className="mt-1 break-words">{operator.values.time}</dd></div>
                      <div><dt className="text-muted">Cost</dt><dd className="mt-1 break-words">{operator.values.cost}</dd></div>
                      <div><dt className="text-muted">Quality</dt><dd className="mt-1 break-words">{operator.values.outputQuality}</dd></div>
                    </dl>
                  </div>
                ))}
              </div>

              <dl className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-surface-border p-3"><dt className="flex items-center gap-2 text-xs text-muted"><ChartLineUp size={14} />Sample size</dt><dd className="mt-2 text-sm font-semibold">{report.sampleSize || "No samples"}</dd></div>
                <div className="rounded-xl border border-surface-border p-3"><dt className="flex items-center gap-2 text-xs text-muted"><Clock size={14} />Captured</dt><dd className="mt-2 text-sm font-semibold">{report.capturedAt}</dd></div>
                <div className="rounded-xl border border-surface-border p-3"><dt className="text-xs text-muted">Source</dt><dd className="mt-2 text-sm font-semibold capitalize">{report.source}</dd></div>
              </dl>
              {report.notes ? <p className="mt-4 text-xs leading-5 text-muted">{report.notes}</p> : null}
              {report.reportUrl ? <a href={report.reportUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex text-xs font-semibold text-brand underline decoration-brand/40 underline-offset-4 hover:decoration-brand">Open TermiX report</a> : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
