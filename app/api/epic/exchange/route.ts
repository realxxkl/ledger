import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { getEpicSession, updateEpicSessionTokens } from "@/lib/epic-sessions"

const OAUTH_BASE = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth"
const EXCHANGE_URL = `${OAUTH_BASE}/exchange`

async function refreshEpicToken(refreshToken: string) {
  const basicToken = process.env.EPIC_BASIC_TOKEN
  if (!basicToken) throw new Error("EPIC_BASIC_TOKEN is not configured")
  const response = await fetch(`${OAUTH_BASE}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    cache: "no-store",
  })
  const data = await response.json()
  if (!response.ok || !data.access_token) throw new Error(data.errorMessage || data.error || "Epic refresh failed")
  return data
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { orderId } = await request.json()
    const account = await getEpicSession(Number(orderId))
    if (!account?.accessToken) return NextResponse.json({ error: "No authenticated Epic account for this order" }, { status: 404 })
    let accessToken = account.accessToken
    let response = await fetch(EXCHANGE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    })
    let data = await response.json()

    if (!response.ok && account.refreshToken) {
      const refreshed = await refreshEpicToken(account.refreshToken)
      accessToken = refreshed.access_token
      await updateEpicSessionTokens(Number(orderId), {
        accessToken,
        refreshToken: refreshed.refresh_token ?? account.refreshToken,
        expiresIn: refreshed.expires_in,
      })
      response = await fetch(EXCHANGE_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      })
      data = await response.json()
    }

    if (!response.ok || !data.code) {
      console.error("[v0] Epic exchange rejected:", response.status, data)
      return NextResponse.json({ error: data.errorMessage || data.error || "Epic token exchange failed" }, { status: 502 })
    }
    return NextResponse.json({ code: data.code })
  } catch (error) {
    console.error("[v0] Epic token exchange failed:", error)
    return NextResponse.json({ error: "Unable to exchange Epic token" }, { status: 500 })
  }
}
