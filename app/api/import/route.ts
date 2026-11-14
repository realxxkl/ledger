import { NextResponse, type NextRequest } from "next/server"
import { db } from "@/lib/db"
import { entries, withdrawals, feeConfig, presets } from "@/lib/db/schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const s = (v: unknown) => String(Number(v) || 0)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function POST(req: NextRequest) {
  try {
    const parsed: unknown = await req.json()
    if (!isRecord(parsed)) {
      return NextResponse.json({ error: "Invalid backup file" }, { status: 400 })
    }
    const importedEntries = parsed.entries
    const importedWithdrawals = parsed.withdrawals
    const importedFeeConfig = parsed.feeConfig
    const importedPresets = parsed.servicePresets
    if (
      !Array.isArray(importedEntries) ||
      !importedEntries.every(isRecord) ||
      !Array.isArray(importedWithdrawals) ||
      !importedWithdrawals.every(isRecord) ||
      !isRecord(importedFeeConfig) ||
      !Object.values(importedFeeConfig).every(isRecord) ||
      (importedPresets !== undefined &&
        (!Array.isArray(importedPresets) ||
          !importedPresets.every((preset) => typeof preset === "string" || isRecord(preset))))
    ) {
      return NextResponse.json({ error: "Invalid backup file" }, { status: 400 })
    }
    const feeConfigData = importedFeeConfig as Record<string, Record<string, unknown>>
    const servicePresets = (importedPresets ?? []) as Array<string | Record<string, unknown>>

    await db.transaction(async (tx) => {
      // Wipe everything first
      await tx.delete(entries)
      await tx.delete(withdrawals)
      await tx.delete(feeConfig)
      await tx.delete(presets)

      if (importedEntries.length) {
        await tx.insert(entries).values(
          importedEntries.map((e) => ({
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

      if (importedWithdrawals.length) {
        await tx.insert(withdrawals).values(
          importedWithdrawals.map((w) => ({
            platform: String(w.platform ?? ""),
            date: String(w.date ?? ""),
            amount: s(w.amount),
            fee: s(w.fee),
          })),
        )
      }

      const feeRows = Object.entries(feeConfigData).map(
        ([key, cfg]) => ({
          key: key.toLowerCase(),
          name: String(cfg?.name ?? key),
          percent: s(cfg?.percent),
          flat: s(cfg?.flat),
        }),
      )
      if (feeRows.length) await tx.insert(feeConfig).values(feeRows)

      const presetRows = servicePresets.map((p) =>
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
