import { type NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { entries } from "@/lib/db/schema"
import { ensureOrderTrackingSchema } from "@/lib/db/ensure-order-tracking-schema"
import { requireBotAuth } from "@/lib/bot-auth"
import { getEpicSession, hasUsableEpicSession } from "@/lib/epic-sessions"
import { EpicExchangeError, generateFreshFortniteLoginLink } from "@/lib/epic-exchange"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = requireBotAuth(request)
  if (authError) return authError

  try {
    await ensureOrderTrackingSchema()
    const { id: rawId } = await params
    const orderId = Number(rawId)
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return NextResponse.json({ error: "Invalid order ID" }, { status: 400 })
    }

    const rows = await db
      .select({
        id: entries.id,
        orderStatus: entries.orderStatus,
        gameLoginLink: entries.gameLoginLink,
      })
      .from(entries)
      .where(eq(entries.id, orderId))
      .limit(1)

    const row = rows[0]
    if (!row) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 })
    }

    const forceRefresh =
      request.nextUrl.searchParams.get("refresh") === "1" ||
      request.nextUrl.searchParams.get("fresh") === "true"

    if (row.orderStatus === "BOT_PROCESSING" || forceRefresh) {
      const epicSession = await getEpicSession(orderId)
      if (hasUsableEpicSession(epicSession)) {
        try {
          const generated = await generateFreshFortniteLoginLink(orderId)
          return NextResponse.json({
            game_login_link: generated.link,
            fresh: true,
          })
        } catch (err) {
          if (err instanceof EpicExchangeError) {
            return NextResponse.json(
              {
                error: err.message,
                ...(err.options.requiresReauthentication ? { requires_reauthentication: true } : {}),
              },
              { status: err.status },
            )
          }
          throw err
        }
      }
    }

    return NextResponse.json({
      game_login_link: row.gameLoginLink ?? null,
      fresh: false,
    })
  } catch (err) {
    console.error("[Bot] GET /api/bot/orders/[id]/link failed:", err)
    return NextResponse.json({ error: "Failed to fetch game login link" }, { status: 500 })
  }
}
