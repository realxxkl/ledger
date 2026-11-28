import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { entries } from "@/lib/db/schema"
import { buildFortniteLoginLink } from "@/lib/bot-status"
import { getEpicSession, hasUsableEpicSession } from "@/lib/epic-sessions"
import { EpicRefreshError, OAUTH_BASE, refreshEpicSession } from "@/lib/epic-refresh"

const EXCHANGE_URL = `${OAUTH_BASE}/exchange`

type EpicExchangeResponse = {
  code?: string
  error?: string
  errorMessage?: string
  errorCode?: string
}

export type EpicExchangeErrorOptions = {
  requiresReauthentication?: boolean
  epicStatus?: number
  epicErrorCode?: string
}

export class EpicExchangeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly options: EpicExchangeErrorOptions = {},
  ) {
    super(message)
    this.name = "EpicExchangeError"
  }
}

async function requestExchange(token: string) {
  let response: Response
  try {
    response = await fetch(EXCHANGE_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    })
  } catch (error) {
    throw new EpicExchangeError(
      error instanceof Error ? error.message : "Unable to reach Epic exchange service",
      502,
      { requiresReauthentication: false },
    )
  }

  const raw = await response.text()
  let data: EpicExchangeResponse = {}
  try {
    data = raw ? (JSON.parse(raw) as EpicExchangeResponse) : {}
  } catch {
    /* Epic may return non-JSON errors. */
  }
  return { response, data }
}

/**
 * Generates a fresh single-use Epic exchange code for an order with a saved Epic session,
 * refreshing the session proactively or on 401/403 rejection.
 */
export async function createEpicExchangeCode(orderId: number): Promise<string> {
  const account = await getEpicSession(orderId)
  if (!account || !hasUsableEpicSession(account)) {
    throw new EpicExchangeError("No authenticated Epic account for this order", 404)
  }

  let accessToken = account.accessToken ?? ""
  const hasRefreshCapability = Boolean(
    account.refreshToken || (account.deviceAuthId && account.deviceAuthSecret && account.accountId),
  )
  const shouldRefresh = Boolean(
    hasRefreshCapability &&
      (!accessToken || (account.expiresAt && account.expiresAt.getTime() <= Date.now() + 30_000)),
  )

  if (shouldRefresh) {
    try {
      const refreshed = await refreshEpicSession(orderId, { force: !accessToken })
      accessToken = refreshed.accessToken
    } catch (error) {
      const message = error instanceof Error ? error.message : "Epic session refresh failed"
      console.error(`[Epic] Order ${orderId}: proactive refresh failed`, message)
      if (!accessToken) {
        if (error instanceof EpicRefreshError && error.isAuthFailure) {
          throw new EpicExchangeError(
            "Epic session expired and could not be refreshed. Re-authenticate this order.",
            409,
            { requiresReauthentication: true },
          )
        }
        throw new EpicExchangeError(message, 502, { requiresReauthentication: false })
      }
    }
  }

  if (!accessToken) {
    throw new EpicExchangeError(
      "Epic access token is missing and cannot be refreshed. Re-authenticate this order.",
      409,
      { requiresReauthentication: true },
    )
  }

  let result = await requestExchange(accessToken)
  let tokenRejected = result.response.status === 401 || result.response.status === 403

  if (tokenRejected) {
    if (!hasRefreshCapability) {
      throw new EpicExchangeError(
        "Epic access token expired and no refresh capability is stored. Re-authenticate this order.",
        409,
        {
          requiresReauthentication: true,
          epicStatus: result.response.status,
          epicErrorCode: result.data.errorCode,
        },
      )
    }

    try {
      console.log(`[Epic] Order ${orderId}: access token rejected, refreshing session`)
      const refreshed = await refreshEpicSession(orderId, {
        force: true,
        rejectedAccessToken: accessToken,
      })
      accessToken = refreshed.accessToken
      result = await requestExchange(accessToken)
      tokenRejected = result.response.status === 401 || result.response.status === 403
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : "Epic session refresh failed"
      console.error(`[Epic] Order ${orderId}: refresh failed`, message)
      if (refreshError instanceof EpicRefreshError && refreshError.isAuthFailure) {
        throw new EpicExchangeError(
          "Epic access token expired and the saved refresh token could not be used. Re-authenticate this order.",
          409,
          { requiresReauthentication: true },
        )
      }
      throw new EpicExchangeError(message, 502, { requiresReauthentication: false })
    }
  }

  if (tokenRejected) {
    console.error(`[Epic] Exchange rejected after refresh for order ${orderId}`, {
      status: result.response.status,
      error: result.data.error,
      errorMessage: result.data.errorMessage,
      errorCode: result.data.errorCode,
    })
    throw new EpicExchangeError(
      result.data.errorMessage || result.data.error || "Epic exchange rejected after refresh. Re-authenticate this order.",
      409,
      {
        requiresReauthentication: true,
        epicStatus: result.response.status,
        epicErrorCode: result.data.errorCode,
      },
    )
  }

  if (!result.response.ok) {
    console.error(`[Epic] Exchange failed for order ${orderId}`, {
      status: result.response.status,
      error: result.data.error,
      errorMessage: result.data.errorMessage,
      errorCode: result.data.errorCode,
    })
    throw new EpicExchangeError(
      result.data.errorMessage || result.data.error || `Epic exchange failed with HTTP ${result.response.status}`,
      502,
      {
        requiresReauthentication: false,
        epicStatus: result.response.status,
        epicErrorCode: result.data.errorCode,
      },
    )
  }

  if (!result.data.code) {
    throw new EpicExchangeError("Epic did not return an exchange code", 502, {
      requiresReauthentication: false,
    })
  }

  return result.data.code
}

/**
 * Generates a fresh Fortnite login link for an order and persists it onto entries.game_login_link.
 */
export async function generateFreshFortniteLoginLink(
  orderId: number,
): Promise<{ link: string; orderStatus: string | null }> {
  const code = await createEpicExchangeCode(orderId)
  const link = buildFortniteLoginLink(code)
  const updated = await db
    .update(entries)
    .set({ gameLoginLink: link })
    .where(eq(entries.id, orderId))
    .returning({ orderStatus: entries.orderStatus })

  return {
    link,
    orderStatus: updated[0]?.orderStatus ?? null,
  }
}
