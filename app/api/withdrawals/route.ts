import { NextResponse, type NextRequest } from "next/server"
import { db } from "@/lib/db"
import { withdrawals } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const s = (v: unknown) => String(Number(v) || 0)

export async function POST(req: NextRequest) {
  try {
    const b = await req.json()
    if (!b?.platform || !b?.date) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }
    await db.insert(withdrawals).values({
      platform: String(b.platform),
      date: String(b.date),
      amount: s(b.amount),
      fee: s(b.fee),
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[v0] POST /api/withdrawals failed:", err)
    return NextResponse.json({ error: "Failed to add withdrawal" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    await db.delete(withdrawals).where(eq(withdrawals.id, Number(id)))
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[v0] DELETE /api/withdrawals failed:", err)
    return NextResponse.json({ error: "Failed to delete withdrawal" }, { status: 500 })
  }
}
