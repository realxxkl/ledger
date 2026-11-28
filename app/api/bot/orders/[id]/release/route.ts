import { type NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { entries } from "@/lib/db/schema"
import { ensureBotSchema } from "@/lib/db/ensure-bot-schema"
import { requireBotAuth } from "@/lib/bot-auth"
import { isTerminalOrderStatus } from "@/lib/bot-status"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function resolveReleaseStatus(raw: unknown): "In Progress" | "READY_FOR_TOPUP" | null {
  if (raw === undefined || raw === null) return "In Progress"
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed === "In Progress" || trimmed === "AUTHENTICATED") {
    return "In Progress"
  }
  if (trimmed === "READY_FOR_TOPUP") {
    return "READY_FOR_TOPUP"
  }
  return null
}

export async function POST(
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

    const rawText = await request.text()
    let body: Record<string, unknown> = {}
    if (rawText.trim()) {
      let parsed: unknown
      try {
        parsed = JSON.parse(rawText)
      } catch {
        return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 })
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 })
      }
      body = parsed as Record<string, unknown>
    }

    const targetStatus = resolveReleaseStatus(body.status)
    if (!targetStatus) {
      return NextResponse.json(
        { error: "status must be 'In Progress', 'AUTHENTICATED', or 'READY_FOR_TOPUP'" },
        { status: 400 },
      )
    }

    if (body.reason !== undefined && body.reason !== null && typeof body.reason !== "string") {
      return NextResponse.json({ error: "reason must be a string" }, { status: 400 })
    }
    if (body.clear_error !== undefined && typeof body.clear_error !== "boolean") {
      return NextResponse.json({ error: "clear_error must be a boolean" }, { status: 400 })
    }

    const clearError = body.clear_error === true
    const trimmedReason = typeof body.reason === "string" ? body.reason.trim() : ""
    const nextReason = clearError ? null : trimmedReason || null

    await db.transaction(async (tx) => {
      const existingRows = await tx
        .select({ id: entries.id, orderStatus: entries.orderStatus })
        .from(entries)
        .where(eq(entries.id, orderId))
        .limit(1)

      const existing = existingRows[0]
      if (!existing) {
        throw new HttpError("Order not found", 404)
      }

      if (isTerminalOrderStatus(existing.orderStatus)) {
        throw new HttpError("Cannot release a completed or refunded order", 409)
      }

      if (existing.orderStatus !== "BOT_PROCESSING" && existing.orderStatus !== "READY_FOR_TOPUP") {
        throw new HttpError(
          `Order cannot be released from status '${existing.orderStatus ?? "unknown"}'`,
          409,
        )
      }

      await tx
        .update(entries)
        .set({
          orderStatus: targetStatus,
          errorReason: nextReason,
          ...(clearError || !nextReason ? { errorImageUrl: null } : {}),
        })
        .where(eq(entries.id, orderId))
    })

    return NextResponse.json({
      ok: true,
      order_id: String(orderId),
      status: targetStatus,
      error_reason: nextReason,
    })
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error("[Bot] POST /api/bot/orders/[id]/release failed:", err)
    return NextResponse.json({ error: "Failed to release order" }, { status: 500 })
  }
}
