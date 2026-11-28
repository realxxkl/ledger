import { boolean, customType, integer, jsonb, pgTable, serial, text, numeric, timestamp, uniqueIndex } from "drizzle-orm/pg-core"

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea"
  },
})

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  ownerSlot: boolean("owner_slot").notNull().default(true).unique(),
})

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
})

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  issuer: text("issuer").notNull().default("credential"),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const epicOrderSessions = pgTable("epic_order_sessions", {
  id: text("id").primaryKey(),
  orderId: integer("order_id").notNull().unique(),
  accountId: text("account_id"),
  displayName: text("display_name"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at"),
  deviceAuthId: text("device_auth_id"),
  deviceAuthSecret: text("device_auth_secret"),
  authLink: text("auth_link"),
  authLinkExpiresAt: timestamp("auth_link_expires_at"),
  authUserCode: text("auth_user_code"),
  refreshLockId: text("refresh_lock_id"),
  refreshLockUntil: timestamp("refresh_lock_until"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const entries = pgTable("entries", {
  id: serial("id").primaryKey(),
  service: text("service").notNull(),
  platform: text("platform").notNull(),
  date: text("date").notNull(),
  earned: numeric("earned").notNull().default("0"),
  feePercent: numeric("fee_percent").notNull().default("0"),
  feeAmt: numeric("fee_amt").notNull().default("0"),
  paid: numeric("paid").notNull().default("0"),
  profit: numeric("profit").notNull().default("0"),
  exchangeRate: numeric("exchange_rate"),
  originalCurrency: text("original_currency"),
  orderStatus: text("order_status"),
  u7buyOrderId: text("u7buy_order_id"),
  orderAmount: numeric("order_amount").notNull().default("0"),
  orderCost: numeric("order_cost").notNull().default("0"),
  orderFee: numeric("order_fee").notNull().default("0"),
  externalOrderId: text("external_order_id"),
  source: text("source"),
  buyerUsername: text("buyer_username"),
  chatId: text("chat_id"),
  waitingSince: text("waiting_since"),
  vbucksBefore: integer("vbucks_before"),
  vbucksAfter: integer("vbucks_after"),
  epicUsername: text("epic_username"),
  vbucksAmount: integer("vbucks_amount"),
  packCombination: jsonb("pack_combination").$type<number[]>(),
  cardLast4: text("card_last4"),
  gameLoginLink: text("game_login_link"),
  proofImageUrl: text("proof_image_url"),
  errorImageUrl: text("error_image_url"),
  errorReason: text("error_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  externalOrderIdUnique: uniqueIndex("entries_external_order_id_unique").on(table.externalOrderId),
}))

export const withdrawals = pgTable("withdrawals", {
  id: serial("id").primaryKey(),
  platform: text("platform").notNull(),
  date: text("date").notNull(),
  amount: numeric("amount").notNull().default("0"),
  fee: numeric("fee").notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const feeConfig = pgTable("fee_config", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  percent: numeric("percent").notNull().default("0"),
  flat: numeric("flat").notNull().default("0"),
})

export const presets = pgTable("presets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  cost: numeric("cost").notNull().default("0"),
})

export const offers = pgTable("offers", {
  id: serial("id").primaryKey(),
  externalOfferId: text("external_offer_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  rawPrice: numeric("raw_price", { precision: 12, scale: 2 }).notNull(),
  categoryId: text("category_id").notNull(),
  gameId: text("game_id").notNull(),
  status: text("status").notNull().default("APPROVED"),
  keepInSale: boolean("keep_in_sale").notNull().default(true),
  onSale: boolean("on_sale").notNull().default(true),
  syncStatus: text("sync_status").notNull().default("SYNCED"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  externalOfferIdUnique: uniqueIndex("offers_external_offer_id_unique").on(table.externalOfferId),
}))

export const playerokSession = pgTable("playerok_session", {
  id: serial("id").primaryKey(),
  cookies: text("cookies").notNull(),
  ordersQuery: text("orders_query"),
  ordersVariables: text("orders_variables"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const botSettings = pgTable("bot_settings", {
  id: integer("id").primaryKey().default(1),
  botQueueLocked: boolean("bot_queue_locked").notNull().default(false),
  botLockReason: text("bot_lock_reason"),
  botLockErrorImageUrl: text("bot_lock_error_image_url"),
  botLockOrderId: integer("bot_lock_order_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const botMedia = pgTable("bot_media", {
  id: text("id").primaryKey(),
  orderId: integer("order_id").references(() => entries.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  mimeType: text("mime_type").notNull(),
  data: bytea("data").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
