import { NextResponse, type NextRequest } from "next/server"
import { db } from "@/lib/db"
import { entries, presets } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const s = (v: unknown) => String(Number(v) || 0)

// Map U7Buy order statuses to display names
const ORDER_STATUS_MAP: Record<number, string> = {
  1: "New Order Received",
  2: "Processing",
  3: "In Progress",
  4: "Awaiting Delivery",
  5: "To Receive",
  6: "Completed",
  7: "Cancelled",
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Verify webhook is from U7Buy (basic validation)
    // In production, you may want to verify signature/timestamp
    if (!body.orderId || !body.productName) {
      console.error("[v0] Invalid U7Buy webhook payload:", body)
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }

    // Extract order data
    const orderId = String(body.orderId)
    const productName = String(body.productName)
    const earned = Number(body.totalAmount || body.subTotal || 0)
    const orderDate = body.orderTime ? new Date(body.orderTime).toISOString().split("T")[0] : new Date().toISOString().split("T")[0]
    const orderStatusCode = Number(body.orderStatus || 1)
    const orderStatusText = ORDER_STATUS_MAP[orderStatusCode] || `Status ${orderStatusCode}`

    // Check if this order is already synced
    const existing = await db
      .select({ id: entries.id })
      .from(entries)
      .where(eq(entries.u7buyOrderId, orderId))
      .limit(1)

    if (existing.length > 0) {
      console.log("[v0] Order already synced:", orderId)
      return NextResponse.json({ ok: true, skipped: true })
    }

    // Find matching preset to get cost
    const preset = await db
      .select({ cost: presets.cost })
      .from(presets)
      .where(eq(presets.name, productName))
      .limit(1)

    const paid = preset.length > 0 ? Number(preset[0].cost) : 0

    // Calculate fee (using 4% as default if not in presets)
    const feePercent = 4
    const feeAmt = earned * (feePercent / 100)
    const profit = earned - feeAmt - paid

    // Create the ledger entry
    await db.insert(entries).values({
      service: productName,
      platform: "U7Buy",
      date: orderDate,
      earned: s(earned),
      feePercent: s(feePercent),
      feeAmt: s(feeAmt),
      paid: s(paid),
      profit: s(profit),
      orderStatus: orderStatusText,
      u7buyOrderId: orderId,
    })

    console.log("[v0] U7Buy order synced:", orderId, productName, earned)
    return NextResponse.json({ ok: true, synced: true })
  } catch (err) {
    console.error("[v0] POST /api/webhooks/u7buy failed:", err)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}
