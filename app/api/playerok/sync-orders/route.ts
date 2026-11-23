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

function findPageInfo(obj: any): { hasNextPage: boolean; cursor: string | null } | null {
  if (!obj || typeof obj !== "object") return null
  if (obj.pageInfo && typeof obj.pageInfo === "object") {
    const rows = obj.edges || obj.nodes || obj.items
    const lastEdge = Array.isArray(rows) && rows.length > 0 ? rows[rows.length - 1] : null
    const cursor = obj.pageInfo.endCursor || obj.pageInfo.nextCursor || obj.pageInfo.cursor || lastEdge?.cursor || null
    return {
      hasNextPage: Boolean(obj.pageInfo.hasNextPage || obj.pageInfo.hasMore),
      cursor: cursor ? String(cursor).trim() : null,
    }
  }
  for (const child of Object.values(obj)) {
    const found = findPageInfo(child)
    if (found) return found
  }
  return null
}

function setNextCursor(vars: Record<string, unknown>, cursor: string, queryStr = ""): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(vars))

  const header = queryStr.match(/\b(?:query|mutation|subscription)\b[\s\S]*?\(([^)]*)\)/)
  const declared = header
    ? Array.from(header[1].matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)\s*:/g), (m) => m[1])
    : []
  const topLevel = [...declared, ...Object.keys(next)].find(
    (name) => /after|cursor/i.test(name) && Object.hasOwn(next, name)
  )

  if (topLevel) {
    next[topLevel] = cursor
    return next
  }

  if (next.pagination && typeof next.pagination === "object" && !Array.isArray(next.pagination)) {
    const p = next.pagination as Record<string, unknown>
    if ("cursor" in p) {
      p.cursor = cursor
    } else {
      p.after = cursor
    }
    return next
  }

  function findAndSet(target: any): boolean {
    if (!target || typeof target !== "object" || Array.isArray(target)) return false
    for (const key of Object.keys(target)) {
      if (/^(after|cursor)$/i.test(key)) {
        target[key] = cursor
        return true
      }
      if (findAndSet(target[key])) return true
    }
    return false
  }

  if (!findAndSet(next)) {
    next.after = cursor
  }

  return next
}

function extractOperationName(queryStr: string): string | null {
  const match = queryStr.match(/\b(?:query|mutation)\s+([A-Za-z0-9_]+)/i)
  return match ? match[1] : null
}

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
    const op = query ? extractOperationName(query) : null
    const isInvalid = !query ||
      op === "user" ||
      op === "profileLegacyUser" ||
      /user/i.test(op || "") ||
      /^\s*query\s+[a-zA-Z0-9_]*user\b/i.test(query)

    if (isInvalid) {
      return NextResponse.json(
        {
          error: "Sales query template not linked yet. On your Playerok Sales page, click between the tabs (e.g. 'Завершённые' and back to 'Активные'), click [Sync Cookies] in the extension widget, then retry.",
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

    const operationName = extractOperationName(cleanQuery)
    const requestHeaders: Record<string, string> = {
      "Accept": "*/*",
      "Content-Type": "application/json",
      "Cookie": cookieString,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "Origin": "https://playerok.com",
      "Referer": "https://playerok.com/",
      "apollo-require-preflight": "true",
      "apollographql-client-name": "web",
      "x-timezone-offset": String(new Date().getTimezoneOffset()),
    }
    if (operationName) {
      requestHeaders["x-gql-op"] = operationName
    }

    // 3. Extract deals
    const savedPresets = await db.select({ name: presets.name, cost: presets.cost }).from(presets)
    let accepted = 0
    let updated = 0
    let alreadyLogged = 0

    // Deep find deals in data
    const nodes: any[] = []
    const seenNodeIds = new Set<string>()
    function findDeals(val: any) {
      if (!val || typeof val !== "object") return
      if (Array.isArray(val)) {
        val.forEach(findDeals)
        return
      }

      const hasDealIndicators =
        val.id &&
        (val.__typename === "ItemDeal" ||
         val.__typename === "Deal" ||
         (val.status && (val.item || val.obtainingFields || val.transaction || val.user)))

      const isOut = !val.direction || String(val.direction).toUpperCase() === "OUT"

      if (hasDealIndicators && isOut) {
        const id = String(val.id).trim().toLowerCase()
        if (!seenNodeIds.has(id)) {
          seenNodeIds.add(id)
          nodes.push(val)
        }
        return
      }

      if (val.node && typeof val.node === "object" && val.node.id) {
        findDeals(val.node)
        return
      }

      Object.values(val).forEach(findDeals)
    }

    const graphqlUrl = "https://playerok.com/graphql"
    let currentVariables = { ...parsedVariables }
    let pageCount = 0
    const maxPages = 10
    const seenCursors = new Set<string>()
    let lastResponseData: any = null

    while (pageCount < maxPages) {
      pageCount++
      const response = await fetch(graphqlUrl, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          ...(operationName ? { operationName } : {}),
          query: cleanQuery,
          variables: currentVariables,
        }),
      })

      if (!response.ok) {
        if (pageCount === 1) {
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
        break
      }

      const data = await response.json()
      lastResponseData = data
      if (data.errors && data.errors.length > 0) {
        if (pageCount === 1) {
          const msg = data.errors.map((e: { message?: string }) => e.message).join("; ")
          return NextResponse.json({ error: `Playerok returned: ${msg}. Open your Playerok Sales page and click [Sync Cookies] in the extension to refresh the query template.` }, { status: 400 })
        }
        break
      }

      const prevCount = nodes.length
      findDeals(data?.data ?? data)

      const pageInfo = findPageInfo(data?.data ?? data)
      if (!pageInfo?.hasNextPage || !pageInfo.cursor || seenCursors.has(pageInfo.cursor)) {
        break
      }

      if (nodes.length === prevCount && pageCount > 1) {
        break
      }

      seenCursors.add(pageInfo.cursor)
      currentVariables = setNextCursor(currentVariables, pageInfo.cursor, cleanQuery)
      await new Promise((r) => setTimeout(r, 100))
    }

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

    const debugSnippet = JSON.stringify(lastResponseData || {}).slice(0, 160)

    return NextResponse.json({
      success: true,
      totalFound: nodes.length,
      accepted,
      updated,
      alreadyLogged,
      message: nodes.length > 0
        ? `Found ${nodes.length} order(s): ${accepted} new, ${updated} updated.`
        : `Found 0 order(s) (op: ${operationName || "none"}, data: ${debugSnippet})`,
    })
  } catch (error) {
    console.error("[Playerok Sync] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server order sync failed" },
      { status: 500 }
    )
  }
}
