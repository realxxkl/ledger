import { NextRequest, NextResponse } from "next/server"
import { eq, or, sql } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { ensureOrderTrackingSchema } from "@/lib/db/ensure-order-tracking-schema"
import { entries } from "@/lib/db/schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ChatMapping = {
  buyerUsername?: string
  chatId: string
  dealId?: string
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    const webhookSecret = request.headers.get("x-webhook-secret")
    const isWebhookAuthorized = Boolean(
      webhookSecret &&
      process.env.WEBHOOK_SECRET &&
      webhookSecret === process.env.WEBHOOK_SECRET
    )

    if (!session?.user && !isWebhookAuthorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const mappings = body?.mappings as ChatMapping[]
    if (!Array.isArray(mappings) || mappings.length === 0) {
      return NextResponse.json({ error: "Mappings array is required" }, { status: 400 })
    }

    await ensureOrderTrackingSchema()

    let updatedCount = 0
    for (const m of mappings) {
      const chatId = typeof m.chatId === "string" ? m.chatId.trim() : ""
      if (!chatId) continue

      const buyerUsername = typeof m.buyerUsername === "string" ? m.buyerUsername.trim() : ""
      const dealId = typeof m.dealId === "string" ? m.dealId.trim() : ""

      if (dealId) {
        const res = await db.update(entries)
          .set({ chatId })
          .where(
            or(
              eq(entries.externalOrderId, dealId),
              eq(entries.externalOrderId, dealId.toLowerCase())
            )
          )
        updatedCount += 1
      } else if (buyerUsername) {
        const res = await db.update(entries)
          .set({ chatId })
          .where(
            sql`LOWER(${entries.buyerUsername}) = LOWER(${buyerUsername})`
          )
        updatedCount += 1
      }
    }

    return NextResponse.json({
      success: true,
      processed: mappings.length,
      updated: updatedCount,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync chat mappings" },
      { status: 500 }
    )
  }
}
