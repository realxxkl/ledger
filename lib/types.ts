export type Entry = {
  id: string
  service: string
  platform: string
  date: string
  earned: number
  feePercent: number
  feeAmt: number
  paid: number
  profit: number
}

export type Withdrawal = {
  id: string
  platform: string
  date: string
  amount: number
  fee: number
}

export type FeeConfigEntry = {
  name: string
  percent: number
  flat: number
}

export type ServicePreset = {
  id: string
  name: string
  cost: number
}

export type LedgerData = {
  entries: Entry[]
  withdrawals: Withdrawal[]
  feeConfig: Record<string, FeeConfigEntry>
  servicePresets: ServicePreset[]
}

export const currency = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" })

export type DateRange = { from: string; to: string }

// Filter a list of items with a `date` (YYYY-MM-DD) field by an inclusive range.
export function filterByRange<T extends { date: string }>(items: T[], range: DateRange): T[] {
  return items.filter((it) => {
    if (range.from && it.date < range.from) return false
    if (range.to && it.date > range.to) return false
    return true
  })
}

export type MonthlyPoint = {
  month: string // YYYY-MM
  label: string // e.g. "Jan 25"
  earned: number
  fees: number
  profit: number
  cost: number
}

// Aggregate entries into per-month buckets, sorted chronologically.
export function toMonthly(entries: Entry[]): MonthlyPoint[] {
  const map = new Map<string, MonthlyPoint>()
  for (const e of entries) {
    const month = (e.date || "").slice(0, 7)
    if (!month) continue
    const existing =
      map.get(month) ??
      {
        month,
        label: monthLabel(month),
        earned: 0,
        fees: 0,
        profit: 0,
        cost: 0,
      }
    existing.earned += e.earned
    existing.fees += e.feeAmt
    existing.profit += e.profit
    existing.cost += e.paid
    map.set(month, existing)
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month))
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number)
  if (!y || !m) return month
  const d = new Date(y, m - 1, 1)
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
}

// Build a CSV string from entries and trigger a client-side download.
export function exportEntriesCsv(entries: Entry[], filename = "earnings.csv"): void {
  const headers = ["Date", "Service", "Platform", "Earned", "Fee %", "Fee Amount", "Cost", "Profit"]
  const rows = entries.map((e) => [
    e.date,
    e.service,
    e.platform,
    e.earned.toFixed(2),
    e.feePercent.toFixed(2),
    e.feeAmt.toFixed(2),
    e.paid.toFixed(2),
    e.profit.toFixed(2),
  ])
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n")

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
