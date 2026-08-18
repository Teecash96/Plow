import { MagnifyingGlass, SquaresFour } from "@phosphor-icons/react/ssr";
import Link from "next/link";

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  search?: boolean;
}

export function EmptyState({ title, description, actionLabel, actionHref, search = false }: EmptyStateProps) {
  const Icon = search ? MagnifyingGlass : SquaresFour;

  return (
    <div className="rounded-3xl border border-dashed border-surface-border bg-surface px-6 py-16 text-center sm:px-10">
      <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-surface-raised text-brand">
        <Icon size={24} />
      </span>
      <h2 className="mt-5 text-xl font-semibold tracking-tight text-wrap-balance">{title}</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted text-wrap-pretty">{description}</p>
      {actionLabel && actionHref ? (
        <Link
          href={actionHref}
          className="mt-6 inline-flex min-h-11 items-center rounded-full border border-surface-border px-4 py-2 text-sm font-semibold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[#6a6a6a] hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 focus:ring-offset-black"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
