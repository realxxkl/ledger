import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { getEpicSession } from "@/lib/epic-sessions"
import { OAUTH_BASE, refreshEpicSession } from "@/lib/epic-refresh"

const EXCHANGE_URL = `${OAUTH_BASE}/exchange`

type EpicExchangeResponse = {
  code?: string
  error?: string
  errorMessage?: string
  errorCode?: string
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const orderId = Number(body?.orderId)
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return NextResponse.json({ error: "Invalid order ID" }, { status: 400 })
    }

    let account = await getEpicSession(orderId)
    if (!account?.accessToken) {
      return NextResponse.json({ error: "No authenticated Epic account for this order" }, { status: 404 })
    }

    let accessToken = account.accessToken
    const shouldRefresh = Boolean(
      account.refreshToken &&
      account.expiresAt &&
      account.expiresAt.getTime() <= Date.now() + 30_000,
    )

    if (shouldRefresh && account.refreshToken) {
      try {
        const refreshed = await refreshEpicSession(orderId, account.refreshToken)
        accessToken = refreshed.accessToken
        account = {
          ...account,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresIn
            ? new Date(Date.now() + refreshed.expiresIn * 1000)
            : account.expiresAt,
        }
      } catch (error) {
        console.error(`[Epic] Order ${orderId}: proactive refresh failed`, error instanceof Error ? error.message : error)
      }
    }

    async function requestExchange(token: string) {
      const response = await fetch(EXCHANGE_URL, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
      })
      const raw = await response.text()
      let data: EpicExchangeResponse = {}
      try { data = raw ? JSON.parse(raw) : {} } catch { /* Epic may return non-JSON errors. */ }
      return { response, data }
    }

    let result = await requestExchange(accessToken)
    const tokenRejected = result.response.status === 401 || result.response.status === 403

    if (tokenRejected && account.refreshToken) {
      try {
        console.log(`[Epic] Order ${orderId}: access token rejected, refreshing session`)
        const refreshed = await refreshEpicSession(orderId, account.refreshToken)
        accessToken = refreshed.accessToken
        result = await requestExchange(accessToken)
      } catch (refreshError) {
        console.error(`[Epic] Order ${orderId}: refresh failed`, refreshError instanceof Error ? refreshError.message : refreshError)
        return NextResponse.json({ error: "Epic access token expired and the saved refresh token could not be used. Re-authenticate this order.", requiresReauthentication: true }, { status: 409 })
      }
    }

    if (!result.response.ok) {
      console.error(`[Epic] Exchange failed for order ${orderId}`, { status: result.response.status, error: result.data.error, errorMessage: result.data.errorMessage, errorCode: result.data.errorCode })
      return NextResponse.json({ error: result.data.errorMessage || result.data.error || `Epic exchange failed with HTTP ${result.response.status}`, epicStatus: result.response.status, epicErrorCode: result.data.errorCode }, { status: 502 })
    }
    if (!result.data.code) {
      return NextResponse.json({ error: "Epic did not return an exchange code" }, { status: 502 })
    }
    return NextResponse.json({ code: result.data.code })
  } catch (error) {
    console.error("[Epic] Token exchange route failed:", error)
    return NextResponse.json({ error: "Unable to exchange Epic token" }, { status: 500 })
  }
}
