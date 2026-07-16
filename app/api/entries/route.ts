import { NextResponse, type NextRequest } from "next/server"
import { db } from "@/lib/db"
import { entries } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const s = (v: unknown) => String(Number(v) || 0)

export async function POST(req: NextRequest) {
  try {
    const b = await req.json()
    if (!b?.service || !b?.platform || !b?.date) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    let paidUsd = Number(b.paid) || 0
    let exchangeRate: number | undefined
    let originalCurrency: string | undefined

    // If cost was in EGP, store the exchange rate for audit trail
    // (The form already converted paidUsd client-side, so we don't convert again)
    if (b.costCurrency === 'egp' && b.exchangeRate) {
      exchangeRate = Number(b.exchangeRate)
      originalCurrency = 'egp'
    }

    await db.insert(entries).values({
      service: String(b.service),
      platform: String(b.platform),
      date: String(b.date),
      earned: s(b.earned),
      feePercent: s(b.feePercent),
      feeAmt: s(b.feeAmt),
      paid: s(paidUsd),
      profit: s(b.profit),
      exchangeRate: exchangeRate ? String(exchangeRate) : null,
      originalCurrency: originalCurrency || null,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[v0] POST /api/entries failed:", err)
    return NextResponse.json({ error: "Failed to add entry" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id")
    if (id) {
      await db.delete(entries).where(eq(entries.id, Number(id)))
    } else {
      // No id => clear all entries
      await db.delete(entries)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[v0] DELETE /api/entries failed:", err)
    return NextResponse.json({ error: "Failed to delete entry" }, { status: 500 })
  }
}
