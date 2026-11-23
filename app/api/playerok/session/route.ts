import { NextRequest, NextResponse } from "next/server"
import { desc } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { ensureOrderTrackingSchema } from "@/lib/db/ensure-order-tracking-schema"
import { playerokSession } from "@/lib/db/schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isAuthorized(request: NextRequest, sessionUser: boolean) {
  const webhookSecret = request.headers.get("x-webhook-secret")
  return (
    sessionUser ||
    (Boolean(webhookSecret) &&
      Boolean(process.env.WEBHOOK_SECRET) &&
      webhookSecret === process.env.WEBHOOK_SECRET)
  )
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!isAuthorized(request, Boolean(session?.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    await ensureOrderTrackingSchema()
    const latest = await db.select()
      .from(playerokSession)
      .orderBy(desc(playerokSession.updatedAt))
      .limit(1)

    return NextResponse.json({
      hasCookies: Boolean(latest[0]?.cookies),
      updatedAt: latest[0]?.updatedAt || null,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get session status" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!isAuthorized(request, Boolean(session?.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const cookies = typeof body.cookies === "string" ? body.cookies.trim() : ""
    if (!cookies) {
      return NextResponse.json({ error: "Cookies string is required" }, { status: 400 })
    }

    await ensureOrderTrackingSchema()

    // Delete previous sessions and save the fresh cookies
    await db.delete(playerokSession)
    const inserted = await db.insert(playerokSession).values({
      cookies,
      updatedAt: new Date(),
    }).returning({ id: playerokSession.id, updatedAt: playerokSession.updatedAt })

    return NextResponse.json({
      success: true,
      message: "Playerok session cookies updated successfully.",
      updatedAt: inserted[0]?.updatedAt,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update session cookies" },
      { status: 500 }
    )
  }
}
