import { type NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { botSettings, entries } from "@/lib/db/schema"
import { ensureBotSchema } from "@/lib/db/ensure-bot-schema"
import { requireBotAuth } from "@/lib/bot-auth"
import { BOT_ERROR_STATUSES, type BotErrorStatus } from "@/lib/bot-status"
import {
  decodeBase64Image,
  readUploadedImage,
  saveBotMedia,
  type SupportedImageMimeType,
} from "@/lib/bot-media"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isAllowedErrorStatus(value: unknown): value is BotErrorStatus {
  return typeof value === "string" && (BOT_ERROR_STATUSES as readonly string[]).includes(value)
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

    let statusRaw: unknown
    let errorReasonRaw: unknown
    let lockQueueRaw: unknown
    let decodedImage: { buffer: Buffer; mimeType: SupportedImageMimeType } | null = null

    const contentType = request.headers.get("content-type") ?? ""
    if (contentType.toLowerCase().includes("multipart/form-data")) {
      let form: FormData
      try {
        form = await request.formData()
      } catch {
        return NextResponse.json({ error: "Invalid multipart form-data payload" }, { status: 400 })
      }
      statusRaw = form.get("status")
      errorReasonRaw = form.get("error_reason")
      const lockStr = form.get("lock_queue")
      if (lockStr === null || lockStr === "") {
        lockQueueRaw = false
      } else if (lockStr === "true") {
        lockQueueRaw = true
      } else if (lockStr === "false") {
        lockQueueRaw = false
      } else {
        return NextResponse.json({ error: "lock_queue must be true or false" }, { status: 400 })
      }

      const fileCandidate =
        form.get("screenshot") ??
        form.get("file") ??
        form.get("error_image") ??
        form.get("image")
      const base64Candidate = form.get("screenshot_base64")

      try {
        if (fileCandidate instanceof Blob) {
          decodedImage = await readUploadedImage(fileCandidate)
        } else if (typeof base64Candidate === "string" && base64Candidate.trim()) {
          decodedImage = decodeBase64Image(base64Candidate)
        }
      } catch (imgErr) {
        return NextResponse.json(
          { error: imgErr instanceof Error ? imgErr.message : "Invalid error screenshot" },
          { status: 400 },
        )
      }
    } else {
      let body: Record<string, unknown>
      try {
        body = (await request.json()) as Record<string, unknown>
      } catch {
        return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 })
      }

      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 })
      }

      statusRaw = body.status
      errorReasonRaw = body.error_reason
      lockQueueRaw = body.lock_queue === undefined ? false : body.lock_queue
      if (typeof lockQueueRaw !== "boolean") {
        return NextResponse.json({ error: "lock_queue must be a boolean" }, { status: 400 })
      }

      const screenshotBase64 = body.screenshot_base64
      if (screenshotBase64 !== undefined && screenshotBase64 !== null) {
        if (typeof screenshotBase64 !== "string") {
          return NextResponse.json({ error: "screenshot_base64 must be a string" }, { status: 400 })
        }
        if (screenshotBase64.trim()) {
          try {
            decodedImage = decodeBase64Image(screenshotBase64)
          } catch (imgErr) {
            return NextResponse.json(
              { error: imgErr instanceof Error ? imgErr.message : "Invalid error screenshot" },
              { status: 400 },
            )
          }
        }
      }
    }

    if (!isAllowedErrorStatus(statusRaw)) {
      return NextResponse.json(
        { error: "status must be USERNAME_MISMATCH or HOLD_ESCALATION" },
        { status: 400 },
      )
    }

    const errorReason = typeof errorReasonRaw === "string" ? errorReasonRaw.trim() : ""
    if (!errorReason) {
      return NextResponse.json({ error: "error_reason is required" }, { status: 400 })
    }

    const existingRows = await db
      .select({ id: entries.id, errorImageUrl: entries.errorImageUrl })
      .from(entries)
      .where(eq(entries.id, orderId))
      .limit(1)

    const existing = existingRows[0]
    if (!existing) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 })
    }

    const savedMedia = decodedImage
      ? await saveBotMedia({
          orderId,
          kind: "error",
          buffer: decodedImage.buffer,
          mimeType: decodedImage.mimeType,
        })
      : null

    const errorImageUrl = savedMedia?.url ?? null
    const lockQueue = Boolean(lockQueueRaw)

    await db.transaction(async (tx) => {
      await tx
        .update(entries)
        .set({
          orderStatus: statusRaw,
          errorReason,
          ...(errorImageUrl ? { errorImageUrl } : {}),
        })
        .where(eq(entries.id, orderId))

      if (lockQueue) {
        await tx
          .update(botSettings)
          .set({
            botQueueLocked: true,
            botLockReason: errorReason,
            botLockErrorImageUrl: errorImageUrl ?? existing.errorImageUrl ?? null,
            botLockOrderId: orderId,
            updatedAt: new Date(),
          })
          .where(eq(botSettings.id, 1))
      }
    })

    return NextResponse.json({
      ok: true,
      order_id: String(orderId),
      status: statusRaw,
      error_reason: errorReason,
      error_image_url: errorImageUrl ?? existing.errorImageUrl ?? null,
      queue_locked: lockQueue,
    })
  } catch (err) {
    console.error("[Bot] POST /api/bot/orders/[id]/error failed:", err)
    return NextResponse.json({ error: "Failed to record order error" }, { status: 500 })
  }
}
