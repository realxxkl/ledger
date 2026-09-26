import { boolean, integer, pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core"

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
  authLink: text("auth_link"),
  authLinkExpiresAt: timestamp("auth_link_expires_at"),
  authUserCode: text("auth_user_code"),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

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
  currency: text("currency").notNull().default("usd"),
})
