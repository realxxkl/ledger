import { db } from "@/lib/db"
import { entries, withdrawals, feeConfig, presets } from "@/lib/db/schema"
import { desc } from "drizzle-orm"

const DEFAULT_PRESETS = [
  { name: "800 V-Bucks", cost: "0" },
  { name: "2,400 V-Bucks", cost: "0" },
  { name: "4,500 V-Bucks", cost: "0" },
  { name: "9,000 V-Bucks", cost: "0" },
  { name: "12,500 V-Bucks", cost: "0" },
]

const num = (v: unknown) => Number(v ?? 0)

export async function getLedger() {
  // Seed default presets once if the table is empty
  const presetRows = await db.select().from(presets)
  if (presetRows.length === 0) {
    await db.insert(presets).values(DEFAULT_PRESETS)
  }

  const [entryRows, withdrawalRows, feeRows, finalPresets] = await Promise.all([
    db.select().from(entries).orderBy(desc(entries.createdAt)),
    db.select().from(withdrawals).orderBy(desc(withdrawals.createdAt)),
    db.select().from(feeConfig),
    presetRows.length === 0 ? db.select().from(presets) : Promise.resolve(presetRows),
  ])

  const feeConfigObj: Record<string, { name: string; percent: number; flat: number }> = {}
  for (const f of feeRows) {
    feeConfigObj[f.key] = { name: f.name, percent: num(f.percent), flat: num(f.flat) }
  }

  return {
    entries: entryRows.map((e) => ({
      id: String(e.id),
      service: e.service,
      platform: e.platform,
      date: e.date,
      earned: num(e.earned),
      feePercent: num(e.feePercent),
      feeAmt: num(e.feeAmt),
      paid: num(e.paid),
      profit: num(e.profit),
    })),
    withdrawals: withdrawalRows.map((w) => ({
      id: String(w.id),
      platform: w.platform,
      date: w.date,
      amount: num(w.amount),
      fee: num(w.fee),
    })),
    feeConfig: feeConfigObj,
    servicePresets: finalPresets.map((p) => ({
      id: String(p.id),
      name: p.name,
      cost: num(p.cost),
    })),
  }
}
