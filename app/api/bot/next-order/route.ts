import { type NextRequest, NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { ensureBotSchema } from "@/lib/db/ensure-bot-schema"
import { requireBotAuth } from "@/lib/bot-auth"
import { parseVbucksAmount } from "@/lib/bot-status"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ClaimedOrderRow = {
  id: number
  service: string
  epic_username: string | null
  vbucks_amount: number | null
  pack_combination: unknown
  card_last4: string | null
  game_login_link: string | null
}

export async function GET(request: NextRequest) {
  const authError = requireBotAuth(request)
  if (authError) return authError

  try {
    await ensureBotSchema()
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
        return NextResponse.json({
          locked: true,
          reason: settingsRow.bot_lock_reason ?? null,
          order: null,
        })
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

      const row = claimResult.rows[0]
      if (!row) {
        return NextResponse.json({ locked: false, order: null })
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
          epic_username: row.epic_username ?? null,
          vbucks_amount: vbucksAmount,
          pack_combination: packCombination,
          card_last4: row.card_last4 ?? null,
          game_login_link: row.game_login_link ?? null,
        },
      })
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
  } catch (err) {
    console.error("[Bot] GET /api/bot/next-order failed:", err)
    return NextResponse.json({ error: "Failed to claim next order" }, { status: 500 })
  }
}
