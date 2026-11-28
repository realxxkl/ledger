import { type NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { entries } from "@/lib/db/schema"
import { ensureBotSchema } from "@/lib/db/ensure-bot-schema"
import { requireBotAuth } from "@/lib/bot-auth"
import {
  decodeBase64Image,
  readUploadedImage,
  saveBotMedia,
  type SupportedImageMimeType,
} from "@/lib/bot-media"
import { fulfillOrderOnPlayerok } from "@/lib/playerok-fulfillment"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FILE_FIELD_NAMES = ["proof", "file", "screenshot", "image", "proof_image"]
const BASE64_FIELD_NAMES = [
  "screenshot_base64",
  "proof_base64",
  "image_base64",
  "proof_image",
  "screenshot",
  "image",
]

function parseFinalVbucksBalance(raw: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (!trimmed) return { ok: true, value: null }
    if (!/^\d+$/.test(trimmed)) {
      return { ok: false, error: "final_vbucks_balance must be a non-negative integer" }
    }
    const parsed = Number(trimmed)
    return Number.isSafeInteger(parsed) && parsed >= 0
      ? { ok: true, value: parsed }
      : { ok: false, error: "final_vbucks_balance must be a non-negative integer" }
  }
  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) && raw >= 0
      ? { ok: true, value: raw }
      : { ok: false, error: "final_vbucks_balance must be a non-negative integer" }
  }
  return { ok: false, error: "final_vbucks_balance must be a non-negative integer" }
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

    const existingRows = await db
      .select({
        id: entries.id,
        orderAmount: entries.orderAmount,
        orderCost: entries.orderCost,
        orderFee: entries.orderFee,
      })
      .from(entries)
      .where(eq(entries.id, orderId))
      .limit(1)

    const existing = existingRows[0]
    if (!existing) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 })
    }

    let decodedImage: { buffer: Buffer; mimeType: SupportedImageMimeType } | null = null
    let rawBalance: unknown = undefined
    const contentType = request.headers.get("content-type") ?? ""

    if (contentType.toLowerCase().includes("multipart/form-data")) {
      let form: FormData
      try {
        form = await request.formData()
      } catch {
        return NextResponse.json({ error: "Invalid multipart form-data payload" }, { status: 400 })
      }

      rawBalance = form.get("final_vbucks_balance")

      let uploadedBlob: Blob | null = null
      for (const fieldName of FILE_FIELD_NAMES) {
        const candidate = form.get(fieldName)
        if (candidate instanceof Blob) {
          uploadedBlob = candidate
          break
        }
      }
      if (!uploadedBlob) {
        for (const [, value] of form.entries()) {
          if (value instanceof Blob) {
            uploadedBlob = value
            break
          }
        }
      }

      try {
        if (uploadedBlob) {
          decodedImage = await readUploadedImage(uploadedBlob)
        } else {
          for (const fieldName of BASE64_FIELD_NAMES) {
            const candidate = form.get(fieldName)
            if (typeof candidate === "string" && candidate.trim()) {
              decodedImage = decodeBase64Image(candidate)
              break
            }
          }
        }
      } catch (imgErr) {
        return NextResponse.json(
          { error: imgErr instanceof Error ? imgErr.message : "Invalid proof screenshot" },
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

      rawBalance = body.final_vbucks_balance
      let rawBase64: unknown = undefined
      for (const fieldName of BASE64_FIELD_NAMES) {
        if (body[fieldName] !== undefined && body[fieldName] !== null) {
          rawBase64 = body[fieldName]
          break
        }
      }

      if (typeof rawBase64 === "string" && rawBase64.trim()) {
        try {
          decodedImage = decodeBase64Image(rawBase64)
        } catch (imgErr) {
          return NextResponse.json(
            { error: imgErr instanceof Error ? imgErr.message : "Invalid proof screenshot" },
            { status: 400 },
          )
        }
      } else if (rawBase64 !== undefined) {
        return NextResponse.json({ error: "Proof screenshot must be a valid base64 image string" }, { status: 400 })
      }
    }

    if (!decodedImage) {
      return NextResponse.json({ error: "Proof screenshot is required" }, { status: 400 })
    }

    const balanceResult = parseFinalVbucksBalance(rawBalance)
    if (!balanceResult.ok) {
      return NextResponse.json({ error: balanceResult.error }, { status: 400 })
    }

    const saved = await saveBotMedia({
      orderId,
      kind: "proof",
      buffer: decodedImage.buffer,
      mimeType: decodedImage.mimeType,
    })

    const orderAmount = Number(existing.orderAmount ?? 0)
    const orderCost = Number(existing.orderCost ?? 0)
    const orderFee = Number(existing.orderFee ?? 0)
    const hasFinancials = orderAmount > 0 || orderCost > 0 || orderFee > 0

    await db
      .update(entries)
      .set({
        orderStatus: "FULFILLED",
        proofImageUrl: saved.url,
        errorReason: null,
        ...(balanceResult.value !== null ? { vbucksAfter: balanceResult.value } : {}),
        ...(hasFinancials
          ? {
              earned: String(orderAmount),
              paid: String(orderCost),
              feeAmt: String(orderFee),
              profit: String(orderAmount - orderCost - orderFee),
            }
          : {}),
      })
      .where(eq(entries.id, orderId))

    const playerok = await fulfillOrderOnPlayerok({
      orderId,
      imageBuffer: decodedImage.buffer,
      mimeType: decodedImage.mimeType,
    })

    return NextResponse.json({
      ok: true,
      order_id: String(orderId),
      status: "FULFILLED",
      proof_image_url: saved.url,
      final_vbucks_balance: balanceResult.value,
      playerok,
    })
  } catch (err) {
    console.error("[Bot] POST /api/bot/orders/[id]/complete failed:", err)
    return NextResponse.json({ error: "Failed to complete order" }, { status: 500 })
  }
}
