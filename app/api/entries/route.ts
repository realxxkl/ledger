import { NextResponse, type NextRequest } from "next/server"
import { db } from "@/lib/db"
import { entries } from "@/lib/db/schema"
import { ensureOrderTrackingSchema } from "@/lib/db/ensure-order-tracking-schema"
import {
  isFulfilledOrCompletedStatus,
  isValidCardLast4,
  isValidGameLoginLink,
  normalizePackCombination,
  parseVbucksAmount,
} from "@/lib/bot-status"
import { eq } from "drizzle-orm"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const s = (v: unknown) => String(Number(v) || 0)

class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function parseOptionalPositiveInt(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string" && value.trim() === "") return null
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) {
    throw new HttpError(`${label} must be a positive integer`, 400)
  }
  const parsed = typeof value === "number" ? value : Number(String(value).trim())
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new HttpError(`${label} must be a positive integer`, 400)
  }
  return parsed
}

function parseOptionalText(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== "string") {
    throw new HttpError(`${label} must be a string`, 400)
  }
  const trimmed = value.trim()
  return trimmed || null
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json()
    if (!b?.service || !b?.platform || !b?.date) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const serviceName = String(b.service)
    const epicUsername = b.epicUsername !== undefined ? parseOptionalText(b.epicUsername, "Epic username") : null
    const cardLast4 = b.cardLast4 !== undefined ? parseOptionalText(b.cardLast4, "Card last 4") : null
    if (cardLast4 !== null && !isValidCardLast4(cardLast4)) {
      return NextResponse.json({ error: "Card last 4 must be exactly 4 digits" }, { status: 400 })
    }
    const gameLoginLink = b.gameLoginLink !== undefined ? parseOptionalText(b.gameLoginLink, "Game login link") : null
    if (gameLoginLink !== null && !isValidGameLoginLink(gameLoginLink)) {
      return NextResponse.json({ error: "Game login link must be a valid http(s) URL" }, { status: 400 })
    }
    const explicitVbucks = b.vbucksAmount !== undefined ? parseOptionalPositiveInt(b.vbucksAmount, "V-Bucks amount") : null
    const vbucksAmount = explicitVbucks ?? parseVbucksAmount(serviceName)
    const packResult = b.packCombination !== undefined
      ? normalizePackCombination(b.packCombination)
      : { ok: true as const, value: null }
    if (!packResult.ok) {
      return NextResponse.json({ error: packResult.error }, { status: 400 })
    }

    const paidUsd = Number(b.paid) || 0
    await ensureOrderTrackingSchema()

    await db.insert(entries).values({
      service: serviceName,
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
      epicUsername,
      vbucksAmount,
      packCombination: packResult.value,
      cardLast4,
      gameLoginLink,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
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
    const hasEpicUsername = Object.prototype.hasOwnProperty.call(b ?? {}, "epicUsername")
    const hasVbucksAmount = Object.prototype.hasOwnProperty.call(b ?? {}, "vbucksAmount")
    const hasPackCombination = Object.prototype.hasOwnProperty.call(b ?? {}, "packCombination")
    const hasCardLast4 = Object.prototype.hasOwnProperty.call(b ?? {}, "cardLast4")
    const hasGameLoginLink = Object.prototype.hasOwnProperty.call(b ?? {}, "gameLoginLink")
    const hasErrorReason = Object.prototype.hasOwnProperty.call(b ?? {}, "errorReason")

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Missing or invalid entry id" }, { status: 400 })
    }
    if (date !== undefined && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) {
      return NextResponse.json({ error: "Order date must be a valid YYYY-MM-DD date" }, { status: 400 })
    }
    if (
      orderStatus === undefined &&
      date === undefined &&
      !hasEpicUsername &&
      !hasVbucksAmount &&
      !hasPackCombination &&
      !hasCardLast4 &&
      !hasGameLoginLink &&
      !hasErrorReason
    ) {
      return NextResponse.json({ error: "No order fields to update" }, { status: 400 })
    }

    const parsedEpicUsername = hasEpicUsername ? parseOptionalText(b.epicUsername, "Epic username") : undefined
    const parsedCardLast4 = hasCardLast4 ? parseOptionalText(b.cardLast4, "Card last 4") : undefined
    if (parsedCardLast4 !== undefined && parsedCardLast4 !== null && !isValidCardLast4(parsedCardLast4)) {
      return NextResponse.json({ error: "Card last 4 must be exactly 4 digits" }, { status: 400 })
    }
    const parsedGameLoginLink = hasGameLoginLink ? parseOptionalText(b.gameLoginLink, "Game login link") : undefined
    if (parsedGameLoginLink !== undefined && parsedGameLoginLink !== null && !isValidGameLoginLink(parsedGameLoginLink)) {
      return NextResponse.json({ error: "Game login link must be a valid http(s) URL" }, { status: 400 })
    }
    const parsedVbucksAmount = hasVbucksAmount ? parseOptionalPositiveInt(b.vbucksAmount, "V-Bucks amount") : undefined
    let parsedPackCombination: number[] | null | undefined = undefined
    if (hasPackCombination) {
      const packResult = normalizePackCombination(b.packCombination)
      if (!packResult.ok) {
        return NextResponse.json({ error: packResult.error }, { status: 400 })
      }
      parsedPackCombination = packResult.value
    }
    const parsedErrorReason = hasErrorReason ? parseOptionalText(b.errorReason, "Error reason") : undefined

    if (orderStatus !== undefined && (typeof orderStatus !== "string" || !orderStatus.trim())) {
      return NextResponse.json({ error: "Order status must be a non-empty string" }, { status: 400 })
    }

    await ensureOrderTrackingSchema()

    await db.transaction(async (tx) => {
      const current = await tx
        .select({
          service: entries.service,
          orderAmount: entries.orderAmount,
          orderCost: entries.orderCost,
          orderFee: entries.orderFee,
          epicUsername: entries.epicUsername,
          vbucksAmount: entries.vbucksAmount,
          packCombination: entries.packCombination,
          cardLast4: entries.cardLast4,
          gameLoginLink: entries.gameLoginLink,
        })
        .from(entries)
        .where(eq(entries.id, id))
        .limit(1)

      if (!current[0]) {
        throw new HttpError("Order not found", 404)
      }

      const updates: Partial<typeof entries.$inferInsert> = {}
      if (date !== undefined) updates.date = date
      if (hasEpicUsername) updates.epicUsername = parsedEpicUsername ?? null
      if (hasVbucksAmount) updates.vbucksAmount = parsedVbucksAmount ?? null
      if (hasPackCombination) updates.packCombination = parsedPackCombination ?? null
      if (hasCardLast4) updates.cardLast4 = parsedCardLast4 ?? null
      if (hasGameLoginLink) updates.gameLoginLink = parsedGameLoginLink ?? null
      if (hasErrorReason) updates.errorReason = parsedErrorReason ?? null

      if (orderStatus !== undefined) {
        const trimmedStatus = String(orderStatus).trim()
        if (trimmedStatus === "READY_FOR_TOPUP") {
          const resolvedEpicUsername = hasEpicUsername ? parsedEpicUsername : current[0].epicUsername
          const resolvedCardLast4 = hasCardLast4 ? parsedCardLast4 : current[0].cardLast4
          const resolvedGameLoginLink = hasGameLoginLink ? parsedGameLoginLink : current[0].gameLoginLink
          const resolvedVbucksAmount = hasVbucksAmount
            ? parsedVbucksAmount
            : (current[0].vbucksAmount ?? parseVbucksAmount(current[0].service))

          const missing: string[] = []
          if (!resolvedEpicUsername?.trim()) missing.push("Epic username is required")
          if (!resolvedCardLast4 || !isValidCardLast4(resolvedCardLast4)) missing.push("Card last 4 digits must be exactly 4 digits")
          if (!resolvedGameLoginLink || !isValidGameLoginLink(resolvedGameLoginLink)) missing.push("Valid Epic game login link (http/https) is required")
          if (!resolvedVbucksAmount || !Number.isSafeInteger(resolvedVbucksAmount) || resolvedVbucksAmount <= 0) {
            missing.push("Positive V-Bucks amount is required")
          }
          if (missing.length > 0) {
            throw new HttpError(missing.join("; "), 400)
          }

          updates.orderStatus = "READY_FOR_TOPUP"
          updates.epicUsername = resolvedEpicUsername!.trim()
          updates.cardLast4 = resolvedCardLast4!
          updates.gameLoginLink = resolvedGameLoginLink!
          updates.vbucksAmount = resolvedVbucksAmount!
          updates.errorReason = null
        } else if (isFulfilledOrCompletedStatus(trimmedStatus)) {
          const orderAmount = Number(current[0].orderAmount ?? 0)
          const orderCost = Number(current[0].orderCost ?? 0)
          const orderFee = Number(current[0].orderFee ?? 0)
          updates.orderStatus = trimmedStatus
          if (orderAmount > 0 || orderCost > 0 || orderFee > 0) {
            updates.earned = String(orderAmount)
            updates.paid = String(orderCost)
            updates.feeAmt = String(orderFee)
            updates.profit = String(orderAmount - orderCost - orderFee)
          }
        } else {
          updates.orderStatus = trimmedStatus
        }
      }

      await tx.update(entries).set(updates).where(eq(entries.id, id))
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
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
