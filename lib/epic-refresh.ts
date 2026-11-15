import { acquireEpicRefreshLease, getEpicSession, releaseEpicRefreshLease, updateEpicSessionTokens } from "@/lib/epic-sessions"

const OAUTH_BASE = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth"

type RefreshedEpicSession = {
  accessToken: string
  refreshToken: string
  expiresIn?: number
}

export async function refreshEpicSession(
  orderId: number,
  options: { force?: boolean; rejectedAccessToken?: string } = {},
): Promise<RefreshedEpicSession> {
  const leaseId = crypto.randomUUID()
  let current = await acquireEpicRefreshLease(orderId, leaseId)
  for (let attempt = 0; !current && attempt < 6; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    current = await acquireEpicRefreshLease(orderId, leaseId)
  }
  if (!current) {
    const latest = await getEpicSession(orderId)
    if (
      latest?.accessToken &&
      latest.refreshToken &&
      latest.expiresAt &&
      latest.expiresAt.getTime() > Date.now() + 30_000 &&
      (!options.force || !options.rejectedAccessToken || latest.accessToken !== options.rejectedAccessToken)
    ) {
      return {
        accessToken: latest.accessToken,
        refreshToken: latest.refreshToken,
        expiresIn: Math.floor((latest.expiresAt.getTime() - Date.now()) / 1000),
      }
    }
    throw new Error("Epic refresh is already in progress and no renewed access token is available yet")
  }

  try {
    const refreshToken = current.refreshToken
    if (!refreshToken) throw new Error("No Epic refresh token is stored for this order")
    const expiresAt = current.expiresAt
    const currentAccessValid = Boolean(
      current.accessToken && expiresAt && expiresAt.getTime() > Date.now() + 30_000,
    )
    const anotherRequestRefreshed =
      currentAccessValid &&
      Boolean(options.rejectedAccessToken) &&
      current.accessToken !== options.rejectedAccessToken
    if (current.accessToken && expiresAt && currentAccessValid && (!options.force || anotherRequestRefreshed)) {
      return {
        accessToken: current.accessToken,
        refreshToken,
        expiresIn: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
      }
    }

    const basicToken = process.env.EPIC_BASIC_TOKEN
    if (!basicToken) throw new Error("EPIC_BASIC_TOKEN is not configured")

    const response = await fetch(`${OAUTH_BASE}/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basicToken}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
      cache: "no-store",
    })
    const raw = await response.text()
    let data: { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; errorMessage?: string; errorCode?: string } = {}
    try { data = raw ? JSON.parse(raw) : {} } catch {
      console.error(`[Epic] Refresh response was not valid JSON for order ${orderId}`)
    }
    if (!response.ok || !data.access_token) {
      console.error(`[Epic] Refresh rejected for order ${orderId}`, { status: response.status, error: data.error, errorCode: data.errorCode })
      throw new Error(data.errorMessage || data.error || `Epic refresh failed with HTTP ${response.status}`)
    }

    const nextRefreshToken = data.refresh_token || refreshToken
    await updateEpicSessionTokens(orderId, leaseId, {
      accessToken: data.access_token,
      refreshToken: nextRefreshToken,
      expiresIn: data.expires_in,
    })
    return { accessToken: data.access_token, refreshToken: nextRefreshToken, expiresIn: data.expires_in }
  } finally {
    await releaseEpicRefreshLease(orderId, leaseId)
  }
}
export { OAUTH_BASE }
