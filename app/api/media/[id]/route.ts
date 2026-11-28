import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { isValidBotToken } from "@/lib/bot-auth"
import { getBotMedia, mimeToExtension } from "@/lib/bot-media"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user && !isValidBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "Invalid media ID" }, { status: 400 })
    }

    const media = await getBotMedia(id)
    if (!media) {
      return NextResponse.json({ error: "Media not found" }, { status: 404 })
    }

    const headers: Record<string, string> = {
      "Content-Type": media.mimeType,
      "Content-Length": String(media.sizeBytes),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=31536000, immutable",
    }

    if (request.nextUrl.searchParams.get("download") === "1") {
      const ext = mimeToExtension(media.mimeType)
      const orderTag = media.orderId !== null ? `order-${media.orderId}` : media.id
      headers["Content-Disposition"] = `attachment; filename="${orderTag}-${media.kind}.${ext}"`
    }

    return new NextResponse(new Uint8Array(media.data), {
      status: 200,
      headers,
    })
  } catch (err) {
    console.error("[Bot] GET /api/media/[id] failed:", err)
    return NextResponse.json({ error: "Failed to load media" }, { status: 500 })
  }
}
