import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { ensureOrderTrackingSchema } from "@/lib/db/ensure-order-tracking-schema"
import { entries, presets } from "@/lib/db/schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const RUB_PER_USD = 88.5
const PLAYEROK_FEE_PERCENT = 4

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-webhook-secret",
}

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders })
}

function normalizeItemTitle(title: string) {
  const formatted = title.replace(/(\d[\d,]*)\s*[- ]?\s*V[\s-]*Bucks\b/gi, (_match, amount: string) => {
    return `${amount.replace(/,/g, "")} VBucks`
  })
  return formatted.replace(/fortnite\s*crew/i, "Fortnite Crew")
}

function getVbucksAmount(value: string) {
  const match = value.match(/(\d[\d,]*)\s*[- ]?\s*V[\s-]*Bucks\b/i)
  return match ? Number(match[1].replace(/,/g, "")) : null
}

function findMatchingPreset(itemTitle: string, savedPresets: Array<{ name: string; cost: string }>) {
  const isCrew = /fortnite\s*crew/i.test(itemTitle)
  const vbucksAmount = getVbucksAmount(itemTitle)
  const normalizedTitle = itemTitle.toLowerCase().replace(/[^a-z0-9]/g, "")

  return savedPresets.find((preset) => {
    const presetIsCrew = /fortnite\s*crew/i.test(preset.name)
    if (isCrew || presetIsCrew) return isCrew && presetIsCrew

    const presetVbucksAmount = getVbucksAmount(preset.name)
    if (vbucksAmount !== null || presetVbucksAmount !== null) {
      return vbucksAmount !== null && vbucksAmount === presetVbucksAmount
    }

    const normalizedPreset = preset.name.toLowerCase().replace(/[^a-z0-9]/g, "")
    return normalizedPreset.length > 0 && normalizedTitle.includes(normalizedPreset)
  })
}

