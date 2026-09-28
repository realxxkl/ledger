import { acquireEpicRefreshLease, releaseEpicRefreshLease, updateEpicSessionTokens } from "@/lib/epic-sessions"

const OAUTH_BASE = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth"

export async function refreshEpicSession(orderId: number, refreshToken: string) {
  const leaseId = crypto.randomUUID()
  let current = await acquireEpicRefreshLease(orderId, leaseId)
  for (let attempt = 0; !current && attempt < 6; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    current = await acquireEpicRefreshLease(orderId, leaseId)
  }
  if (!current) throw new Error("Epic refresh is already in progress")

  try {
    if (current.refreshToken && current.refreshToken !== refreshToken && current.accessToken && current.expiresAt && current.expiresAt.getTime() > Date.now() + 30_000) {
      return { accessToken: current.accessToken, refreshToken: current.refreshToken, expiresIn: undefined }
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
    try { data = raw ? JSON.parse(raw) : {} } catch {}
    if (!response.ok || !data.access_token) {
      console.error(`[Epic] Refresh rejected for order ${orderId}`, { status: response.status, error: data.error, errorCode: data.errorCode })
      throw new Error(data.errorMessage || data.error || `Epic refresh failed with HTTP ${response.status}`)
    }

    const nextRefreshToken = data.refresh_token || refreshToken
    await updateEpicSessionTokens(orderId, {
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
