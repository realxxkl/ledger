import { NextRequest, NextResponse } from "next/server"

const EXCHANGE_URL = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth/exchange"

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json()
    if (!token) return NextResponse.json({ error: "Missing Epic token" }, { status: 400 })
    const response = await fetch(EXCHANGE_URL, {
      headers: { Authorization: `Bearer ${token}` },
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
