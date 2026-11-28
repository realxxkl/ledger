"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { LoaderCircle, Unlock } from "lucide-react"
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
import { SignOutButton } from "@/components/sign-out-button"
import { PendingOrders } from "@/components/pending-orders"
import { OffersPanel } from "@/components/offers-panel"
import { LoadingScreen } from "@/components/loading-screen"
import { BotQueueBanner } from "@/components/bot-queue-banner"
import { isFulfilledOrCompletedStatus } from "@/lib/bot-status"

type Tab = "dashboard" | "offers" | "withdrawals" | "settings" | "pending-orders"

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "offers", label: "Offers" },
  { id: "withdrawals", label: "Withdrawals" },
  { id: "settings", label: "Settings" },
]

export default function Page() {
  const { data, error, isLoading, mutate } = useLedger()
  const [tab, setTab] = useState<Tab>("pending-orders")
  const [range, setRange] = useState<DateRange>({ from: "", to: "" })
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([])
  const [focusMonth, setFocusMonth] = useState<string | null>(null)
  const [unlockingQueue, setUnlockingQueue] = useState(false)
  const [unlockQueueError, setUnlockQueueError] = useState("")

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
  const refresh = () => mutate()

  async function handleUnlockBotQueue() {
    if (unlockingQueue) return
    setUnlockingQueue(true)
    setUnlockQueueError("")
    try {
      const response = await fetch("/api/bot-queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked: false }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error || "Could not unlock bot queue")
      }
      await refresh()
    } catch (err) {
      setUnlockQueueError(err instanceof Error ? err.message : "Could not unlock bot queue")
    } finally {
      setUnlockingQueue(false)
    }
  }

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
        return isFulfilledOrCompletedStatus(entry.orderStatus)
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
              <div className="flex flex-wrap gap-2">
                {data?.botQueue?.locked && (
                  <button
                    type="button"
                    disabled={unlockingQueue}
                    onClick={handleUnlockBotQueue}
                    className="inline-flex items-center gap-1.5 border-2 border-destructive bg-destructive px-4 py-2 text-xs font-black uppercase tracking-wider text-destructive-foreground transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
                  >
                    {unlockingQueue ? (
                      <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    ) : (
                      <Unlock className="size-3.5" aria-hidden="true" />
                    )}
                    {unlockingQueue ? "Unlocking…" : "Unlock Bot Queue"}
                  </button>
                )}
                <button
                  onClick={() => setTab("settings")}
                  className="border-2 border-border px-4 py-2 text-xs font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  Fee settings &amp; backups
                </button>
                <button
                  onClick={() => setTab("pending-orders")}
                  className={`border-2 px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                    tab === "pending-orders"
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  Orders
                </button>
                <SignOutButton />
              </div>
              {unlockQueueError && (
                <p role="alert" className="text-xs font-bold text-destructive">
                  {unlockQueueError}
                </p>
              )}
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
          {error && (
            <p className="py-20 text-center text-sm uppercase tracking-wider text-negative">
              Failed to load data. Check that the database is connected.
            </p>
          )}

          {data && filtered && (
            <div className="flex flex-col gap-6">
              <BotQueueBanner
                botQueue={data.botQueue}
                entries={data.entries}
                onChange={refresh}
              />
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
                  <MonthlyChart entries={filtered.entries} dateRange={range} onSelectMonth={handleMonthSelect} />
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
                  <SummaryCards data={salesData ?? data} />
                  <WithdrawalsPanel data={data} onChange={refresh} />
                </>
              )}
              {tab === "offers" && <OffersPanel />}
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
    </main>
  )
}