function getPresetCost(preset: { cost: string } | undefined) {
  if (!preset) return "0"
  const cost = Number(preset.cost)
  if (!Number.isFinite(cost) || cost < 0) throw new Error("Matched Playerok preset has an invalid cost")
  return cost.toFixed(2)
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

export async function POST(request: NextRequest) {
  try {
    if (process.env.WEBHOOK_SECRET && request.headers.get("x-webhook-secret") !== process.env.WEBHOOK_SECRET) {
      return jsonResponse({ error: "Unauthorized" }, 401)
    }

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON payload" }, 400)
    }

    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : ""
    const itemTitle = typeof body.itemTitle === "string" ? body.itemTitle.trim() : ""
    const buyerUsername = typeof body.buyerUsername === "string" ? body.buyerUsername.trim() : ""
    const status = body.status
    const price = Number(body.price)
    const currency = typeof body.currency === "string" ? body.currency.toUpperCase() : "USD"
    const timestampValue = typeof body.timestamp === "string" ? body.timestamp : ""
    const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(timestampValue)
      ? new Date(timestampValue)
      : null
    if (
      !orderId ||
      !itemTitle ||
      !["PAID", "IN_PROGRESS", "PENDING"].includes(String(status)) ||
      !["USD", "RUB"].includes(currency) ||
      !Number.isFinite(price) ||
      price < 0 ||
      !timestamp ||
      Number.isNaN(timestamp.getTime())
    ) {
      return jsonResponse({ error: "Invalid Playerok order payload" }, 400)
    }

    await ensureOrderTrackingSchema()
    const ledgerAmount = currency === "RUB" ? (price / RUB_PER_USD).toFixed(2) : String(price)
    const savedPresets = await db.select({ name: presets.name, cost: presets.cost }).from(presets)
    const matchedPreset = findMatchingPreset(normalizeItemTitle(itemTitle), savedPresets)
    const orderCost = getPresetCost(matchedPreset)
    const orderFee = (Number(ledgerAmount) * PLAYEROK_FEE_PERCENT / 100).toFixed(2)
    if (!matchedPreset) {
      console.warn(`[Playerok] No service cost preset matched order ${orderId}: ${itemTitle}`)
    }

    const existing = await db.select({
      id: entries.id,
      orderStatus: entries.orderStatus,
      buyerUsername: entries.buyerUsername,
      waitingSince: entries.waitingSince,
    })
      .from(entries)
      .where(eq(entries.externalOrderId, orderId))
      .limit(1)

    let entryId = existing[0]?.id
    let alreadyLogged = Boolean(entryId)
    let existingStatus = existing[0]?.orderStatus
    let existingBuyerUsername = existing[0]?.buyerUsername
    let existingWaitingSince = existing[0]?.waitingSince
    if (!entryId) {
      const inserted = await db.insert(entries).values({
        service: normalizeItemTitle(itemTitle),
        platform: "PO",
        date: timestamp.toISOString().slice(0, 10),
        earned: "0",
        feePercent: String(PLAYEROK_FEE_PERCENT),
        feeAmt: "0",
        paid: "0",
        profit: "0",
        orderStatus: "New Order Received",
        orderAmount: ledgerAmount,
        orderCost,
        orderFee,
        externalOrderId: orderId,
        source: "playerok",
        buyerUsername: buyerUsername || null,
        waitingSince: timestamp.toISOString().slice(0, 10),
        originalCurrency: currency === "RUB" ? "RUB" : null,
        exchangeRate: currency === "RUB" ? String(RUB_PER_USD) : null,
      }).onConflictDoNothing({ target: entries.externalOrderId }).returning({ id: entries.id })

      entryId = inserted[0]?.id
      if (!entryId) {
        const conflict = await db.select({
          id: entries.id,
          orderStatus: entries.orderStatus,
          buyerUsername: entries.buyerUsername,
          waitingSince: entries.waitingSince,
        })
          .from(entries)
          .where(eq(entries.externalOrderId, orderId))
          .limit(1)
        entryId = conflict[0]?.id
        existingStatus = conflict[0]?.orderStatus
        existingBuyerUsername = conflict[0]?.buyerUsername
        existingWaitingSince = conflict[0]?.waitingSince
        alreadyLogged = Boolean(entryId)
      }
    }

    if (!entryId) throw new Error("Playerok order could not be inserted or retrieved")

    if (alreadyLogged) {
      const normalizedStatus = (existingStatus ?? "").trim().toLowerCase()
      const isCompleted = normalizedStatus === "completed" || normalizedStatus === "delivered"
      const preserveTerminalStatus = isCompleted || normalizedStatus === "refunded" || normalizedStatus === "cancelled"
      const nextStatus = preserveTerminalStatus ? existingStatus! : "New Order Received"
      const earned = isCompleted ? ledgerAmount : "0"
      const paid = isCompleted ? orderCost : "0"
      const feeAmt = isCompleted ? orderFee : "0"
      const profit = isCompleted
        ? String(Number(ledgerAmount) - Number(orderCost) - Number(orderFee))
        : "0"

      await db.update(entries).set({
        service: normalizeItemTitle(itemTitle),
        platform: "PO",
        date: timestamp.toISOString().slice(0, 10),
        earned,
        feePercent: String(PLAYEROK_FEE_PERCENT),
        feeAmt,
        paid,
        profit,
        orderStatus: nextStatus,
        orderAmount: ledgerAmount,
        orderCost,
        orderFee,
        source: "playerok",
        buyerUsername: buyerUsername || existingBuyerUsername || null,
        waitingSince: existingWaitingSince || timestamp.toISOString().slice(0, 10),
        originalCurrency: currency === "RUB" ? "RUB" : null,
        exchangeRate: currency === "RUB" ? String(RUB_PER_USD) : null,
      }).where(eq(entries.id, entryId))
    }

    return jsonResponse({ success: true, orderId, alreadyLogged, costPresetMatched: Boolean(matchedPreset) })
  } catch (error) {
    console.error("[Playerok] Order webhook failed:", error)
    return jsonResponse({ error: "Playerok webhook processing failed" }, 500)
  }
}
