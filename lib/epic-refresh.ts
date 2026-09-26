import { updateEpicSessionTokens } from "@/lib/epic-sessions"

const OAUTH_BASE = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth"

export async function refreshEpicSession(orderId: number, refreshToken: string) {
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
  if (!response.ok || !data.access_token) {
    throw new Error(data.errorMessage || data.error || "Epic refresh failed")
  }

  const nextRefreshToken = data.refresh_token || refreshToken
  await updateEpicSessionTokens(orderId, {
    accessToken: data.access_token,
    refreshToken: nextRefreshToken,
    expiresIn: data.expires_in,
  })

  return {
    accessToken: data.access_token as string,
    refreshToken: nextRefreshToken as string,
    expiresIn: data.expires_in as number | undefined,
  }
}

export { OAUTH_BASE }
