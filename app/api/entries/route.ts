import { NextResponse, type NextRequest } from "next/server"
import { db } from "@/lib/db"
import { entries } from "@/lib/db/schema"
import { ensureOrderTrackingSchema } from "@/lib/db/ensure-order-tracking-schema"
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
            ...(date ? { date } : {}),
          }).where(eq(entries.id, id))
      } else if (isRefunded) {
        await tx.update(entries).set({ orderStatus: String(orderStatus), ...(date ? { date } : {}) }).where(eq(entries.id, id))
      } else {
        await tx.update(entries).set({ orderStatus: String(orderStatus), ...(date ? { date } : {}) }).where(eq(entries.id, id))
      }
    } else {
        await tx.update(entries).set({ date }).where(eq(entries.id, id))
      }
    })
    return NextResponse.json({ ok: true })
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
