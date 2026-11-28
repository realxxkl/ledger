import { pool } from "@/lib/db"

let botSchemaSetup: Promise<void> | null = null

export async function ensureBotSchema() {
  if (!botSchemaSetup) {
    botSchemaSetup = pool.query(`
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS epic_username text;
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS vbucks_amount integer;
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS pack_combination jsonb;
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS card_last4 text;
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS game_login_link text;
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS proof_image_url text;
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS error_image_url text;
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS error_reason text;
      CREATE INDEX IF NOT EXISTS entries_bot_queue_idx
        ON entries (created_at ASC, id ASC)
        WHERE order_status = 'READY_FOR_TOPUP';
      CREATE TABLE IF NOT EXISTS bot_settings (
        id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        bot_queue_locked boolean NOT NULL DEFAULT false,
        bot_lock_reason text,
        bot_lock_error_image_url text,
        bot_lock_order_id integer,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS bot_lock_error_image_url text;
      ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS bot_lock_order_id integer;
      INSERT INTO bot_settings (id, bot_queue_locked)
      VALUES (1, false)
      ON CONFLICT (id) DO NOTHING;
      CREATE TABLE IF NOT EXISTS bot_media (
        id text PRIMARY KEY,
        order_id integer REFERENCES entries(id) ON DELETE SET NULL,
        kind text NOT NULL,
        mime_type text NOT NULL,
        data bytea NOT NULL,
        size_bytes integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `).then(() => undefined).catch((error: unknown) => {
      botSchemaSetup = null
      throw error
    })
  }
  await botSchemaSetup
}
