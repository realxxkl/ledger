import { toNextJsHandler } from "better-auth/next-js"
import { auth } from "@/lib/auth"
import { pool } from "@/lib/db"

const handlers = toNextJsHandler(auth)

export const GET = handlers.GET

export async function POST(request: Request) {
  if (new URL(request.url).pathname.endsWith("/sign-up/email")) {
    const result = await pool.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM public."user") AS exists',
    )
    if (result.rows[0]?.exists) {
      return Response.json({ message: "Owner setup is already complete." }, { status: 403 })
    }
  }

  return handlers.POST(request)
}
