import { NextResponse, type NextRequest } from "next/server"
import { db } from "@/lib/db"
import { feeConfig } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const s = (v: unknown) => String(Number(v) || 0)

// Upsert a fee config keyed by platform. `key` lets the client rename while editing.
export async function PUT(req: NextRequest) {
  try {
    const b = await req.json()
    const name = String(b?.name || "").trim()
    if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 })
    const key = String(b?.key || name).toLowerCase()

    await db
      .insert(feeConfig)
      .values({ key, name, percent: s(b.percent), flat: s(b.flat) })
      .onConflictDoUpdate({
        target: feeConfig.key,
        set: { name, percent: s(b.percent), flat: s(b.flat) },
      })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[v0] PUT /api/fees failed:", err)
    return NextResponse.json({ error: "Failed to save fee" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const key = req.nextUrl.searchParams.get("key")
    if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 })
    await db.delete(feeConfig).where(eq(feeConfig.key, key))
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[v0] DELETE /api/fees failed:", err)
    return NextResponse.json({ error: "Failed to delete fee" }, { status: 500 })
  }
}
