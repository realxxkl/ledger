export function LoadingScreen({
  message = "Loading ledger data",
  overlay = false,
}: {
  message?: string
  overlay?: boolean
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={
        overlay
          ? "fixed inset-0 z-[100] flex min-h-screen items-center justify-center bg-background/95 px-4 py-8 backdrop-blur-sm"
          : "flex min-h-screen items-center justify-center bg-background px-4 py-8"
      }
    >
      <div className="w-full max-w-xl border-2 border-border bg-card">
        <div className="flex items-center justify-between border-b-2 border-border px-5 py-3">
          <span className="text-xs font-black uppercase tracking-[0.25em] text-primary">The Ledger</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Please wait</span>
        </div>
        <div className="flex items-center gap-5 px-5 py-8 sm:px-7">
          <span
            aria-hidden="true"
            className="size-12 shrink-0 animate-spin border-[3px] border-primary border-t-transparent motion-reduce:animate-none"
          />
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-black uppercase tracking-tight text-foreground sm:text-3xl">
              Processing
            </h1>
            <p className="mt-2 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground sm:text-sm">
              {message}
            </p>
          </div>
        </div>
        <div className="flex gap-1 border-t-2 border-border px-5 py-3" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((segment) => (
            <span
              key={segment}
              className={`h-1.5 flex-1 motion-safe:animate-pulse ${segment < 3 ? "bg-primary" : "bg-muted"}`}
              style={{ animationDelay: `${segment * 100}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
