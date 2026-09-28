import { eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { epicOrderSessions } from "@/lib/db/schema"

const OAUTH_BASE = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth"

export async function refreshEpicSession(orderId: number, refreshToken: string) {
  const basicToken = process.env.EPIC_BASIC_TOKEN
  if (!basicToken) throw new Error("EPIC_BASIC_TOKEN is not configured")

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`epic-refresh:${orderId}`}))`)
    const current = await tx.select({ accessToken: epicOrderSessions.accessToken, refreshToken: epicOrderSessions.refreshToken, expiresAt: epicOrderSessions.expiresAt })
      .from(epicOrderSessions)
      .where(eq(epicOrderSessions.orderId, orderId))
      .limit(1)
    const stored = current[0]
    if (stored?.refreshToken && stored.refreshToken !== refreshToken && stored.accessToken && stored.expiresAt && stored.expiresAt.getTime() > Date.now() + 30_000) {
      return { accessToken: stored.accessToken, refreshToken: stored.refreshToken, expiresIn: undefined }
    }

    const response = await fetch(`${OAUTH_BASE}/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
      cache: "no-store",
    })
    const raw = await response.text()
    let data: { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; errorMessage?: string; errorCode?: string } = {}
    try { data = raw ? JSON.parse(raw) : {} } catch { /* Keep empty for non-JSON responses. */ }
    if (!response.ok || !data.access_token) {
      console.error(`[Epic] Refresh rejected for order ${orderId}`, { status: response.status, error: data.error, errorMessage: data.errorMessage, errorCode: data.errorCode })
      const error = new Error(data.errorMessage || data.error || `Epic refresh failed with HTTP ${response.status}`)
      Object.assign(error, { status: response.status, epicError: data.error, epicErrorCode: data.errorCode })
      throw error
    }

    const nextRefreshToken = data.refresh_token || refreshToken
    const expiresAt = typeof data.expires_in === "number" ? new Date(Date.now() + data.expires_in * 1000) : stored?.expiresAt
    await tx.update(epicOrderSessions).set({
      accessToken: data.access_token,
      refreshToken: nextRefreshToken,
      expiresAt,
      updatedAt: new Date(),
    }).where(eq(epicOrderSessions.orderId, orderId))

  return {
    accessToken: data.access_token as string,
    refreshToken: nextRefreshToken as string,
    expiresIn: data.expires_in as number | undefined,
  }
  })
}

export { OAUTH_BASE }
