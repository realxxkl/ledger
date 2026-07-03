"use client"

import { useMemo, useState } from "react"
import {
  Bar,
  CartesianGrid,
  Cell,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { Entry } from "@/lib/types"
import { currency, toMonthly } from "@/lib/types"

type Metric = "earned" | "profit" | "fees"

const METRICS: { id: Metric; label: string }[] = [
  { id: "earned", label: "Earned" },
  { id: "profit", label: "Profit" },
  { id: "fees", label: "Fees" },
]

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="border-2 border-primary bg-card px-3 py-2 text-xs">
      <p className="mb-1 font-bold uppercase tracking-wider text-foreground">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="flex items-center justify-between gap-4 text-muted-foreground">
          <span className="uppercase tracking-wider">{p.name}</span>
          <span className="font-bold text-foreground">{currency(p.value)}</span>
        </p>
      ))}
      <p className="mt-1.5 border-t border-border pt-1.5 text-[10px] uppercase tracking-wider text-primary">
        Click to view sales
      </p>
    </div>
  )
}

export function MonthlyChart({
  entries,
  onSelectMonth,
}: {
  entries: Entry[]
  onSelectMonth?: (month: string) => void
}) {
  const [metric, setMetric] = useState<Metric>("profit")
  const monthly = useMemo(() => toMonthly(entries), [entries])

  const handleBarClick = (payload: any) => {
    const month = payload?.month ?? payload?.payload?.month
    if (month && onSelectMonth) onSelectMonth(month)
  }

  return (
    <div className="border-2 border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-black uppercase tracking-tight">Profit Chart</h2>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Click a bar to jump to that month&apos;s sales
          </p>
        </div>
        <div className="flex gap-0 border-2 border-border">
          {METRICS.map((m) => (
            <button
              key={m.id}
              onClick={() => setMetric(m.id)}
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                metric === m.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {monthly.length === 0 ? (
        <p className="py-16 text-center text-sm uppercase tracking-wider text-muted-foreground">
          No data in this range yet. Add sales to see monthly trends.
        </p>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={monthly} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={56}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickFormatter={(v) => `$${v}`}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
              <Bar
                dataKey={metric}
                name={metric}
                fill="var(--primary)"
                maxBarSize={48}
                onClick={handleBarClick}
                className="cursor-pointer"
              >
                {monthly.map((m) => (
                  <Cell key={m.month} className="cursor-pointer" />
                ))}
              </Bar>
              <Line
                type="monotone"
                dataKey="profit"
                name="profit trend"
                stroke="var(--foreground)"
                strokeWidth={2}
                dot={{ r: 3, fill: "var(--foreground)" }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
