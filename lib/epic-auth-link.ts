import { saveEpicAuthLink } from "@/lib/epic-sessions"

const OAUTH_BASE = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth"

export type EpicAuthLinkResponse = {
  verification_uri_complete?: string
  device_code?: string
  user_code?: string
  expires_in?: number
}

export class EpicAuthLinkError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function createEpicAuthLink(orderId: number): Promise<EpicAuthLinkResponse> {
  const basicToken = process.env.EPIC_BASIC_TOKEN
  if (!basicToken) throw new EpicAuthLinkError("Epic authentication is not configured", 500)

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
    throw new EpicAuthLinkError("Epic client authentication failed", 502)
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
  const deviceData = await deviceResponse.json() as EpicAuthLinkResponse
  if (!deviceResponse.ok || !deviceData.verification_uri_complete || !deviceData.device_code) {
    throw new EpicAuthLinkError("Epic device authorization failed", 502)
  }

  const expiresIn = Math.min(Math.max(Number(deviceData.expires_in) || 300, 1), 300)
  await saveEpicAuthLink(orderId, deviceData.verification_uri_complete, expiresIn, deviceData.user_code)
  return { ...deviceData, expires_in: expiresIn }
}
