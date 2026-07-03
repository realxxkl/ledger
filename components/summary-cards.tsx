"use client"

import { TrendingUp, Receipt, PiggyBank, CreditCard } from "lucide-react"
import type { LedgerData } from "@/lib/types"
import { currency } from "@/lib/types"

export function SummaryCards({ data }: { data: LedgerData }) {
  const totalEarned = data.entries.reduce((s, e) => s + e.earned, 0)
  const totalFees =
    data.entries.reduce((s, e) => s + e.feeAmt, 0) +
    data.withdrawals.reduce((s, w) => s + w.fee, 0)
  const totalProfit = data.entries.reduce((s, e) => s + e.profit, 0)
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
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => {
        const Icon = c.icon
        return (
          <div
            key={c.label}
            className="flex flex-col gap-3 border-2 border-border bg-card p-5"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {c.label}
              </span>
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            </div>
            <span className={`font-display text-3xl font-black tracking-tight ${c.tone}`}>
              {c.value}
            </span>
          </div>
        )
      })}
    </div>
  )
}
