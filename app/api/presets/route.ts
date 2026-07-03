import { NextResponse, type NextRequest } from "next/server"
import { db } from "@/lib/db"
import { presets } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const s = (v: unknown) => String(Number(v) || 0)

export async function POST(req: NextRequest) {
  try {
    const b = await req.json()
    const name = String(b?.name || "").trim()
    if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 })
    await db.insert(presets).values({ name, cost: s(b.cost) })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[v0] POST /api/presets failed:", err)
    return NextResponse.json({ error: "Failed to add preset" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    await db.delete(presets).where(eq(presets.id, Number(id)))
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[v0] DELETE /api/presets failed:", err)
    return NextResponse.json({ error: "Failed to delete preset" }, { status: 500 })
  }
}
