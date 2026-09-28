import { eq, sql } from "drizzle-orm"
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
        refreshToken: input.refreshToken ?? undefined,
        expiresAt: input.expiresIn ? new Date(now.getTime() + input.expiresIn * 1000) : undefined,
        updatedAt: now,
      },
    })
}

export async function acquireEpicRefreshLease(orderId: number, leaseId: string, leaseMs = 30_000) {
  const now = new Date()
  const until = new Date(now.getTime() + leaseMs)
  const rows = await db.update(epicOrderSessions).set({ refreshLockId: leaseId, refreshLockUntil: until, updatedAt: now })
    .where(sql`order_id = ${orderId} AND (refresh_lock_until IS NULL OR refresh_lock_until < ${now})`)
    .returning({ refreshToken: epicOrderSessions.refreshToken, accessToken: epicOrderSessions.accessToken, expiresAt: epicOrderSessions.expiresAt })
  return rows[0] ?? null
}

export async function releaseEpicRefreshLease(orderId: number, leaseId: string) {
  await db.update(epicOrderSessions).set({ refreshLockId: null, refreshLockUntil: null, updatedAt: new Date() })
    .where(sql`order_id = ${orderId} AND refresh_lock_id = ${leaseId}`)
}

export async function updateEpicSessionTokens(orderId: number, input: {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
}) {
  const now = new Date()
  await db.update(epicOrderSessions).set({
    accessToken: input.accessToken,
    refreshToken: input.refreshToken ?? undefined,
    expiresAt: input.expiresIn ? new Date(now.getTime() + input.expiresIn * 1000) : undefined,
    updatedAt: now,
  }).where(eq(epicOrderSessions.orderId, orderId))
}

export async function saveEpicAuthLink(orderId: number, authLink: string, expiresIn?: number, userCode?: string) {
  const now = new Date()
  const authLinkExpiresAt = expiresIn ? new Date(now.getTime() + expiresIn * 1000) : null
  await db
    .insert(epicOrderSessions)
    .values({
      id: crypto.randomUUID(),
      orderId,
      authLink,
      authLinkExpiresAt,
      authUserCode: userCode,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: epicOrderSessions.orderId,
      set: { authLink, authLinkExpiresAt, authUserCode: userCode, updatedAt: now },
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
