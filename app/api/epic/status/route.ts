import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { saveEpicSession, saveDeviceAuth } from "@/lib/epic-sessions"
import { getEpicVBucksBalance } from "@/lib/epic-balance"
import { ensureOrderTrackingSchema } from "@/lib/db/ensure-order-tracking-schema"
import { db } from "@/lib/db"
import { entries } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

const OAUTH_BASE = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth"
const ACCOUNT_BASE = "https://account-public-service-prod.ol.epicgames.com/account/api/public/account"

async function createDeviceAuth(accountId: string, accessToken: string): Promise<{ deviceId: string; secret: string } | null> {
  try {
    const response = await fetch(
      `${ACCOUNT_BASE}/${encodeURIComponent(accountId)}/deviceAuth`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      },
    )
    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[Epic] Device auth creation failed for ${accountId}: HTTP ${response.status}`, errorText)
      return null
    }
    const data = await response.json()
    if (data.deviceId && data.secret) {
      console.log(`[Epic] Device auth created for ${accountId}: deviceId=${data.deviceId}`)
      return { deviceId: data.deviceId, secret: data.secret }
    }
    console.error(`[Epic] Device auth response missing deviceId/secret for ${accountId}`, data)
    return null
  } catch (error) {
    console.error(`[Epic] Device auth creation error for ${accountId}`, error)
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return NextResponse.json({ status: "error", error: "Unauthorized" }, { status: 401 })
    const { deviceCode, orderId } = await request.json()
    if (!deviceCode || !Number.isInteger(Number(orderId))) {
      return NextResponse.json({ status: "error", error: "Missing device code or order ID" }, { status: 400 })
    }
    const basicToken = process.env.EPIC_BASIC_TOKEN
    if (!basicToken) return NextResponse.json({ status: "error", error: "Epic authentication is not configured" }, { status: 500 })

    const tokenResponse = await fetch(`${OAUTH_BASE}/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basicToken}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "device_code", device_code: deviceCode }),
      cache: "no-store",
    })
    const tokenData = await tokenResponse.json()
    if (!tokenResponse.ok) {
      const errorCode = String(tokenData.errorCode || tokenData.error || "")
      if (errorCode.includes("authorization_pending") || errorCode.includes("authorization_pending".replaceAll("_", "-"))) {
        return NextResponse.json({ status: "pending" })
      }
      if (errorCode.includes("slow_down")) return NextResponse.json({ status: "pending" })
      return NextResponse.json({ status: "error", error: "Epic authorization was not completed" }, { status: 400 })
    }
    if (
      typeof tokenData.account_id !== "string" ||
      !tokenData.account_id ||
      typeof tokenData.access_token !== "string" ||
      !tokenData.access_token ||
      typeof tokenData.refresh_token !== "string" ||
      !tokenData.refresh_token.trim()
    ) {
      console.error("[Epic] Device authorization response did not contain a complete refreshable session")
      return NextResponse.json({
        status: "error",
        error: "Epic did not provide a refresh token. This account was not saved; try authorizing it again.",
      }, { status: 502 })
    }

    const profileResponse = await fetch(`${ACCOUNT_BASE}/${encodeURIComponent(tokenData.account_id)}`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      cache: "no-store",
    })
    const profileData = await profileResponse.json()
    const numericOrderId = Number(orderId)

    // Create device auth credentials for persistent access
    const deviceAuth = await createDeviceAuth(tokenData.account_id, tokenData.access_token)

    await saveEpicSession({
      orderId: numericOrderId,
      accountId: tokenData.account_id,
      displayName: profileData.displayName || tokenData.displayName || "Epic account",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      deviceAuthId: deviceAuth?.deviceId,
      deviceAuthSecret: deviceAuth?.secret,
    })

    let vbucksBefore: number | undefined
    let balanceWarning: string | undefined
    try {
      await ensureOrderTrackingSchema()
      const balance = await getEpicVBucksBalance(tokenData.account_id, tokenData.access_token)
      vbucksBefore = balance.totalVBucks
      await db.update(entries).set({ vbucksBefore }).where(eq(entries.id, numericOrderId))
    } catch (error) {
      console.error(`[Epic] Could not record starting VBucks balance for order ${numericOrderId}`, error)
      balanceWarning = "Epic account connected, but the starting VBucks balance could not be saved."
    }
    return NextResponse.json({
      status: "completed",
      displayName: profileData.displayName || tokenData.displayName,
      accountId: tokenData.account_id,
      vbucksBefore,
      balanceWarning,
      deviceAuth: deviceAuth ? "created" : "failed",
    })
  } catch (error) {
    console.error("[v0] Epic authorization status failed:", error)
    return NextResponse.json({ status: "error", error: "Unable to check Epic authorization" }, { status: 500 })
  }
}
