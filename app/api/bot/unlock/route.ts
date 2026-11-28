import { type NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { botSettings } from "@/lib/db/schema"
import { ensureBotSchema } from "@/lib/db/ensure-bot-schema"
import { requireBotAuth } from "@/lib/bot-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const authError = requireBotAuth(request)
  if (authError) return authError

  try {
    await ensureBotSchema()
    await db
      .update(botSettings)
      .set({
        botQueueLocked: false,
        botLockReason: null,
        botLockErrorImageUrl: null,
        botLockOrderId: null,
        updatedAt: new Date(),
      })
      .where(eq(botSettings.id, 1))

    return NextResponse.json({
      ok: true,
      locked: false,
      reason: null,
    })
  } catch (err) {
    console.error("[Bot] POST /api/bot/unlock failed:", err)
    return NextResponse.json({ error: "Failed to unlock bot queue" }, { status: 500 })
  }
}
