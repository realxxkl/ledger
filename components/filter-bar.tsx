"use client"

import { Download, X } from "lucide-react"
import type { DateRange, Entry } from "@/lib/types"
import { exportEntriesCsv } from "@/lib/types"

type Preset = { label: string; months: number }

const PRESETS: Preset[] = [
  { label: "3M", months: 3 },
  { label: "6M", months: 6 },
  { label: "1Y", months: 12 },
]

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

const inputCls =
  "border-2 border-input bg-background px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-primary"
const btnCls =
  "border-2 border-border px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary hover:text-foreground"

export function FilterBar({
  range,
  onChange,
  entries,
}: {
  range: DateRange
  onChange: (r: DateRange) => void
  entries: Entry[]
}) {
  const applyPreset = (months: number) => {
    const to = new Date()
    const from = new Date()
    from.setMonth(from.getMonth() - months)
    onChange({ from: isoDate(from), to: isoDate(to) })
  }

  const clear = () => onChange({ from: "", to: "" })
  const hasFilter = Boolean(range.from || range.to)

  return (
    <div className="border-2 border-border bg-card p-4">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        Report Timeframe
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="from" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            From
          </label>
          <input
            id="from"
            type="date"
            value={range.from}
            onChange={(e) => onChange({ ...range, from: e.target.value })}
            className={inputCls}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="to" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            To
          </label>
          <input
            id="to"
            type="date"
            value={range.to}
            onChange={(e) => onChange({ ...range, to: e.target.value })}
            className={inputCls}
          />
        </div>

        <div className="flex gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.label} onClick={() => applyPreset(p.months)} className={btnCls}>
              {p.label}
            </button>
          ))}
          {hasFilter && (
            <button onClick={clear} className={`${btnCls} flex items-center gap-1`}>
              <X className="size-3.5" aria-hidden="true" />
              Clear
            </button>
          )}
        </div>

        <button
          onClick={() => exportEntriesCsv(entries)}
          disabled={entries.length === 0}
          className="ml-auto flex items-center gap-2 border-2 border-primary bg-primary px-3 py-2 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Download className="size-4" aria-hidden="true" />
          Export to Sheets (.CSV)
        </button>
      </div>
    </div>
  )
}
