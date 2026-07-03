"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useLedger } from "@/lib/use-ledger"
import type { DateRange } from "@/lib/types"
import { filterByRange } from "@/lib/types"
import { SummaryCards } from "@/components/summary-cards"
import { EntryForm } from "@/components/entry-form"
import { EntriesTable } from "@/components/entries-table"
import { WithdrawalsPanel } from "@/components/withdrawals-panel"
import { SettingsPanel } from "@/components/settings-panel"
import { FilterBar } from "@/components/filter-bar"
import { MonthlyChart } from "@/components/monthly-chart"

type Tab = "dashboard" | "withdrawals" | "settings"

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "withdrawals", label: "Withdrawals" },
  { id: "settings", label: "Settings" },
]

export default function Page() {
  const { data, error, isLoading, mutate } = useLedger()
  const [tab, setTab] = useState<Tab>("dashboard")
  const [range, setRange] = useState<DateRange>({ from: "", to: "" })
  const [focusMonth, setFocusMonth] = useState<string | null>(null)
  const salesRef = useRef<HTMLDivElement>(null)
  const refresh = () => mutate()

  // Apply the date range to entries/withdrawals so cards, charts, and the
  // table all reflect the same filtered window.
  const filtered = useMemo(() => {
    if (!data) return null
    return {
      ...data,
      entries: filterByRange(data.entries, range),
      withdrawals: filterByRange(data.withdrawals, range),
    }
  }, [data, range])

  // Clicking a chart bar jumps to that month's sales in the table below.
  const handleMonthSelect = (month: string) => {
    setFocusMonth(month)
    requestAnimationFrame(() => {
      salesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  }

  // Compute the clock only on the client after mount to avoid an SSR/client
  // timezone hydration mismatch.
  const [stamp, setStamp] = useState<{ date: string; time: string } | null>(null)
  useEffect(() => {
    const update = () => {
      const now = new Date()
      setStamp({
        date: now.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        time: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      })
    }
    update()
    const id = setInterval(update, 60_000)
    return () => clearInterval(id)
  }, [])

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Masthead */}
        <header className="border-b-2 border-border pb-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-xl">
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-primary">
                Multi-platform sales ledger
              </p>
              <h1 className="mt-2 font-display text-5xl font-black uppercase tracking-tight text-foreground sm:text-6xl">
                The Ledger
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Log what came in, what went out, per platform. Per-sale fees deduct automatically;
                withdrawal fees are logged once, when you actually cash out.
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 sm:items-end">
              <button
                onClick={() => setTab("settings")}
                className="border-2 border-border px-4 py-2 text-xs font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary"
              >
                Fee settings &amp; backups
              </button>
              <p className="text-xs uppercase tracking-wider text-muted-foreground" suppressHydrationWarning>
                {stamp ? `${stamp.date} — ${stamp.time}` : "\u00A0"}
              </p>
            </div>
          </div>

          <nav className="mt-6 flex gap-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`border-2 px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                  tab === t.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </header>

        <div className="mt-8">
          {isLoading && (
            <p className="py-20 text-center text-sm uppercase tracking-wider text-muted-foreground">
              Loading ledger…
            </p>
          )}

          {error && (
            <p className="py-20 text-center text-sm uppercase tracking-wider text-negative">
              Failed to load data. Check that the database is connected.
            </p>
          )}

          {data && filtered && (
            <div className="flex flex-col gap-6">
              {tab === "dashboard" && (
                <>
                  <FilterBar range={range} onChange={setRange} entries={filtered.entries} />
                  <SummaryCards data={filtered} />
                  <MonthlyChart entries={filtered.entries} onSelectMonth={handleMonthSelect} />
                  <EntryForm data={data} onDone={refresh} />
                  <div ref={salesRef}>
                    <EntriesTable
                      data={filtered}
                      onChange={refresh}
                      focusMonth={focusMonth}
                      onClearFocus={() => setFocusMonth(null)}
                    />
                  </div>
                </>
              )}
              {tab === "withdrawals" && (
                <>
                  <SummaryCards data={data} />
                  <WithdrawalsPanel data={data} onChange={refresh} />
                </>
              )}
              {tab === "settings" && <SettingsPanel data={data} onChange={refresh} />}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
