import { NextResponse, type NextRequest } from "next/server"
import { db } from "@/lib/db"
import { entries, epicOrderSessions } from "@/lib/db/schema"
import { ensureOrderTrackingSchema } from "@/lib/db/ensure-order-tracking-schema"
import { getEpicVBucksBalance } from "@/lib/epic-balance"
import { refreshEpicSession } from "@/lib/epic-refresh"
import { eq } from "drizzle-orm"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const s = (v: unknown) => String(Number(v) || 0)

export async function POST(req: NextRequest) {
  try {
    const b = await req.json()
    if (!b?.service || !b?.platform || !b?.date) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const paidUsd = Number(b.paid) || 0
    await ensureOrderTrackingSchema()

    await db.insert(entries).values({
      service: String(b.service),
      platform: String(b.platform),
      date: String(b.date),
      earned: s(b.earned),
      feePercent: s(b.feePercent),
      feeAmt: s(b.feeAmt),
      paid: s(paidUsd),
      profit: s(b.profit),
      waitingSince: b.u7buyOrderId ? new Date().toISOString() : null,
      orderAmount: s(b.orderAmount),
      orderCost: s(b.orderCost),
      orderFee: s(b.orderFee),
      orderStatus: b.orderStatus || null,
      u7buyOrderId: b.u7buyOrderId || null,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[v0] POST /api/entries failed:", err)
    return NextResponse.json({ error: "Failed to add entry" }, { status: 500 })
  }
}

async function revokeEpicToken(token: string, tokenTypeHint: "access_token" | "refresh_token", basicToken: string) {
  const response = await fetch("https://api.epicgames.dev/epic/oauth/v2/revoke", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ token, token_type_hint: tokenTypeHint }),
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`Epic ${tokenTypeHint} revocation returned HTTP ${response.status}`)
}

export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json()
    const id = Number(b?.id)
    const orderStatus = b?.orderStatus
    const date = b?.date
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Missing or invalid entry id" }, { status: 400 })
    }
    if (date !== undefined && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) {
      return NextResponse.json({ error: "Order date must be a valid YYYY-MM-DD date" }, { status: 400 })
    }
    if (orderStatus === undefined && date === undefined) {
      return NextResponse.json({ error: "No order fields to update" }, { status: 400 })
    }

    const normalizedStatus = String(orderStatus || "").trim().toLowerCase()
    const isCompleted = ["delivered", "completed"].includes(normalizedStatus)
    const isRefunded = normalizedStatus === "refunded"
    const shouldPurgeEpicSession = isCompleted || isRefunded
    let vbucksAfter: number | undefined
    if (shouldPurgeEpicSession) {
      await ensureOrderTrackingSchema()
      const epicRows = await db.select({
        accountId: epicOrderSessions.accountId,
        accessToken: epicOrderSessions.accessToken,
        refreshToken: epicOrderSessions.refreshToken,
        expiresAt: epicOrderSessions.expiresAt,
      })
        .from(epicOrderSessions).where(eq(epicOrderSessions.orderId, id)).limit(1)
      const epicSession = epicRows[0]
      let accessToken = epicSession?.accessToken
      let refreshToken = epicSession?.refreshToken
      if (
        isCompleted &&
        epicSession?.expiresAt &&
        epicSession.expiresAt.getTime() <= Date.now() + 30_000 &&
        refreshToken
      ) {
        try {
          const refreshed = await refreshEpicSession(id, refreshToken)
          accessToken = refreshed.accessToken
          refreshToken = refreshed.refreshToken
        } catch (error) {
          console.error(`[Epic] Could not refresh session before final VBucks query for order ${id}`, error)
          return NextResponse.json({ error: "Epic session could not be refreshed; the order was not completed and the saved session was preserved." }, { status: 502 })
        }
      }
      if (isCompleted && epicSession?.accountId && accessToken) {
        try {
          const balance = await getEpicVBucksBalance(epicSession.accountId, accessToken)
          vbucksAfter = balance.totalVBucks
        } catch (error) {
          console.error(`[Epic] Could not record final VBucks balance for order ${id}`, error)
          return NextResponse.json({ error: "Epic balance could not be retrieved; the order was not completed and the saved session was preserved." }, { status: 502 })
        }
      }
      if (accessToken || refreshToken) {
        const basicToken = process.env.EPIC_BASIC_TOKEN
        if (!basicToken) return NextResponse.json({ error: "Epic credentials are not configured; session was not purged" }, { status: 503 })
        try {
          if (refreshToken) await revokeEpicToken(refreshToken, "refresh_token", basicToken)
          if (accessToken) await revokeEpicToken(accessToken, "access_token", basicToken)
        } catch (error) {
          console.error(`[Epic] Could not revoke session for order ${id}`, error instanceof Error ? error.message : "unknown error")
          return NextResponse.json({ error: "Epic access could not be revoked, so the order status was not updated and the saved session was preserved." }, { status: 502 })
        }
      }
    }

    await db.transaction(async (tx) => {
      if (orderStatus !== undefined) {
        if (isCompleted) {
          const current = await tx.select({ orderAmount: entries.orderAmount, orderCost: entries.orderCost, orderFee: entries.orderFee })
            .from(entries).where(eq(entries.id, id)).limit(1)
          if (!current[0]) throw new Error("Order not found")
          const orderAmount = Number(current[0].orderAmount ?? 0)
          const orderCost = Number(current[0].orderCost ?? 0)
          const orderFee = Number(current[0].orderFee ?? 0)
          await tx.update(entries).set({
            orderStatus: String(orderStatus),
            earned: String(orderAmount),
            paid: String(orderCost),
            feeAmt: String(orderFee),
            profit: String(orderAmount - orderCost - orderFee),
            ...(vbucksAfter !== undefined ? { vbucksAfter } : {}),
            ...(date ? { date } : {}),
          }).where(eq(entries.id, id))
          await tx.delete(epicOrderSessions).where(eq(epicOrderSessions.orderId, id))
      } else if (isRefunded) {
        await tx.update(entries).set({ orderStatus: String(orderStatus), ...(date ? { date } : {}) }).where(eq(entries.id, id))
        await tx.delete(epicOrderSessions).where(eq(epicOrderSessions.orderId, id))
      } else {
        await tx.update(entries).set({ orderStatus: String(orderStatus), ...(date ? { date } : {}) }).where(eq(entries.id, id))
      }
    } else {
        await tx.update(entries).set({ date }).where(eq(entries.id, id))
      }
    })
    return NextResponse.json({ ok: true, epicSessionPurged: shouldPurgeEpicSession })
  } catch (err) {
    console.error("[v0] PATCH /api/entries failed:", err)
    return NextResponse.json({ error: "Failed to update entry" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id")
    if (id) {
      await db.delete(entries).where(eq(entries.id, Number(id)))
    } else {
      // No id => clear all entries
      await db.delete(entries)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[v0] DELETE /api/entries failed:", err)
    return NextResponse.json({ error: "Failed to delete entry" }, { status: 500 })
  }
}
