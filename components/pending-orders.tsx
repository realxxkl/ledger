"use client"

import { Clock3, PackageCheck } from "lucide-react"
import type { Entry } from "@/lib/types"
import { currency } from "@/lib/types"

const COMPLETED_STATUSES = new Set(["Completed", "Cancelled", "Delivered"])

function statusTone(status: string) {
  if (status === "Awaiting Delivery" || status === "To Receive") {
    return "border-primary bg-primary/10 text-primary"
  }
  return "border-border bg-muted/40 text-muted-foreground"
}

export function PendingOrders({ entries }: { entries: Entry[] }) {
  const orders = entries.filter(
    (entry) => entry.u7buyOrderId && entry.orderStatus && !COMPLETED_STATUSES.has(entry.orderStatus),
  )

  return (
    <section className="border-2 border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-border px-5 py-4">
        <div>
          <h2 className="font-display text-xl font-black uppercase tracking-tight">Pending orders</h2>
          <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
            U7Buy orders that still need attention
          </p>
        </div>
        <span className="border-2 border-primary px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
          {orders.length} {orders.length === 1 ? "order" : "orders"}
        </span>
      </div>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
          <PackageCheck className="size-8 text-primary" aria-hidden="true" />
          <p className="text-sm font-bold uppercase tracking-wider text-muted-foreground">No pending orders</p>
          <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
            New U7Buy orders will appear here automatically when they arrive.
          </p>
        </div>
      ) : (
        <div className="divide-y-2 divide-border">
          {orders.map((order) => (
            <article key={order.id} className="grid gap-4 px-5 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate font-bold text-foreground">{order.service}</h3>
                  <span className="border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {order.platform}
                  </span>
                </div>
                <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
                  Order {order.u7buyOrderId} · {order.date}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                <Clock3 className="size-3.5" aria-hidden="true" />
                <span className={`border px-2 py-1 font-bold ${statusTone(order.orderStatus || "")}`}>
                  {order.orderStatus}
                </span>
              </div>
              <p className="text-right font-display text-lg font-black text-primary">{currency(order.earned)}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export function pendingOrderCount(entries: Entry[]) {
  return entries.filter(
    (entry) => entry.u7buyOrderId && entry.orderStatus && !COMPLETED_STATUSES.has(entry.orderStatus),
  ).length
}
