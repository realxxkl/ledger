import { betterAuth } from "better-auth"
import { pool } from "@/lib/db"

function toOrigin(value?: string) {
  if (!value) return undefined
  const url = value.startsWith("http") ? value : `https://${value}`
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

const baseURL =
  toOrigin(process.env.BETTER_AUTH_URL) ??
  toOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
  toOrigin(process.env.VERCEL_URL) ??
  toOrigin(process.env.V0_RUNTIME_URL)

const trustedOrigins = [
  ...(process.env.NODE_ENV === "development"
    ? [
        "http://localhost:3000",
        toOrigin(process.env.V0_RUNTIME_URL),
        toOrigin(process.env.V0_DEV_APP_URL),
        toOrigin(process.env.V0_BUILD_URL),
        toOrigin(process.env.V0_SANDBOX_URL),
      ]
    : [toOrigin(process.env.VERCEL_URL), toOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL)]),
].filter((origin): origin is string => Boolean(origin))

export const auth = betterAuth({
  database: pool,
  baseURL,
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
  },
  ...(process.env.NODE_ENV === "development"
    ? {
        advanced: {
          // Required by the cross-site v0 preview iframe.
          defaultCookieAttributes: {
            sameSite: "none" as const,
            secure: true,
          },
        },
      }
    : {}),
})
