import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { ensureOrderTrackingSchema } from "@/lib/db/ensure-order-tracking-schema"
import { getEpicVBucksBalance } from "@/lib/epic-balance"
import { refreshEpicSession } from "@/lib/epic-refresh"
import { getEpicSession } from "@/lib/epic-sessions"
import { entries } from "@/lib/db/schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userSession = await auth.api.getSession({ headers: request.headers })
    if (!userSession?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id: rawId } = await params
    const orderId = Number(rawId)
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return NextResponse.json({ error: "Invalid order ID" }, { status: 400 })
    }

    const orderRows = await db.select({ id: entries.id })
      .from(entries)
      .where(eq(entries.id, orderId))
      .limit(1)
    if (!orderRows[0]) return NextResponse.json({ error: "Order not found" }, { status: 404 })

    const epicSession = await getEpicSession(orderId)
    if (!epicSession?.accountId) {
      return NextResponse.json({ error: "No authenticated Epic account for this order" }, { status: 404 })
    }

    let accessToken = epicSession.accessToken
    if (
      epicSession.refreshToken &&
      (!accessToken || (epicSession.expiresAt && epicSession.expiresAt.getTime() <= Date.now() + 30_000))
    ) {
      const refreshed = await refreshEpicSession(orderId, epicSession.refreshToken)
      accessToken = refreshed.accessToken
    }
    if (!accessToken) {
      return NextResponse.json({ error: "Epic access token is unavailable; re-authenticate this order" }, { status: 409 })
    }

    const balance = await getEpicVBucksBalance(epicSession.accountId, accessToken)
    await ensureOrderTrackingSchema()
    await db.update(entries).set({ vbucksBefore: balance.totalVBucks }).where(eq(entries.id, orderId))
    return NextResponse.json(balance)
  } catch (error) {
    console.error("[Epic] Failed to sync VBucks balance:", error)
    return NextResponse.json({ error: "Could not retrieve the Epic VBucks balance" }, { status: 502 })
  }
}
