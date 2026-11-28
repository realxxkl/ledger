export const BOT_ORDER_STATUSES = [
  "READY_FOR_TOPUP",
  "BOT_PROCESSING",
  "FULFILLED",
  "USERNAME_MISMATCH",
  "HOLD_ESCALATION",
] as const

export type BotOrderStatus = (typeof BOT_ORDER_STATUSES)[number]

export const BOT_ERROR_STATUSES = [
  "USERNAME_MISMATCH",
  "HOLD_ESCALATION",
] as const

export type BotErrorStatus = (typeof BOT_ERROR_STATUSES)[number]

const BOT_STATUS_SET = new Set<string>(BOT_ORDER_STATUSES)
const BOT_ERROR_STATUS_SET = new Set<string>(BOT_ERROR_STATUSES)
const COMPLETED_STATUS_SET = new Set(["completed", "delivered", "fulfilled"])
const TERMINAL_STATUS_SET = new Set(["completed", "delivered", "fulfilled", "refunded", "cancelled"])

export function isBotOrderStatus(status?: string | null): status is BotOrderStatus {
  if (!status) return false
  return BOT_STATUS_SET.has(status.trim())
}

export function isBotErrorStatus(status?: string | null): status is BotErrorStatus {
  if (!status) return false
  return BOT_ERROR_STATUS_SET.has(status.trim())
}

export function isFulfilledOrCompletedStatus(status?: string | null): boolean {
  if (!status) return false
  return COMPLETED_STATUS_SET.has(status.trim().toLowerCase())
}

export function isTerminalOrderStatus(status?: string | null): boolean {
  if (!status) return false
  return TERMINAL_STATUS_SET.has(status.trim().toLowerCase())
}

export function parseVbucksAmount(service?: string | null): number | null {
  if (!service) return null
  const match = service.match(/(\d[\d,]*)\s*[- ]?\s*V[\s-]*Bucks\b/i)
  if (!match) return null
  const parsed = Number(match[1].replace(/,/g, ""))
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function isValidCardLast4(value: string): boolean {
  return /^\d{4}$/.test(value)
}

export function isValidGameLoginLink(value: string): boolean {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === "https:" || parsed.protocol === "http:"
  } catch {
    return false
  }
}

export function normalizePackCombination(
  input: unknown,
): { ok: true; value: number[] | null } | { ok: false; error: string } {
  if (input === null || input === undefined) {
    return { ok: true, value: null }
  }

  let rawItems: unknown[]
  if (typeof input === "string") {
    const trimmed = input.trim()
    if (!trimmed) {
      return { ok: true, value: null }
    }
    rawItems = trimmed.split(",").map((part) => part.trim())
    if (rawItems.some((part) => part === "")) {
      return { ok: false, error: "Pack combination contains an empty value" }
    }
  } else if (Array.isArray(input)) {
    if (input.length === 0) {
      return { ok: true, value: null }
    }
    rawItems = input
  } else {
    return { ok: false, error: "Pack combination must be an array of positive integers or comma-separated numbers" }
  }

  const parsed: number[] = []
  for (const item of rawItems) {
    if (typeof item === "string" && !/^\d+$/.test(item)) {
      return { ok: false, error: "Each pack tier must be a positive integer" }
    }
    const num = typeof item === "number" ? item : Number(item)
    if (!Number.isSafeInteger(num) || num <= 0) {
      return { ok: false, error: "Each pack tier must be a positive integer" }
    }
    parsed.push(num)
  }

  return { ok: true, value: parsed }
}

export function buildFortniteLoginLink(exchangeCode: string): string {
  return `https://www.epicgames.com/id/exchange?exchangeCode=${encodeURIComponent(exchangeCode)}&redirectUrl=https%3A%2F%2Fwww.epicgames.com%2Fid%2Flogin%3Fclient_id%3D3f69e56c7649492c8cc29f1af08a8a12%26response_type%3Dcode%26display%3Dpopup%2520guided`
}
