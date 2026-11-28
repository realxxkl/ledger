import { type NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { botSettings } from "@/lib/db/schema"
import { ensureBotSchema } from "@/lib/db/ensure-bot-schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function formatQueueState(row: typeof botSettings.$inferSelect | undefined) {
  return {
    locked: Boolean(row?.botQueueLocked),
    reason: row?.botLockReason ?? null,
    errorImageUrl: row?.botLockErrorImageUrl ?? null,
    orderId: row?.botLockOrderId != null ? String(row.botLockOrderId) : null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    await ensureBotSchema()
    const rows = await db
      .select()
      .from(botSettings)
      .where(eq(botSettings.id, 1))
      .limit(1)

    return NextResponse.json(formatQueueState(rows[0]))
  } catch (err) {
    console.error("[Bot] GET /api/bot-queue failed:", err)
    return NextResponse.json({ error: "Failed to load bot queue state" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 })
    }

    if (!body || typeof body !== "object" || typeof body.locked !== "boolean") {
      return NextResponse.json({ error: "locked boolean is required" }, { status: 400 })
    }

    await ensureBotSchema()

    const updatedRows = body.locked
      ? await db
          .update(botSettings)
          .set({
            botQueueLocked: true,
            botLockReason:
              typeof body.reason === "string" && body.reason.trim()
                ? body.reason.trim()
                : "Manually locked from dashboard",
            updatedAt: new Date(),
          })
          .where(eq(botSettings.id, 1))
          .returning()
      : await db
          .update(botSettings)
          .set({
            botQueueLocked: false,
            botLockReason: null,
            botLockErrorImageUrl: null,
            botLockOrderId: null,
            updatedAt: new Date(),
          })
          .where(eq(botSettings.id, 1))
          .returning()

    return NextResponse.json(formatQueueState(updatedRows[0]))
  } catch (err) {
    console.error("[Bot] PATCH /api/bot-queue failed:", err)
    return NextResponse.json({ error: "Failed to update bot queue state" }, { status: 500 })
  }
}
