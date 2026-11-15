"use client"

import { TrendingUp, Receipt, PiggyBank, CreditCard } from "lucide-react"
import type { LedgerData } from "@/lib/types"
import { currency } from "@/lib/types"

export function SummaryCards({ data }: { data: LedgerData }) {
  const totalEarned = data.entries.reduce((s, e) => s + e.earned, 0)
  const totalFees =
    data.entries.reduce((s, e) => s + e.feeAmt, 0) +
    data.withdrawals.reduce((s, w) => s + w.fee, 0)
  const entriesProfit = data.entries.reduce((s, e) => s + e.profit, 0)
  const withdrawalFees = data.withdrawals.reduce((s, w) => s + w.fee, 0)
  const totalProfit = entriesProfit - withdrawalFees
  const totalPaid = data.entries.reduce((s, e) => s + e.paid, 0)

  const cards = [
    {
      label: "Total Earned",
      value: currency(totalEarned),
      icon: TrendingUp,
      tone: "text-foreground",
    },
    {
      label: "Total Fees",
      value: currency(totalFees),
      icon: Receipt,
      tone: "text-negative",
    },
    {
      label: "Net Profit",
      value: currency(totalProfit),
      icon: PiggyBank,
      tone: totalProfit >= 0 ? "text-primary" : "text-negative",
    },
    {
      label: "Total Paid",
      value: currency(totalPaid),
      icon: CreditCard,
      tone: "text-foreground",
    },
  ]

  return (
    <div className="grid grid-cols-2 overflow-hidden border border-border bg-card lg:grid-cols-4">
      {cards.map((c) => {
        const Icon = c.icon
        return (
          <div
            key={c.label}
            className="flex min-w-0 flex-col gap-3 border-b border-r border-border p-4 last:border-b-0 even:border-r-0 [&:nth-child(n+3)]:border-b-0 sm:p-5 lg:border-b-0 lg:border-r lg:even:border-r lg:last:border-r-0"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                {c.label}
              </span>
              <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
            </div>
            <span className={`font-display text-2xl font-black tracking-tight sm:text-3xl ${c.tone}`}>
              {c.value}
            </span>
          </div>
        )
      })}
    </div>
  )
}
