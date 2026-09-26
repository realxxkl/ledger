import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { saveEpicAuthLink } from "@/lib/epic-sessions"

const OAUTH_BASE = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth"

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { orderId } = await request.json()
    if (!Number.isInteger(Number(orderId))) return NextResponse.json({ error: "Missing order ID" }, { status: 400 })
    const basicToken = process.env.EPIC_BASIC_TOKEN
    if (!basicToken) {
      return NextResponse.json({ error: "Epic authentication is not configured" }, { status: 500 })
    }

    const clientTokenResponse = await fetch(`${OAUTH_BASE}/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
      cache: "no-store",
    })
    const clientTokenData = await clientTokenResponse.json()
    if (!clientTokenResponse.ok || !clientTokenData.access_token) {
      return NextResponse.json({ error: "Epic client authentication failed" }, { status: 502 })
    }

    const deviceResponse = await fetch(`${OAUTH_BASE}/deviceAuthorization`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clientTokenData.access_token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ prompt: "login" }),
      cache: "no-store",
    })
    const deviceData = await deviceResponse.json()
    if (!deviceResponse.ok) {
      return NextResponse.json({ error: "Epic device authorization failed" }, { status: 502 })
    }

    await saveEpicAuthLink(Number(orderId), deviceData.verification_uri_complete, deviceData.expires_in, deviceData.user_code)
    return NextResponse.json(deviceData)
  } catch (error) {
    console.error("[v0] Epic generate auth link failed:", error)
    return NextResponse.json({ error: "Unable to generate Epic auth link" }, { status: 500 })
  }
}
