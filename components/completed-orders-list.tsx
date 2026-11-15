import Link from "next/link"
import { ArrowUpRight, PackageCheck } from "lucide-react"
import type { Entry } from "@/lib/types"
import { currency } from "@/lib/types"

const COMPLETED_STATUSES = new Set(["completed", "delivered"])

export function CompletedOrdersList({
  entries,
  onViewAll,
}: {
  entries: Entry[]
  onViewAll: () => void
}) {
  const completedOrders = entries
    .filter((entry) => COMPLETED_STATUSES.has((entry.orderStatus ?? "").trim().toLowerCase()))
    .sort((left, right) => right.date.localeCompare(left.date) || Number(right.id) - Number(left.id))
    .slice(0, 5)

  return (
    <section className="flex min-h-[360px] flex-col border border-border bg-card" aria-labelledby="completed-orders-heading">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Recently finished</p>
          <h2 id="completed-orders-heading" className="mt-1 font-display text-xl font-black uppercase tracking-tight">
            Completed orders
          </h2>
        </div>
        <button
          type="button"
          onClick={onViewAll}
          className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary transition-colors hover:text-foreground"
        >
          All orders <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      {completedOrders.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-5 py-10 text-center">
          <PackageCheck className="size-7 text-primary/70" aria-hidden="true" />
          <p className="mt-3 text-xs font-bold uppercase tracking-wider text-foreground">Nothing completed yet</p>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
            Finished orders will appear here as your sphere grows.
          </p>
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-border">
          {completedOrders.map((entry) => {
            const hasOrderDetails = Boolean(entry.u7buyOrderId || entry.externalOrderId)
            const service = hasOrderDetails ? (
              <Link href={`/orders/${entry.id}`} className="font-bold text-foreground transition-colors hover:text-primary">
                {entry.service}
              </Link>
            ) : (
              <span className="font-bold text-foreground">{entry.service}</span>
            )

            return (
              <li key={entry.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <div className="truncate text-sm">{service}</div>
                  <p className="mt-1 truncate text-[10px] uppercase tracking-wider text-muted-foreground">
                    {entry.platform} <span aria-hidden="true">·</span> {entry.date}
                  </p>
                </div>
                <span className={`shrink-0 font-display text-sm font-bold tabular-nums ${entry.profit >= 0 ? "text-primary" : "text-negative"}`}>
                  {currency(entry.profit)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
