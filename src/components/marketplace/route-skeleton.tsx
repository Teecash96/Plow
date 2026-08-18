type RouteSkeletonVariant = "browse" | "detail" | "hire" | "jobs";

const labels: Record<RouteSkeletonVariant, string> = {
  browse: "Loading agent registry",
  detail: "Loading agent profile",
  hire: "Loading hiring workspace",
  jobs: "Loading jobs",
};

export function RouteSkeleton({ variant }: { variant: RouteSkeletonVariant }) {
  return (
    <div className="min-h-screen bg-background px-4 py-4 text-foreground sm:px-6 sm:py-5" role="status" aria-live="polite" aria-busy="true">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-4 border-b border-surface-border pb-4 sm:pb-5">
        <div className="flex items-center gap-3"><span className="size-8 animate-pulse rounded-full bg-surface-raised" /><span className="h-4 w-36 animate-pulse rounded bg-surface-raised" /></div>
        <span className="h-4 w-20 animate-pulse rounded bg-surface-raised" />
      </header>
      <main className="mx-auto max-w-7xl pb-28 pt-12 sm:pt-16">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">{labels[variant]}</p>
        <div className="mt-4 h-12 max-w-2xl animate-pulse rounded-2xl bg-surface sm:h-16" />
        <div className="mt-6 h-6 max-w-xl animate-pulse rounded bg-surface" />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: variant === "browse" ? 6 : 3 }, (_, index) => <div key={index} className="h-56 animate-pulse rounded-3xl border border-surface-border bg-surface" />)}
        </div>
      </main>
    </div>
  );
}
