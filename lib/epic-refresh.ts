import { eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { epicOrderSessions } from "@/lib/db/schema"

const OAUTH_BASE = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth"

export async function refreshEpicSession(orderId: number, refreshToken: string) {
  const basicToken = process.env.EPIC_BASIC_TOKEN
  if (!basicToken) throw new Error("EPIC_BASIC_TOKEN is not configured")

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`epic-refresh:${orderId}`}))`)
    const current = await tx.select({ accessToken: epicOrderSessions.accessToken, refreshToken: epicOrderSessions.refreshToken })
      .from(epicOrderSessions)
      .where(eq(epicOrderSessions.orderId, orderId))
      .limit(1)
    const stored = current[0]
    if (stored?.refreshToken && stored.refreshToken !== refreshToken && stored.accessToken) {
      return { accessToken: stored.accessToken, refreshToken: stored.refreshToken, expiresIn: undefined }
    }

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
  if (!response.ok || !data.access_token) {
    throw new Error(data.errorMessage || data.error || "Epic refresh failed")
  }

  const nextRefreshToken = data.refresh_token || refreshToken
  await tx.update(epicOrderSessions).set({
    accessToken: data.access_token,
    refreshToken: nextRefreshToken,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
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
