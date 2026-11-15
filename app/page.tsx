"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Activity, LayoutDashboard, Package, Plus, Settings, Wallet } from "lucide-react"
import { useLedger } from "@/lib/use-ledger"
import type { DateRange } from "@/lib/types"
import { filterByRange } from "@/lib/types"
import { SummaryCards } from "@/components/summary-cards"
import { OrderSphere } from "@/components/order-sphere"
import { CompletedOrdersList } from "@/components/completed-orders-list"
import { EntryForm } from "@/components/entry-form"
import { EntriesTable } from "@/components/entries-table"
import { WithdrawalsPanel } from "@/components/withdrawals-panel"
import { SettingsPanel } from "@/components/settings-panel"
import { FilterBar } from "@/components/filter-bar"
import { MonthlyChart } from "@/components/monthly-chart"
import { SignOutButton } from "@/components/sign-out-button"
import { PendingOrders } from "@/components/pending-orders"
import { LoadingScreen } from "@/components/loading-screen"

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "pending-orders", label: "Orders", icon: Package },
  { id: "withdrawals", label: "Withdrawals", icon: Wallet },
  { id: "settings", label: "Settings", icon: Settings },
] as const

type Tab = (typeof TABS)[number]["id"]

export default function Page() {
  const { data, error, isLoading, mutate } = useLedger()
  const [tab, setTab] = useState<Tab>("dashboard")
  const [range, setRange] = useState<DateRange>({ from: "", to: "" })
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([])
  const [focusMonth, setFocusMonth] = useState<string | null>(null)

  // Default the report timeframe to the current day. Done on the client after
  // mount so the range reflects the user's local date (and avoids an SSR
  // timezone hydration mismatch).
  useEffect(() => {
    const today = new Date().toLocaleDateString("en-CA") // YYYY-MM-DD in local time
    setRange({ from: today, to: today })
    if (new URLSearchParams(window.location.search).get("tab") === "pending-orders") {
      setTab("pending-orders")
    }
  }, [])

  const salesRef = useRef<HTMLDivElement>(null)
  const entryFormRef = useRef<HTMLDivElement>(null)
  const refresh = () => mutate()

  const platforms = useMemo(() => {
    if (!data) return []
    return [...new Set([...data.entries, ...data.withdrawals].map((item) => item.platform))].sort((a, b) =>
      a.localeCompare(b),
    )
  }, [data])

  const salesData = useMemo(() => {
    if (!data) return null
    return {
      ...data,
      entries: data.entries.filter((entry) => {
        if (entry.source !== "playerok") return true
        const status = (entry.orderStatus ?? "").trim().toLowerCase()
        return status === "completed" || status === "delivered"
      }),
    }
  }, [data])

  // Apply the date range and platform together so every dashboard statistic,
  // chart, table row, withdrawal fee, and CSV export reflects one selection.
  const filtered = useMemo(() => {
    if (!data || !salesData) return null
    const entries = filterByRange(salesData.entries, range)
    const withdrawals = filterByRange(data.withdrawals, range)
    return {
      ...data,
      entries:
        selectedPlatforms.length > 0
          ? entries.filter((entry) => selectedPlatforms.includes(entry.platform))
          : entries,
      withdrawals:
        selectedPlatforms.length > 0
          ? withdrawals.filter((withdrawal) => selectedPlatforms.includes(withdrawal.platform))
          : withdrawals,
    }
  }, [data, salesData, range, selectedPlatforms])

  // Clicking a chart bar jumps to that month's sales in the table below.
  const handleMonthSelect = (month: string) => {
    setFocusMonth(month)
    requestAnimationFrame(() => {
      salesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  }

  const handleNewEntry = () => {
    setTab("dashboard")
    requestAnimationFrame(() => {
      entryFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
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

  if (isLoading && !data) {
    return <LoadingScreen message="Connecting to your ledger records" />
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="hidden w-[76px] shrink-0 border-r border-border/70 bg-card/30 md:flex md:flex-col" aria-label="Dashboard sidebar">
          <div className="grid h-[76px] place-items-center border-b border-border/70">
            <div className="grid size-10 place-items-center border border-primary/50 bg-primary/10 text-primary" aria-hidden="true">
              <Activity className="size-5" />
            </div>
          </div>
          <nav className="flex flex-1 flex-col items-center gap-3 px-3 py-5" aria-label="Primary navigation">
            {TABS.map((t) => {
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  type="button"
                  title={t.label}
                  aria-label={t.label}
                  aria-current={tab === t.id ? "page" : undefined}
                  onClick={() => setTab(t.id)}
                  className={`grid size-10 place-items-center border transition-colors ${
                    tab === t.id
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                  }`}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </button>
              )
            })}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
          <header className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-xl">
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-primary">
                Multi-platform sales ledger
              </p>
              <h1 className="mt-1 font-display text-3xl font-black uppercase tracking-tight text-foreground sm:text-4xl">
                The Ledger
              </h1>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                One clear view of orders, earnings, fees, and withdrawals across every platform.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <p className="mr-1 text-[10px] uppercase tracking-wider text-muted-foreground" suppressHydrationWarning>
                {stamp ? `${stamp.date} — ${stamp.time}` : "\u00A0"}
              </p>
              <button
                type="button"
                onClick={handleNewEntry}
                className="inline-flex items-center gap-2 border border-primary bg-primary px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                New entry
              </button>
              <SignOutButton />
            </div>
          </header>

          <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 md:hidden" aria-label="Primary navigation">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-current={tab === t.id ? "page" : undefined}
                onClick={() => setTab(t.id)}
                className={`shrink-0 border px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  tab === t.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="mt-6">
            {error && (
              <p className="py-20 text-center text-sm uppercase tracking-wider text-negative">
                Failed to load data. Check that the database is connected.
              </p>
            )}

            {data && filtered && (
              <div className="flex flex-col gap-6">
                {tab === "dashboard" && (
                  <>
                    <FilterBar
                      range={range}
                      onChange={setRange}
                      entries={filtered.entries}
                      selectedPlatforms={selectedPlatforms}
                      platforms={platforms}
                      onPlatformsChange={setSelectedPlatforms}
                    />
                    <SummaryCards data={filtered} />
                    <div className="grid gap-5 md:grid-cols-[1.1fr_0.9fr]">
                      <OrderSphere entries={data.entries} />
                      <CompletedOrdersList entries={data.entries} onViewAll={() => setTab("pending-orders")} />
                    </div>
                    <MonthlyChart entries={filtered.entries} dateRange={range} onSelectMonth={handleMonthSelect} />
                    <div ref={entryFormRef}>
                      <EntryForm data={data} onDone={refresh} />
                    </div>
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
                    <SummaryCards data={salesData ?? data} />
                    <WithdrawalsPanel data={data} onChange={refresh} />
                  </>
                )}
                {tab === "settings" && <SettingsPanel data={data} onChange={refresh} />}
                {tab === "pending-orders" && (
                  <PendingOrders
                    entries={data.entries}
                    presets={data.servicePresets}
                    feeConfig={data.feeConfig}
                    epicSessions={data.epicSessions}
                    onChange={refresh}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
