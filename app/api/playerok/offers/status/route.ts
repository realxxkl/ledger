import { NextRequest, NextResponse } from "next/server"
import { desc, inArray } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { ensureOffersSchema } from "@/lib/db/ensure-offers-schema"
import { offers, playerokSession } from "@/lib/db/schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    const webhookSecret = request.headers.get("x-webhook-secret")
    const isWebhookAuthorized = Boolean(
      webhookSecret &&
      process.env.WEBHOOK_SECRET &&
      webhookSecret === process.env.WEBHOOK_SECRET
    )

    if (!session?.user && !isWebhookAuthorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 })
    }

    const action = body.action
    if (action !== "republish" && action !== "discontinue") {
      return NextResponse.json(
        { error: "Invalid action. Must be 'republish' (put on sale) or 'discontinue' (take off sale)." },
        { status: 400 }
      )
    }

    // Support single itemId or array of itemIds
    const rawIds: string[] = []
    if (typeof body.itemId === "string" && body.itemId.trim()) {
      rawIds.push(body.itemId.trim())
    }
    if (Array.isArray(body.itemIds)) {
      for (const id of body.itemIds) {
        if (typeof id === "string" && id.trim()) {
          rawIds.push(id.trim())
        }
      }
    }

    const itemIds = Array.from(new Set(rawIds))
    if (itemIds.length === 0) {
      return NextResponse.json({ error: "No offer ID(s) provided." }, { status: 400 })
    }

    // 1. Get stored cookies
    const sessionRows = await db.select()
      .from(playerokSession)
      .orderBy(desc(playerokSession.updatedAt))
      .limit(1)

    const cookieString = sessionRows[0]?.cookies
    if (!cookieString) {
      return NextResponse.json(
        { error: "No Playerok session cookies saved yet. Click [Sync Cookies] in the extension widget first." },
        { status: 400 }
      )
    }

    await ensureOffersSchema()

    const onSale = action === "republish"
    const successfulIds: string[] = []
    const failedIds: { id: string; error: string }[] = []

    const requestHeaders: Record<string, string> = {
      "Accept": "*/*",
      "Cookie": cookieString,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "Origin": "https://playerok.com",
      "Referer": "https://playerok.com/",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
    }

    for (const itemId of itemIds) {
      const url = `https://playerok.com/rest-api/public/item/${encodeURIComponent(itemId)}/${action}`
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: requestHeaders,
        })

        if (response.ok) {
          successfulIds.push(itemId)
        } else {
          let errDetail = `HTTP ${response.status}`
          if (response.status === 403) {
            errDetail = "Cloudflare blocked request or session cookies expired. Click [Sync Cookies] in the extension."
          } else {
            try {
              const text = await response.text()
              errDetail = text.slice(0, 200)
            } catch {}
          }
          failedIds.push({ id: itemId, error: errDetail })
        }
      } catch (err) {
        failedIds.push({ id: itemId, error: err instanceof Error ? err.message : "Network error" })
      }

      if (itemIds.length > 1) {
        await new Promise((r) => setTimeout(r, 100))
      }
    }

    // Update successfully changed offers in Ledger database
    if (successfulIds.length > 0) {
      await db.update(offers)
        .set({
          onSale,
          syncStatus: "SYNCED",
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(inArray(offers.externalOfferId, successfulIds))
    }

    if (successfulIds.length === 0 && failedIds.length > 0) {
      return NextResponse.json(
        {
          error: failedIds[0].error || "Failed to change offer status on Playerok.",
          failed: failedIds,
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      action,
      onSale,
      updatedCount: successfulIds.length,
      successfulIds,
      failedIds,
    })
  } catch (error) {
    console.error("[Playerok Offer Status] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to change offer status." },
      { status: 500 }
    )
  }
}
