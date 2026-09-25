import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/lib/auth"

const PUBLIC_PATHS = ["/sign-in", "/setup", "/api/auth", "/api/webhooks/u7buy"]

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next()
  }

  const session = await auth.api.getSession({ headers: request.headers })
  if (session?.user) return NextResponse.next()

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return NextResponse.redirect(new URL("/sign-in", request.url))
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
