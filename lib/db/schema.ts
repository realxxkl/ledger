import { pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core"

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
