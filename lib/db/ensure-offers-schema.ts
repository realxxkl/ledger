import { pool } from "@/lib/db"

let schemaSetup: Promise<void> | null = null

export async function ensureOffersSchema() {
  if (!schemaSetup) {
    schemaSetup = pool.query(`
      CREATE TABLE IF NOT EXISTS offers (
        id serial PRIMARY KEY,
        external_offer_id text NOT NULL,
        title text NOT NULL,
        description text,
        image_url text,
        price numeric(12, 2) NOT NULL,
        raw_price numeric(12, 2) NOT NULL,
        category_id text NOT NULL,
        game_id text NOT NULL,
        status text NOT NULL DEFAULT 'APPROVED',
        keep_in_sale boolean NOT NULL DEFAULT true,
        on_sale boolean NOT NULL DEFAULT true,
        sync_status text NOT NULL DEFAULT 'SYNCED',
        last_synced_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE offers ADD COLUMN IF NOT EXISTS image_url text;
      ALTER TABLE offers ADD COLUMN IF NOT EXISTS on_sale boolean NOT NULL DEFAULT true;
      CREATE UNIQUE INDEX IF NOT EXISTS offers_external_offer_id_unique
        ON offers (external_offer_id);
    `).then(() => undefined).catch((error: unknown) => {
      schemaSetup = null
      throw error
    })
  }
  await schemaSetup
}
