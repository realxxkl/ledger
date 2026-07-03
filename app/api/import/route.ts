import { NextResponse, type NextRequest } from "next/server"
import { db } from "@/lib/db"
import { entries, withdrawals, feeConfig, presets } from "@/lib/db/schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const s = (v: unknown) => String(Number(v) || 0)

export async function POST(req: NextRequest) {
  try {
    const parsed = await req.json()
    if (!parsed?.entries || !parsed?.feeConfig || !parsed?.withdrawals) {
      return NextResponse.json({ error: "Invalid backup file" }, { status: 400 })
    }

    await db.transaction(async (tx) => {
      // Wipe everything first
      await tx.delete(entries)
      await tx.delete(withdrawals)
      await tx.delete(feeConfig)
      await tx.delete(presets)

      if (Array.isArray(parsed.entries) && parsed.entries.length) {
        await tx.insert(entries).values(
          parsed.entries.map((e: any) => ({
            service: String(e.service ?? ""),
            platform: String(e.platform ?? ""),
            date: String(e.date ?? ""),
            earned: s(e.earned),
            feePercent: s(e.feePercent),
            feeAmt: s(e.feeAmt),
            paid: s(e.paid),
            profit: s(e.profit),
          })),
        )
      }

      if (Array.isArray(parsed.withdrawals) && parsed.withdrawals.length) {
        await tx.insert(withdrawals).values(
          parsed.withdrawals.map((w: any) => ({
            platform: String(w.platform ?? ""),
            date: String(w.date ?? ""),
            amount: s(w.amount),
            fee: s(w.fee),
          })),
        )
      }

      const feeRows = Object.entries(parsed.feeConfig as Record<string, any>).map(
        ([key, cfg]) => ({
          key: key.toLowerCase(),
          name: String(cfg?.name ?? key),
          percent: s(cfg?.percent),
          flat: s(cfg?.flat),
        }),
      )
      if (feeRows.length) await tx.insert(feeConfig).values(feeRows)

      const parsedPresets = Array.isArray(parsed.servicePresets) ? parsed.servicePresets : []
      const presetRows = parsedPresets.map((p: any) =>
        typeof p === "string"
          ? { name: p, cost: "0" }
          : { name: String(p?.name ?? ""), cost: s(p?.cost) },
      )
      if (presetRows.length) await tx.insert(presets).values(presetRows)
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[v0] POST /api/import failed:", err)
    return NextResponse.json({ error: "Failed to import backup" }, { status: 500 })
  }
}
