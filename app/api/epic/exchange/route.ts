import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { createEpicExchangeCode, EpicExchangeError } from "@/lib/epic-exchange"

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const orderId = Number(body?.orderId)
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return NextResponse.json({ error: "Invalid order ID" }, { status: 400 })
    }

    const code = await createEpicExchangeCode(orderId)
    return NextResponse.json({ code })
  } catch (error) {
    if (error instanceof EpicExchangeError) {
      return NextResponse.json(
        {
          error: error.message,
          ...(error.options.requiresReauthentication !== undefined
            ? { requiresReauthentication: error.options.requiresReauthentication }
            : {}),
          ...(error.options.epicStatus !== undefined ? { epicStatus: error.options.epicStatus } : {}),
          ...(error.options.epicErrorCode !== undefined ? { epicErrorCode: error.options.epicErrorCode } : {}),
        },
        { status: error.status },
      )
    }
    console.error("[Epic] Token exchange route failed:", error)
    return NextResponse.json({ error: "Unable to exchange Epic token" }, { status: 500 })
  }
}
