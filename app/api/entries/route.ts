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
    await db.insert(entries).values({
      service: String(b.service),
      platform: String(b.platform),
      date: String(b.date),
      earned: s(b.earned),
      feePercent: s(b.feePercent),
      feeAmt: s(b.feeAmt),
      paid: s(b.paid),
      profit: s(b.profit),
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
