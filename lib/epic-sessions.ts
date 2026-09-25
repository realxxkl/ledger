import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { epicOrderSessions } from "@/lib/db/schema"

export async function saveEpicSession(input: {
  orderId: number
  accountId: string
  displayName: string
  accessToken: string
  refreshToken?: string
  expiresIn?: number
}) {
  const now = new Date()
  await db
    .insert(epicOrderSessions)
    .values({
      id: crypto.randomUUID(),
      orderId: input.orderId,
      accountId: input.accountId,
      displayName: input.displayName,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken ?? null,
      expiresAt: input.expiresIn ? new Date(now.getTime() + input.expiresIn * 1000) : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: epicOrderSessions.orderId,
      set: {
        accountId: input.accountId,
        displayName: input.displayName,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken ?? null,
        expiresAt: input.expiresIn ? new Date(now.getTime() + input.expiresIn * 1000) : null,
        updatedAt: now,
      },
    })
}

export async function getEpicSession(orderId: number) {
  const rows = await db.select().from(epicOrderSessions).where(eq(epicOrderSessions.orderId, orderId)).limit(1)
  return rows[0] ?? null
}

export async function getEpicSessionSummary(orderId: number) {
  const session = await getEpicSession(orderId)
  if (!session) return null
  return {
    accountId: session.accountId,
    displayName: session.displayName,
    connected: Boolean(session.accessToken),
    expiresAt: session.expiresAt,
  }
}

export async function clearEpicSession(orderId: number) {
  await db.delete(epicOrderSessions).where(eq(epicOrderSessions.orderId, orderId))
}
