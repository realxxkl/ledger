import { NextResponse } from "next/server"
import { getLedger } from "@/lib/ledger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const data = await getLedger()
    return NextResponse.json(data)
  } catch (err) {
    console.error("[v0] GET /api/ledger failed:", err)
    return NextResponse.json({ error: "Failed to load ledger" }, { status: 500 })
  }
}
