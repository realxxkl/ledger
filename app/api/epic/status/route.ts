import { NextRequest, NextResponse } from "next/server"

const OAUTH_BASE = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth"
const ACCOUNT_BASE = "https://account-public-service-prod.ol.epicgames.com/account/api/public/account"

export async function POST(request: NextRequest) {
  try {
    const { deviceCode } = await request.json()
    if (!deviceCode) return NextResponse.json({ status: "error", error: "Missing device code" }, { status: 400 })
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
      if (tokenData.errorCode === "errors.com.epicgames.account.oauth.authorization_pending") {
        return NextResponse.json({ status: "pending" })
      }
      return NextResponse.json({ status: "error", error: "Epic authorization was not completed" }, { status: 400 })
    }

    const profileResponse = await fetch(`${ACCOUNT_BASE}/${encodeURIComponent(tokenData.account_id)}`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      cache: "no-store",
    })
    const profileData = await profileResponse.json()
    return NextResponse.json({
      status: "completed",
      accountToken: tokenData.access_token,
      displayName: profileData.displayName || tokenData.displayName,
      accountId: tokenData.account_id,
    })
  } catch (error) {
    console.error("[v0] Epic authorization status failed:", error)
    return NextResponse.json({ status: "error", error: "Unable to check Epic authorization" }, { status: 500 })
  }
}
