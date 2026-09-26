import { db } from "@/lib/db"
import { entries, withdrawals, feeConfig, presets, epicOrderSessions } from "@/lib/db/schema"
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

  const [entryRows, withdrawalRows, feeRows, finalPresets, epicSessionRows] = await Promise.all([
    db.select().from(entries).orderBy(desc(entries.createdAt)),
    db.select().from(withdrawals).orderBy(desc(withdrawals.createdAt)),
    db.select().from(feeConfig),
    presetRows.length === 0 ? db.select().from(presets) : Promise.resolve(presetRows),
    db.select({ orderId: epicOrderSessions.orderId, displayName: epicOrderSessions.displayName, accountId: epicOrderSessions.accountId }).from(epicOrderSessions),
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
      exchangeRate: e.exchangeRate ? num(e.exchangeRate) : undefined,
      originalCurrency: e.originalCurrency || undefined,
      orderStatus: e.orderStatus || undefined,
      u7buyOrderId: e.u7buyOrderId || undefined,
      orderAmount: num(e.orderAmount),
      orderCost: num(e.orderCost),
      orderFee: num(e.orderFee),
    })),
    withdrawals: withdrawalRows.map((w) => ({
      id: String(w.id),
      platform: w.platform,
      date: w.date,
      amount: num(w.amount),
      fee: num(w.fee),
    })),
    feeConfig: feeConfigObj,
    epicSessions: epicSessionRows.map((session) => ({
      orderId: String(session.orderId),
      displayName: session.displayName || "Epic account",
      accountId: session.accountId || undefined,
      refreshTokenStored: Boolean(session.refreshToken),
      accessTokenStored: Boolean(session.accessToken),
      tokenUpdatedAt: session.updatedAt?.toISOString(),
      tokenExpiresAt: session.expiresAt?.toISOString(),
    })),
    servicePresets: finalPresets.map((p) => ({
      id: String(p.id),
      name: p.name,
      cost: num(p.cost),
      currency: (p.currency as 'usd' | 'egp') || 'usd',
    })),
  }
}
