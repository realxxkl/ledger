import Image from "next/image"
import type { Entry } from "@/lib/types"

const COMPLETED_STATUSES = new Set(["completed", "delivered"])

export function OrderSphere({ entries }: { entries: Entry[] }) {
  const orders = entries.filter((entry) =>
    Boolean(entry.source || entry.u7buyOrderId || entry.externalOrderId || entry.orderStatus),
  )
  const completedCount = orders.filter((entry) =>
    COMPLETED_STATUSES.has((entry.orderStatus ?? "").trim().toLowerCase()),
  ).length
  const activeCount = Math.max(0, orders.length - completedCount)
  const diameter = Math.min(336, Math.round(180 + Math.sqrt(orders.length) * 15))

  return (
    <section className="overflow-hidden border border-border bg-card" aria-labelledby="order-sphere-heading">
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Order activity</p>
          <h2 id="order-sphere-heading" className="mt-1 font-display text-xl font-black uppercase tracking-tight">
            Order sphere
          </h2>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
            Every order adds another layer to your growing orbit.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-3xl font-black leading-none text-primary tabular-nums">
            {orders.length.toLocaleString("en-US")}
          </p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {orders.length === 1 ? "Order logged" : "Orders logged"}
          </p>
        </div>
      </div>

      <div className="order-sphere-stage relative flex h-[260px] items-center justify-center overflow-hidden sm:h-[300px]">
        <div className="order-sphere-glow" aria-hidden="true" />
        <div className="order-sphere-orbit order-sphere-orbit--one" aria-hidden="true" />
        <div className="order-sphere-orbit order-sphere-orbit--two" aria-hidden="true" />
        <Image
          src="/images/order-sphere.png"
          alt=""
          aria-hidden="true"
          width={1024}
          height={1024}
          sizes="(max-width: 768px) 75vw, 336px"
          className="order-sphere-art relative z-10 h-auto max-h-[92%] max-w-[88%] object-contain"
          style={{ width: `${diameter}px` }}
          priority
        />
      </div>

      <div className="grid grid-cols-2 border-t border-border text-xs">
        <div className="px-5 py-3 sm:px-6">
          <p className="font-display text-lg font-black tabular-nums text-primary">{completedCount.toLocaleString("en-US")}</p>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Completed</p>
        </div>
        <div className="border-l border-border px-5 py-3 sm:px-6">
          <p className="font-display text-lg font-black tabular-nums text-foreground">{activeCount.toLocaleString("en-US")}</p>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">In progress</p>
        </div>
      </div>
    </section>
  )
}
