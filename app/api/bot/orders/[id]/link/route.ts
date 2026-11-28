import { type NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { entries } from "@/lib/db/schema"
import { ensureBotSchema } from "@/lib/db/ensure-bot-schema"
import { requireBotAuth } from "@/lib/bot-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = requireBotAuth(request)
  if (authError) return authError

  try {
    await ensureBotSchema()
    const { id: rawId } = await params
    const orderId = Number(rawId)
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return NextResponse.json({ error: "Invalid order ID" }, { status: 400 })
    }

    const rows = await db
      .select({ id: entries.id, gameLoginLink: entries.gameLoginLink })
      .from(entries)
      .where(eq(entries.id, orderId))
      .limit(1)

    if (!rows[0]) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 })
    }

    return NextResponse.json({
      game_login_link: rows[0].gameLoginLink ?? null,
    })
  } catch (err) {
    console.error("[Bot] GET /api/bot/orders/[id]/link failed:", err)
    return NextResponse.json({ error: "Failed to fetch game login link" }, { status: 500 })
  }
}
