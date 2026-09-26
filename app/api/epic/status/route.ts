import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { saveEpicSession } from "@/lib/epic-sessions"

const OAUTH_BASE = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth"
const ACCOUNT_BASE = "https://account-public-service-prod.ol.epicgames.com/account/api/public/account"

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

    const profileResponse = await fetch(`${ACCOUNT_BASE}/${encodeURIComponent(tokenData.account_id)}`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      cache: "no-store",
    })
    const profileData = await profileResponse.json()
    await saveEpicSession({
      orderId: Number(orderId),
      accountId: tokenData.account_id,
      displayName: profileData.displayName || tokenData.displayName || "Epic account",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || undefined,
      expiresIn: tokenData.expires_in,
    })
    return NextResponse.json({ status: "completed", displayName: profileData.displayName || tokenData.displayName, accountId: tokenData.account_id })
  } catch (error) {
    console.error("[v0] Epic authorization status failed:", error)
    return NextResponse.json({ status: "error", error: "Unable to check Epic authorization" }, { status: 500 })
  }
}
