import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { ensureOrderTrackingSchema } from "@/lib/db/ensure-order-tracking-schema"
import { entries } from "@/lib/db/schema"
import { fulfillOrderOnPlayerok } from "@/lib/playerok-fulfillment"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: rawId } = await params
    const orderId = Number(rawId)
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return NextResponse.json({ error: "Invalid order ID" }, { status: 400 })
    }

    await ensureOrderTrackingSchema()
    const orderRows = await db
      .select({ id: entries.id })
      .from(entries)
      .where(eq(entries.id, orderId))
      .limit(1)

    if (!orderRows[0]) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 })
    }

    const result = await fulfillOrderOnPlayerok({ orderId })
    if (!result.attempted) {
      return NextResponse.json(
        { error: "This order is not linked to a PlayerOK deal." },
        { status: 400 },
      )
    }

    if (result.error && (!result.messageSent || !result.dealCompleted)) {
      return NextResponse.json({ ...result, ok: false }, { status: 502 })
    }

    return NextResponse.json({ ...result, ok: true })
  } catch (err) {
    console.error("[Playerok] POST /api/orders/[id]/playerok-deliver failed:", err)
    return NextResponse.json(
      { error: "Failed to deliver proof and complete deal on Playerok" },
      { status: 500 },
    )
  }
}
