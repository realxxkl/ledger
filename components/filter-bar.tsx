"use client"

import { ChevronDown, Download, X } from "lucide-react"
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
  selectedPlatforms,
  platforms,
  onPlatformsChange,
}: {
  range: DateRange
  onChange: (r: DateRange) => void
  entries: Entry[]
  selectedPlatforms: string[]
  platforms: string[]
  onPlatformsChange: (platforms: string[]) => void
}) {
  const applyPreset = (months: number) => {
    const to = new Date()
    const from = new Date()
    from.setMonth(from.getMonth() - months)
    onChange({ from: isoDate(from), to: isoDate(to) })
  }

  const applyToday = () => {
    const today = new Date().toLocaleDateString("en-CA")
    onChange({ from: today, to: today })
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

        <div className="flex min-w-52 flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Platforms
          </span>
          <details className="group relative">
            <summary className={`${inputCls} flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 font-bold uppercase tracking-wider [&::-webkit-details-marker]:hidden`}>
              <span className="max-w-44 truncate">
                {selectedPlatforms.length === 0
                  ? "All platforms"
                  : selectedPlatforms.length === 1
                    ? selectedPlatforms[0]
                    : `${selectedPlatforms.length} platforms selected`}
              </span>
              <ChevronDown
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="absolute left-0 top-full z-20 mt-1 min-w-full border-2 border-border bg-card p-2 shadow-lg">
              <label className="flex cursor-pointer items-center gap-2 px-2 py-2 text-xs font-bold uppercase tracking-wider hover:bg-muted">
                <input
                  type="checkbox"
                  checked={selectedPlatforms.length === 0}
                  onChange={() => onPlatformsChange([])}
                  className="size-4 accent-primary"
                />
                All platforms
              </label>
              <div className="my-1 border-t border-border" />
              {platforms.map((option) => {
                const selected = selectedPlatforms.includes(option)
                return (
                  <label
                    key={option}
                    className="flex cursor-pointer items-center gap-2 px-2 py-2 text-xs font-bold uppercase tracking-wider hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() =>
                        onPlatformsChange(
                          selected
                            ? selectedPlatforms.filter((platform) => platform !== option)
                            : [...selectedPlatforms, option],
                        )
                      }
                      className="size-4 accent-primary"
                    />
                    {option}
                  </label>
                )
              })}
            </div>
          </details>
        </div>

        <div className="flex gap-1.5">
          <button onClick={applyToday} className={btnCls}>
            Today
          </button>
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
