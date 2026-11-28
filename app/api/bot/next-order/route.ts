import { type NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { db, pool } from "@/lib/db"
import { entries } from "@/lib/db/schema"
import { ensureOrderTrackingSchema } from "@/lib/db/ensure-order-tracking-schema"
import { requireBotAuth } from "@/lib/bot-auth"
import { isValidGameLoginLink, parseVbucksAmount } from "@/lib/bot-status"
import { getEpicSession, hasUsableEpicSession } from "@/lib/epic-sessions"
import { EpicExchangeError, generateFreshFortniteLoginLink } from "@/lib/epic-exchange"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_CLAIM_ATTEMPTS = 10

type ClaimedOrderRow = {
  id: number
  service: string
  epic_username: string | null
  vbucks_amount: number | null
  pack_combination: unknown
  card_last4: string | null
  game_login_link: string | null
}

type ClaimStepResult =
  | { locked: true; reason: string | null }
  | { locked: false; row: ClaimedOrderRow | null }

async function claimNextReadyOrder(): Promise<ClaimStepResult> {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const settingsResult = await client.query<{
      bot_queue_locked: boolean
      bot_lock_reason: string | null
    }>(
      `SELECT bot_queue_locked, bot_lock_reason
       FROM bot_settings
       WHERE id = 1
       FOR UPDATE`,
    )

    const settingsRow = settingsResult.rows[0]
    if (settingsRow?.bot_queue_locked) {
      await client.query("COMMIT")
      return {
        locked: true,
        reason: settingsRow.bot_lock_reason ?? null,
      }
    }

    const claimResult = await client.query<ClaimedOrderRow>(
      `WITH next_order AS (
         SELECT id
         FROM entries
         WHERE order_status = 'READY_FOR_TOPUP'
         ORDER BY created_at ASC, id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE entries e
       SET order_status = 'BOT_PROCESSING'
       FROM next_order
       WHERE e.id = next_order.id
       RETURNING
         e.id,
         e.service,
         e.epic_username,
         e.vbucks_amount,
         e.pack_combination,
         e.card_last4,
         e.game_login_link`,
    )

    await client.query("COMMIT")
    return { locked: false, row: claimResult.rows[0] ?? null }
  } catch (err) {
    try {
      await client.query("ROLLBACK")
    } catch {
      // Ignore rollback failure after transaction error.
    }
    throw err
  } finally {
    client.release()
  }
}

export async function GET(request: NextRequest) {
  const authError = requireBotAuth(request)
  if (authError) return authError

  try {
    await ensureOrderTrackingSchema()

    for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
      const claim = await claimNextReadyOrder()
      if (claim.locked) {
        return NextResponse.json({
          locked: true,
          reason: claim.reason,
          order: null,
        })
      }

      const row = claim.row
      if (!row) {
        return NextResponse.json({ locked: false, order: null })
      }

      const epicSession = await getEpicSession(row.id)
      let gameLoginLink = row.game_login_link ?? null

      if (hasUsableEpicSession(epicSession)) {
        try {
          const generated = await generateFreshFortniteLoginLink(row.id)
          if (generated.orderStatus !== "BOT_PROCESSING") {
            console.warn(
              `[Bot] Order ${row.id} left BOT_PROCESSING during link generation (now ${generated.orderStatus ?? "null"}); skipping`,
            )
            continue
          }
          gameLoginLink = generated.link
        } catch (err) {
          if (err instanceof EpicExchangeError && err.options.requiresReauthentication) {
            console.warn(
              `[Bot] Order ${row.id}: auto login link failed (re-auth required), returning to In Progress:`,
              err.message,
            )
            await db
              .update(entries)
              .set({
                orderStatus: "In Progress",
                errorReason: `Auto login link failed: ${err.message}`,
              })
              .where(and(eq(entries.id, row.id), eq(entries.orderStatus, "BOT_PROCESSING")))
            continue
          }

          console.error(`[Bot] Order ${row.id}: transient failure generating auto login link:`, err)
          await db
            .update(entries)
            .set({ orderStatus: "READY_FOR_TOPUP" })
            .where(and(eq(entries.id, row.id), eq(entries.orderStatus, "BOT_PROCESSING")))
          return NextResponse.json(
            {
              error: err instanceof Error ? err.message : "Failed to generate fresh Fortnite login link",
            },
            { status: 502 },
          )
        }
      } else if (!gameLoginLink || !isValidGameLoginLink(gameLoginLink)) {
        console.warn(`[Bot] Order ${row.id}: missing game login link and no Epic session connected`)
        await db
          .update(entries)
          .set({
            orderStatus: "In Progress",
            errorReason: "Missing game login link and no Epic session connected",
          })
          .where(and(eq(entries.id, row.id), eq(entries.orderStatus, "BOT_PROCESSING")))
        continue
      }

      const vbucksAmount =
        row.vbucks_amount !== null && row.vbucks_amount !== undefined
          ? Number(row.vbucks_amount)
          : (parseVbucksAmount(row.service) ?? 0)
      const rawPack = row.pack_combination
      const packCombination =
        Array.isArray(rawPack) && rawPack.length > 0
          ? rawPack.map((n) => Number(n))
          : vbucksAmount > 0
            ? [vbucksAmount]
            : null

      return NextResponse.json({
        locked: false,
        order: {
          id: String(row.id),
          epic_username: row.epic_username ?? epicSession?.displayName ?? null,
          vbucks_amount: vbucksAmount,
          pack_combination: packCombination,
          card_last4: row.card_last4 ?? null,
          game_login_link: gameLoginLink,
        },
      })
    }

    return NextResponse.json({ locked: false, order: null })
  } catch (err) {
    console.error("[Bot] GET /api/bot/next-order failed:", err)
    return NextResponse.json({ error: "Failed to claim next order" }, { status: 500 })
  }
}
