import { acquireEpicRefreshLease, getEpicSession, releaseEpicRefreshLease, updateEpicSessionTokens } from "@/lib/epic-sessions"

const OAUTH_BASE = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth"

type RefreshedEpicSession = {
  accessToken: string
  refreshToken: string
  expiresIn?: number
}

/**
 * Get a fresh access token using device auth credentials (persistent, never expire).
 * Returns null if device auth is not set up for this session.
 */
async function refreshViaDeviceAuth(
  accountId: string,
  deviceAuthId: string,
  deviceAuthSecret: string,
  basicToken: string,
): Promise<{ access_token: string; refresh_token?: string; expires_in?: number } | null> {
  try {
    const response = await fetch(`${OAUTH_BASE}/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "device_auth",
        account_id: accountId,
        device_id: deviceAuthId,
        secret: deviceAuthSecret,
      }),
      cache: "no-store",
    })
    const raw = await response.text()
    let data: Record<string, unknown> = {}
    try { data = raw ? JSON.parse(raw) : {} } catch { /* non-JSON */ }

    if (!response.ok || !data.access_token) {
      console.error(`[Epic] Device auth login failed for ${accountId}:`, {
        status: response.status,
        error: data.error,
        errorCode: data.errorCode,
        errorMessage: data.errorMessage,
      })
      return null
    }
    console.log(`[Epic] Device auth login succeeded for ${accountId}, expires_in=${data.expires_in}`)
    return {
      access_token: data.access_token as string,
      refresh_token: data.refresh_token as string | undefined,
      expires_in: data.expires_in as number | undefined,
    }
  } catch (error) {
    console.error(`[Epic] Device auth login error for ${accountId}:`, error)
    return null
  }
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
        refreshToken: refreshToken || "",
        expiresIn: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
      }
    }

    const basicToken = process.env.EPIC_BASIC_TOKEN
    if (!basicToken) throw new Error("EPIC_BASIC_TOKEN is not configured")

    // ── Strategy 1: Device Auth (preferred — credentials never expire) ──
    const fullSession = await getEpicSession(orderId)
    if (fullSession?.deviceAuthId && fullSession?.deviceAuthSecret && fullSession?.accountId) {
      console.log(`[Epic] Order ${orderId}: using device auth for refresh`)
      const deviceResult = await refreshViaDeviceAuth(
        fullSession.accountId,
        fullSession.deviceAuthId,
        fullSession.deviceAuthSecret,
        basicToken,
      )
      if (deviceResult) {
        const nextRefreshToken = deviceResult.refresh_token || refreshToken || ""
        await updateEpicSessionTokens(orderId, leaseId, {
          accessToken: deviceResult.access_token,
          refreshToken: nextRefreshToken || undefined,
          expiresIn: deviceResult.expires_in,
        })
        return {
          accessToken: deviceResult.access_token,
          refreshToken: nextRefreshToken,
          expiresIn: deviceResult.expires_in,
        }
      }
      console.warn(`[Epic] Order ${orderId}: device auth failed, falling back to refresh token`)
    }

    // ── Strategy 2: Refresh Token (legacy fallback) ──
    if (!refreshToken) throw new Error("No Epic refresh token or device auth credentials stored for this order")

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
