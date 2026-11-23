import { NextRequest, NextResponse } from "next/server"
import { desc, eq, or } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { ensureOrderTrackingSchema } from "@/lib/db/ensure-order-tracking-schema"
import { entries, playerokSession, presets } from "@/lib/db/schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const RUB_PER_USD = 88.5
const PLAYEROK_FEE_PERCENT = 4

function normalizeItemTitle(title: string) {
  const formatted = title.replace(/(\d[\d,]*)\s*[- ]?\s*V[\s-]*Bucks\b/gi, (_match, amount: string) => {
    return `${amount.replace(/,/g, "")} VBucks`
  })
  return formatted.replace(/fortnite\s*crew/i, "Fortnite Crew")
}

function getVbucksAmount(value: string) {
  const match = value.match(/(\d[\d,]*)\s*[- ]?\s*V[\s-]*Bucks\b/i)
  return match ? Number(match[1].replace(/,/g, "")) : null
}

function findMatchingPreset(itemTitle: string, savedPresets: Array<{ name: string; cost: string }>) {
  const isCrew = /fortnite\s*crew/i.test(itemTitle)
  const vbucksAmount = getVbucksAmount(itemTitle)
  const normalizedTitle = itemTitle.toLowerCase().replace(/[^a-z0-9]/g, "")

  return savedPresets.find((preset) => {
    const presetIsCrew = /fortnite\s*crew/i.test(preset.name)
    if (isCrew || presetIsCrew) return isCrew && presetIsCrew

    const presetVbucksAmount = getVbucksAmount(preset.name)
    if (vbucksAmount !== null || presetVbucksAmount !== null) {
      return vbucksAmount !== null && vbucksAmount === presetVbucksAmount
    }

    const normalizedPreset = preset.name.toLowerCase().replace(/[^a-z0-9]/g, "")
    return normalizedPreset.length > 0 && normalizedTitle.includes(normalizedPreset)
  })
}

function getPresetCost(preset?: { cost: string }) {
  if (!preset) return "0"
  const parsed = Number(preset.cost)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed.toFixed(2) : "0"
}

