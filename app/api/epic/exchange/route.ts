import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { getEpicSession } from "@/lib/epic-sessions"

const EXCHANGE_URL = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth/exchange"

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { orderId } = await request.json()
    const account = await getEpicSession(Number(orderId))
    if (!account?.accessToken) return NextResponse.json({ error: "No authenticated Epic account for this order" }, { status: 404 })
    const response = await fetch(EXCHANGE_URL, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
      cache: "no-store",
    })
    const data = await response.json()
    if (!response.ok) return NextResponse.json({ error: "Epic token exchange failed" }, { status: 401 })
    return NextResponse.json({ code: data.code })
  } catch (error) {
    console.error("[v0] Epic token exchange failed:", error)
    return NextResponse.json({ error: "Unable to exchange Epic token" }, { status: 500 })
  }
}
