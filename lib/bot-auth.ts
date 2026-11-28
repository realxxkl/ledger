import crypto from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"

function timingSafeStringEqual(a: string, b: string): boolean {
  const digestA = crypto.createHash("sha256").update(a).digest()
  const digestB = crypto.createHash("sha256").update(b).digest()
  return crypto.timingSafeEqual(digestA, digestB)
}

export function isValidBotToken(request: NextRequest): boolean {
  const configuredKey = process.env.BOT_API_KEY?.trim()
  if (!configuredKey) return false

  const authHeader = request.headers.get("authorization")
  if (!authHeader) return false

  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) return false

  const providedToken = match[1].trim()
  if (!providedToken) return false

  return timingSafeStringEqual(providedToken, configuredKey)
}

export function requireBotAuth(request: NextRequest): NextResponse | null {
  const configuredKey = process.env.BOT_API_KEY?.trim()
  if (!configuredKey) {
    return NextResponse.json(
      { error: "BOT_API_KEY is not configured on the server" },
      { status: 500 },
    )
  }

  if (!isValidBotToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return null
}
