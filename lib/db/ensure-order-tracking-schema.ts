import { pool } from "@/lib/db"

let schemaSetup: Promise<void> | null = null

export async function ensureOrderTrackingSchema() {
  if (!schemaSetup) {
    schemaSetup = pool.query(`
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS external_order_id text;
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS source text;
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS buyer_username text;
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS vbucks_before integer;
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS vbucks_after integer;
      CREATE UNIQUE INDEX IF NOT EXISTS entries_external_order_id_unique ON entries (external_order_id);
    `).then(() => undefined).catch((error: unknown) => {
      schemaSetup = null
      throw error
    })
  }
  await schemaSetup
}