const DEFAULT_DEALS_QUERY = `
  query getProfileSales($after: String) {
    deals(filter: { direction: OUT }, pagination: { first: 50, after: $after }) {
      edges {
        node {
          id
          direction
          status
          createdAt
          item {
            id
            name
            price
            rawPrice
          }
          user {
            id
            username
          }
          chat {
            id
          }
          transaction {
            id
            value
            createdAt
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

function deduplicateGraphQLFragments(queryStr: string): string {
  let inString = false
  let stringChar = ""
  let depth = 0
  let blockStart = 0
  const blocks: string[] = []

  for (let i = 0; i < queryStr.length; i++) {
    const ch = queryStr[i]
    if (inString) {
      if (ch === "\\") {
        i++
      } else if (ch === stringChar) {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      stringChar = ch
      continue
    }

    if (ch === "#") {
      while (i < queryStr.length && queryStr[i] !== "\n") i++
      continue
    }

    if (ch === "{") {
      depth++
    } else if (ch === "}") {
      depth--
      if (depth === 0) {
        const block = queryStr.slice(blockStart, i + 1).trim()
        blocks.push(block)
        blockStart = i + 1
      }
    }
  }

  if (blockStart < queryStr.length) {
    const remainder = queryStr.slice(blockStart).trim()
    if (remainder) blocks.push(remainder)
  }

  const seenFragments = new Set<string>()
  const finalBlocks: string[] = []

  for (const block of blocks) {
    const fragMatch = block.match(/^fragment\s+([A-Za-z0-9_]+)\s+on\b/i)
    if (fragMatch) {
      const fragName = fragMatch[1]
      if (seenFragments.has(fragName)) {
        continue
      }
      seenFragments.add(fragName)
    }
    finalBlocks.push(block)
  }

  return finalBlocks.join("\n\n")
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    const webhookSecret = request.headers.get("x-webhook-secret")
    const isWebhookAuthorized = Boolean(
      webhookSecret &&
      process.env.WEBHOOK_SECRET &&
      webhookSecret === process.env.WEBHOOK_SECRET
    )

    if (!session?.user && !isWebhookAuthorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    await ensureOrderTrackingSchema()

    // 1. Get stored cookies
    const sessionRows = await db.select()
      .from(playerokSession)
      .orderBy(desc(playerokSession.updatedAt))
      .limit(1)

    const cookieString = sessionRows[0]?.cookies
    if (!cookieString) {
      return NextResponse.json(
        { error: "No Playerok cookies saved on Ledger yet. Click [Sync Cookies] in the extension widget first." },
        { status: 400 }
      )
    }

    // 2. Fetch orders from Playerok GraphQL
    const query = sessionRows[0]?.ordersQuery
    if (!query) {
      return NextResponse.json(
        {
          error: "Order query schema not saved yet. Please open your Playerok Sales page (Мои продажи) in Chrome, then click [Sync Cookies] in the extension widget.",
        },
        { status: 400 }
      )
    }

    const cleanQuery = deduplicateGraphQLFragments(query)

    let parsedVariables: Record<string, unknown> = {}
    if (sessionRows[0]?.ordersVariables) {
      try {
        parsedVariables = JSON.parse(sessionRows[0].ordersVariables)
      } catch {}
    }

    const graphqlUrl = "https://playerok.com/graphql"
    const response = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        "Accept": "*/*",
        "Content-Type": "application/json",
        "Cookie": cookieString,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Origin": "https://playerok.com",
        "Referer": "https://playerok.com/",
        "apollo-require-preflight": "true",
        "apollographql-client-name": "web",
      },
      body: JSON.stringify({
        query: cleanQuery,
        variables: parsedVariables,
      }),
    })

    if (!response.ok) {
      let errDetail = `HTTP ${response.status}`
      if (response.status === 403) {
        errDetail = "Cloudflare blocked the server request (403) or cookies expired. Click [Sync Cookies] in the extension."
      } else {
        try {
          const text = await response.text()
          errDetail = text.slice(0, 200)
        } catch {}
      }
      return NextResponse.json({ error: errDetail }, { status: response.status >= 500 ? 502 : 400 })
    }

    const data = await response.json()
    if (data.errors && data.errors.length > 0) {
      const msg = data.errors.map((e: { message?: string }) => e.message).join("; ")
      return NextResponse.json({ error: `Playerok returned: ${msg}. Open your Playerok Sales page and click [Sync Cookies] in the extension to refresh the query template.` }, { status: 400 })
    }

    // 3. Extract deals
    const savedPresets = await db.select({ name: presets.name, cost: presets.cost }).from(presets)
    let accepted = 0
    let updated = 0
    let alreadyLogged = 0

    // Deep find deals in data
    const nodes: any[] = []
    const seenNodeIds = new Set<string>()
    function findDeals(obj: any) {
      if (!obj || typeof obj !== "object") return
      if (Array.isArray(obj)) {
        obj.forEach(findDeals)
        return
      }
      const isDeal = obj.id && (obj.__typename === "ItemDeal" || obj.status)
      const isOut = !obj.direction || String(obj.direction).toUpperCase() === "OUT"
      if (isDeal && isOut) {
        const id = String(obj.id).trim().toLowerCase()
        if (!seenNodeIds.has(id)) {
          seenNodeIds.add(id)
          nodes.push(obj)
        }
        return
      }
      const isNodeDeal = obj.node?.id && (obj.node.__typename === "ItemDeal" || obj.node.status)
      const isNodeOut = !obj.node?.direction || String(obj.node.direction).toUpperCase() === "OUT"
      if (isNodeDeal && isNodeOut) {
        const id = String(obj.node.id).trim().toLowerCase()
        if (!seenNodeIds.has(id)) {
          seenNodeIds.add(id)
          nodes.push(obj.node)
        }
        return
      }
      Object.values(obj).forEach(findDeals)
    }
    findDeals(data?.data ?? data)

    for (const deal of nodes) {
      const orderId = String(deal.id || "").trim()
      if (!orderId) continue

      const itemTitle = deal.item?.name || deal.item?.title || "Playerok Order"
      const buyerUsername = deal.user?.username || null
      const chatId = deal.chat?.id ? String(deal.chat.id).trim() : (deal.chatId ? String(deal.chatId).trim() : null)
      const status = String(deal.status || "").toUpperCase()
      const isRefunded = status === "REFUNDED" || status === "REFUND"
      const rawPrice = Number(deal.item?.price ?? deal.item?.rawPrice ?? 0)
      const transactionValue = deal.transaction?.value !== undefined && deal.transaction?.value !== null
        ? Number(deal.transaction.value)
        : Number((rawPrice * 0.9).toFixed(2))

      const price = Number.isFinite(transactionValue) ? transactionValue : 0
      const createdAt = deal.createdAt || deal.transaction?.createdAt || new Date().toISOString()
      const timestamp = new Date(createdAt)

      const ledgerAmount = (price / RUB_PER_USD).toFixed(2)
      const matchedPreset = findMatchingPreset(normalizeItemTitle(itemTitle), savedPresets)
      const orderCost = getPresetCost(matchedPreset)
      const orderFee = (Number(ledgerAmount) * PLAYEROK_FEE_PERCENT / 100).toFixed(2)

      const existing = await db.select({
        id: entries.id,
        orderStatus: entries.orderStatus,
        buyerUsername: entries.buyerUsername,
        chatId: entries.chatId,
        waitingSince: entries.waitingSince,
      })
        .from(entries)
        .where(
          or(
            eq(entries.externalOrderId, orderId),
            eq(entries.externalOrderId, orderId.toLowerCase())
          )
        )
        .limit(1)

      const entryId = existing[0]?.id
      if (!entryId) {
        // Insert new entry
        await db.insert(entries).values({
          service: normalizeItemTitle(itemTitle),
          platform: "PO",
          date: timestamp.toISOString().slice(0, 10),
          earned: "0",
          feePercent: String(PLAYEROK_FEE_PERCENT),
          feeAmt: "0",
          paid: "0",
          profit: "0",
          orderStatus: isRefunded ? "Refunded" : "New Order Received",
          orderAmount: ledgerAmount,
          orderCost,
          orderFee,
          externalOrderId: orderId,
          source: "playerok",
          buyerUsername,
          chatId,
          waitingSince: timestamp.toISOString(),
          originalCurrency: "RUB",
          exchangeRate: String(RUB_PER_USD),
        }).onConflictDoNothing({ target: entries.externalOrderId })
        accepted += 1
      } else {
        // Update existing entry with fresh status/chatId
        const existingStatus = existing[0]?.orderStatus || ""
        const isCompleted = existingStatus.toLowerCase() === "completed" || existingStatus.toLowerCase() === "delivered"
        const nextStatus = isRefunded ? "Refunded" : (isCompleted ? existingStatus : "New Order Received")

        await db.update(entries).set({
          orderStatus: nextStatus,
          buyerUsername: buyerUsername || existing[0]?.buyerUsername || null,
          chatId: chatId || existing[0]?.chatId || null,
        }).where(eq(entries.id, entryId))
        alreadyLogged += 1
        updated += 1
      }
    }

    return NextResponse.json({
      success: true,
      totalFound: nodes.length,
      accepted,
      updated,
      alreadyLogged,
      message: `Found ${nodes.length} order(s): ${accepted} new, ${updated} updated.`,
    })
  } catch (error) {
    console.error("[Playerok Sync] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server order sync failed" },
      { status: 500 }
    )
  }
}
