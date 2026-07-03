"use client"

import { useMemo, useState } from "react"
import { Trash2, X } from "lucide-react"
import type { LedgerData } from "@/lib/types"
import { currency } from "@/lib/types"
import { apiSend } from "@/lib/use-ledger"

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number)
  if (!y || !m) return month
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

export function EntriesTable({
  data,
  onChange,
  focusMonth,
  onClearFocus,
}: {
  data: LedgerData
  onChange: () => void
  focusMonth?: string | null
  onClearFocus?: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)

  const remove = async (id: string) => {
    setBusy(id)
    try {
      await apiSend(`/api/entries?id=${id}`, "DELETE")
      onChange()
    } finally {
      setBusy(null)
    }
  }

  // When a chart month is focused, show only that month's rows.
  const rows = useMemo(() => {
    if (!focusMonth) return data.entries
    return data.entries.filter((e) => (e.date || "").slice(0, 7) === focusMonth)
  }, [data.entries, focusMonth])

  return (
    <div className="border-2 border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-border px-5 py-4">
        <h2 className="font-display text-xl font-black uppercase tracking-tight">Sales</h2>
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      {focusMonth && (
        <div className="flex items-center justify-between gap-3 border-b-2 border-primary bg-primary/10 px-5 py-2.5">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">
            Showing {monthLabel(focusMonth)}
          </span>
          <button
            onClick={onClearFocus}
            className="flex items-center gap-1 border border-primary px-2 py-1 text-xs font-bold uppercase tracking-wider text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            <X className="size-3" aria-hidden="true" />
            Clear
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm uppercase tracking-wider text-muted-foreground">
          {focusMonth ? "No sales in this month." : "No sales yet. Add your first one above."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-3 font-bold">Date</th>
                <th className="px-5 py-3 font-bold">Service</th>
                <th className="px-5 py-3 font-bold">Platform</th>
                <th className="px-5 py-3 text-right font-bold">Earned</th>
                <th className="px-5 py-3 text-right font-bold">Sale Fee</th>
                <th className="px-5 py-3 text-right font-bold">Paid</th>
                <th className="px-5 py-3 text-right font-bold">Profit</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-5 py-3 text-muted-foreground">{e.date}</td>
                  <td className="px-5 py-3 font-bold">{e.service}</td>
                  <td className="px-5 py-3 text-muted-foreground">{e.platform}</td>
                  <td className="px-5 py-3 text-right">{currency(e.earned)}</td>
                  <td className="px-5 py-3 text-right text-negative">{currency(e.feeAmt)}</td>
                  <td className="px-5 py-3 text-right text-muted-foreground">{currency(e.paid)}</td>
                  <td
                    className={`px-5 py-3 text-right font-bold ${
                      e.profit >= 0 ? "text-primary" : "text-negative"
                    }`}
                  >
                    {currency(e.profit)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => remove(e.id)}
                      disabled={busy === e.id}
                      className="p-1.5 text-muted-foreground transition-colors hover:text-negative disabled:opacity-50"
                      aria-label={`Delete ${e.service} entry`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
