import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { getEpicSession } from "@/lib/epic-sessions"
import { OAUTH_BASE, refreshEpicSession } from "@/lib/epic-refresh"

const EXCHANGE_URL = `${OAUTH_BASE}/exchange`

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { orderId } = await request.json()
    const account = await getEpicSession(Number(orderId))
    if (!account?.accessToken) return NextResponse.json({ error: "No authenticated Epic account for this order" }, { status: 404 })
    let accessToken = account.accessToken
    const shouldRefresh = Boolean(account.refreshToken && account.expiresAt && account.expiresAt.getTime() <= Date.now() + 30_000)
    if (shouldRefresh && account.refreshToken) {
      try {
        const refreshed = await refreshEpicSession(Number(orderId), account.refreshToken)
        accessToken = refreshed.accessToken
      } catch (refreshError) {
        console.error("[v0] Epic proactive refresh failed:", refreshError)
      }
    }
    let response = await fetch(EXCHANGE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    })
    let data = await response.json()

    if (!response.ok && account.refreshToken) {
      try {
        const refreshed = await refreshEpicSession(Number(orderId), account.refreshToken)
        accessToken = refreshed.accessToken
      } catch (refreshError) {
        console.error("[v0] Epic refresh token rejected; preserving stored session:", refreshError)
        return NextResponse.json(
          { error: "Epic refresh was rejected. The saved account session was preserved; try again or authenticate this order again." },
          { status: 409 },
        )
      }
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
