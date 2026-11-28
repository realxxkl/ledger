import { pool } from "@/lib/db"
import { ensureBotSchema } from "@/lib/db/ensure-bot-schema"

let schemaSetup: Promise<void> | null = null

export async function ensureOrderTrackingSchema() {
  if (!schemaSetup) {
    schemaSetup = pool.query(`
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS external_order_id text;
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS source text;
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS buyer_username text;
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS chat_id text;
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS waiting_since text;
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS vbucks_before integer;
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS vbucks_after integer;
      CREATE UNIQUE INDEX IF NOT EXISTS entries_external_order_id_unique ON entries (external_order_id);
      CREATE TABLE IF NOT EXISTS playerok_session (
        id serial PRIMARY KEY,
        cookies text NOT NULL,
        orders_query text,
        orders_variables text,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE playerok_session ADD COLUMN IF NOT EXISTS orders_query text;
      ALTER TABLE playerok_session ADD COLUMN IF NOT EXISTS orders_variables text;
      ALTER TABLE epic_order_sessions ADD COLUMN IF NOT EXISTS device_auth_id text;
      ALTER TABLE epic_order_sessions ADD COLUMN IF NOT EXISTS device_auth_secret text;
      UPDATE entries
      SET waiting_since = date
      WHERE waiting_since IS NULL
        AND (u7buy_order_id IS NOT NULL OR external_order_id IS NOT NULL);
    `).then(() => undefined).catch((error: unknown) => {
      schemaSetup = null
      throw error
    })
  }
  await schemaSetup
  await ensureBotSchema()
}
