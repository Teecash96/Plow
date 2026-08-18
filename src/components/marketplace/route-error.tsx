"use client";

import { ArrowLeft, ArrowClockwise, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";

interface RouteErrorProps {
  title: string;
  description: string;
  reset: () => void;
  backHref?: string;
  backLabel?: string;
}

export function RouteError({ title, description, reset, backHref = "/", backLabel = "Return home" }: RouteErrorProps) {
  return (
    <div className="min-h-screen bg-background px-4 py-4 text-foreground sm:px-6 sm:py-5">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-4 border-b border-surface-border pb-4 sm:pb-5">
        <Link href="/" className="flex min-h-11 items-center gap-3 text-sm font-semibold tracking-tight"><span className="flex size-8 items-center justify-center rounded-full bg-brand text-black">P</span><span>BNB Agent Studio</span></Link>
      </header>
      <main className="mx-auto flex max-w-2xl flex-col items-center px-2 pb-28 pt-24 text-center sm:pt-32">
        <span className="flex size-14 items-center justify-center rounded-2xl border border-[#ad6565] bg-[#281313] text-negative"><WarningCircle size={28} /></span>
        <p className="mt-6 font-mono text-xs uppercase tracking-[0.16em] text-brand">Page recovery</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-wrap-balance sm:text-5xl">{title}</h1>
        <p className="mt-5 text-base leading-7 text-muted text-wrap-pretty">{description}</p>
        <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <button type="button" onClick={reset} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-black hover:bg-[#ffd34f] focus:outline-none focus:ring-2 focus:ring-brand"><ArrowClockwise size={16} /> Try again</button>
          <Link href={backHref} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-surface-border px-5 py-2 text-sm font-semibold text-muted hover:border-[#6a6a6a] hover:text-foreground focus:outline-none focus:ring-2 focus:ring-brand"><ArrowLeft size={16} /> {backLabel}</Link>
        </div>
      </main>
    </div>
  );
}
