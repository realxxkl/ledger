import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { createEpicAuthLink, EpicAuthLinkError } from "@/lib/epic-auth-link"

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { orderId } = await request.json()
    if (!Number.isInteger(Number(orderId))) return NextResponse.json({ error: "Missing order ID" }, { status: 400 })
    const deviceData = await createEpicAuthLink(Number(orderId))
    return NextResponse.json(deviceData)
  } catch (error) {
    console.error("[v0] Epic generate auth link failed:", error)
    if (error instanceof EpicAuthLinkError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "Unable to generate Epic auth link" }, { status: 500 })
  }
}
