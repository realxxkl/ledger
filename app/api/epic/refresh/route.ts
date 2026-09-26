import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { getEpicSession } from "@/lib/epic-sessions"
import { refreshEpicSession } from "@/lib/epic-refresh"

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { orderId } = await request.json()
    if (!Number.isInteger(Number(orderId))) return NextResponse.json({ error: "Missing order ID" }, { status: 400 })
    const account = await getEpicSession(Number(orderId))
    if (!account?.refreshToken) return NextResponse.json({ error: "No Epic refresh token is stored for this order" }, { status: 404 })

    const refreshed = await refreshEpicSession(Number(orderId), account.refreshToken)
    return NextResponse.json({ ok: true, expiresIn: refreshed.expiresIn })
  } catch (error) {
    console.error("[v0] Epic refresh failed:", error)
    return NextResponse.json({ error: "Epic refresh token was rejected; re-authentication is required" }, { status: 409 })
  }
}
