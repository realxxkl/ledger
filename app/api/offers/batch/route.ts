import { NextResponse, type NextRequest } from "next/server"
import { desc, eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { ensureOffersSchema } from "@/lib/db/ensure-offers-schema"
import { offers } from "@/lib/db/schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 1_000_000
const MAX_BATCH_SIZE = 100
const OFFER_STATUSES = ["APPROVED", "PENDING", "PAUSED", "DELETED"] as const
const SYNC_STATUSES = ["SYNCED", "PENDING_SYNC", "ERROR"] as const

type OfferStatus = (typeof OFFER_STATUSES)[number]
type SyncStatus = (typeof SYNC_STATUSES)[number]

type UpsertOperation = {
  action: "upsert"
  offer: {
    externalOfferId: string
    title: string
    description: string | null
    price: number
    rawPrice: number
    categoryId: string
    gameId: string
    status: OfferStatus
    keepInSale: boolean
    syncStatus: SyncStatus
  }
}

type RemoveOperation = {
  action: "remove"
  externalOfferId: string
}

type BatchOperation = UpsertOperation | RemoveOperation

type ValidationResult =
  | { operations: BatchOperation[]; error?: never }
  | { operations?: never; error: string }

type BatchItemResult = {
  action: "upsert" | "remove"
  externalOfferId: string
  result: "upserted" | "removed" | "not_found"
  id?: number
}

type BatchSummary = {
  upserted: number
  removed: number
  notFound: number
}

type BatchResponse = {
  success: true
  requestId: string
  appliedAt: string
  summary: BatchSummary
  results: BatchItemResult[]
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID()

  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 })
    }

    await ensureOffersSchema()
    const results = await db.select({
      id: offers.id,
      externalOfferId: offers.externalOfferId,
      title: offers.title,
      description: offers.description,
      price: offers.price,
      rawPrice: offers.rawPrice,
      categoryId: offers.categoryId,
      gameId: offers.gameId,
      status: offers.status,
      keepInSale: offers.keepInSale,
      syncStatus: offers.syncStatus,
      lastSyncedAt: offers.lastSyncedAt,
      updatedAt: offers.updatedAt,
    }).from(offers).orderBy(desc(offers.updatedAt), desc(offers.id))

    return NextResponse.json({ offers: results })
  } catch (error) {
    console.error(JSON.stringify({
      event: "offers.list.failed",
      requestId,
      error: error instanceof Error ? error.message : "Unknown error",
    }))
    return NextResponse.json({ error: "Offers could not be loaded.", requestId }, { status: 500 })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function requiredText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  return text.length > 0 && text.length <= maxLength ? text : null
}

function isOfferStatus(value: unknown): value is OfferStatus {
  return typeof value === "string" && OFFER_STATUSES.some((status) => status === value)
}

function isSyncStatus(value: unknown): value is SyncStatus {
  return typeof value === "string" && SYNC_STATUSES.some((status) => status === value)
}

function validPrice(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 9_999_999_999.99 &&
    Math.abs(value * 100 - Math.round(value * 100)) < 0.000001
  )
}

function validateBatch(body: unknown): ValidationResult {
  if (!isRecord(body) || !hasOnlyKeys(body, ["operations"]) || !Array.isArray(body.operations)) {
    return { error: "Request body must contain only an operations array." }
  }
  if (body.operations.length === 0 || body.operations.length > MAX_BATCH_SIZE) {
    return { error: `operations must contain between 1 and ${MAX_BATCH_SIZE} items.` }
  }

  const operations: BatchOperation[] = []
  const seenExternalIds = new Set<string>()

  for (let index = 0; index < body.operations.length; index++) {
    const operation = body.operations[index]
    if (!isRecord(operation) || typeof operation.action !== "string") {
      return { error: `operations[${index}] must be an object with an action.` }
    }

    if (operation.action === "remove") {
      if (!hasOnlyKeys(operation, ["action", "externalOfferId"])) {
        return { error: `operations[${index}] contains unsupported fields.` }
      }
      const externalOfferId = requiredText(operation.externalOfferId, 200)
      if (!externalOfferId) {
        return { error: `operations[${index}].externalOfferId must be a non-empty string of at most 200 characters.` }
      }
      if (seenExternalIds.has(externalOfferId)) {
        return { error: `externalOfferId "${externalOfferId}" occurs more than once in the batch.` }
      }
      seenExternalIds.add(externalOfferId)
      operations.push({ action: "remove", externalOfferId })
      continue
    }

    if (operation.action !== "upsert" || !hasOnlyKeys(operation, ["action", "offer"]) || !isRecord(operation.offer)) {
      return { error: `operations[${index}] must be a valid upsert or remove operation.` }
    }

    const offer = operation.offer
    const allowedOfferKeys = [
      "externalOfferId",
      "title",
      "description",
      "price",
      "rawPrice",
      "categoryId",
      "gameId",
      "status",
      "keepInSale",
      "syncStatus",
    ]
    if (!hasOnlyKeys(offer, allowedOfferKeys)) {
      return { error: `operations[${index}].offer contains unsupported fields.` }
    }

    const externalOfferId = requiredText(offer.externalOfferId, 200)
    const title = requiredText(offer.title, 300)
    const categoryId = requiredText(offer.categoryId, 200)
    const gameId = requiredText(offer.gameId, 200)
    if (!externalOfferId || !title || !categoryId || !gameId) {
      return { error: `operations[${index}].offer requires externalOfferId, title, categoryId, and gameId.` }
    }
    if (seenExternalIds.has(externalOfferId)) {
      return { error: `externalOfferId "${externalOfferId}" occurs more than once in the batch.` }
    }
    if (!validPrice(offer.price) || !validPrice(offer.rawPrice)) {
      return { error: `operations[${index}].offer price and rawPrice must be finite non-negative amounts with at most two decimal places.` }
    }
    if (
      offer.description !== undefined &&
      offer.description !== null &&
      (typeof offer.description !== "string" || offer.description.length > 10_000)
    ) {
      return { error: `operations[${index}].offer.description must be a string of at most 10,000 characters or null.` }
    }
    if (offer.status !== undefined && !isOfferStatus(offer.status)) {
      return { error: `operations[${index}].offer.status must be one of ${OFFER_STATUSES.join(", ")}.` }
    }
    if (offer.keepInSale !== undefined && typeof offer.keepInSale !== "boolean") {
      return { error: `operations[${index}].offer.keepInSale must be a boolean.` }
    }
    if (offer.syncStatus !== undefined && !isSyncStatus(offer.syncStatus)) {
      return { error: `operations[${index}].offer.syncStatus must be one of ${SYNC_STATUSES.join(", ")}.` }
    }

    seenExternalIds.add(externalOfferId)
    const status = isOfferStatus(offer.status) ? offer.status : "APPROVED"
    operations.push({
      action: "upsert",
      offer: {
        externalOfferId,
        title,
        description: typeof offer.description === "string" ? offer.description : null,
        price: offer.price,
        rawPrice: offer.rawPrice,
        categoryId,
        gameId,
        status,
        keepInSale: status === "DELETED" ? false : typeof offer.keepInSale === "boolean" ? offer.keepInSale : true,
        syncStatus: isSyncStatus(offer.syncStatus) ? offer.syncStatus : "SYNCED",
      },
    })
  }

  return { operations }
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID()

  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 })
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0)
    if (contentLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body exceeds the 1 MB limit.", requestId }, { status: 413 })
    }

    let body: unknown
    try {
      const rawBody = await request.text()
      if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
        return NextResponse.json({ error: "Request body exceeds the 1 MB limit.", requestId }, { status: 413 })
      }
      body = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: "Request body must contain valid JSON.", requestId }, { status: 400 })
    }

    const validation = validateBatch(body)
    if (!validation.operations) {
      return NextResponse.json({ error: validation.error, requestId }, { status: 400 })
    }

    await ensureOffersSchema()
    const appliedAt = new Date()
    const results = await db.transaction(async (tx) => {
      const batchResults: BatchItemResult[] = []

      for (const operation of validation.operations) {
        if (operation.action === "upsert") {
          const offer = operation.offer
          const saved = await tx.insert(offers).values({
            externalOfferId: offer.externalOfferId,
            title: offer.title,
            description: offer.description,
            price: offer.price.toFixed(2),
            rawPrice: offer.rawPrice.toFixed(2),
            categoryId: offer.categoryId,
            gameId: offer.gameId,
            status: offer.status,
            keepInSale: offer.keepInSale,
            syncStatus: offer.syncStatus,
            lastSyncedAt: appliedAt,
            updatedAt: appliedAt,
          }).onConflictDoUpdate({
            target: offers.externalOfferId,
            set: {
              title: offer.title,
              description: offer.description,
              price: offer.price.toFixed(2),
              rawPrice: offer.rawPrice.toFixed(2),
              categoryId: offer.categoryId,
              gameId: offer.gameId,
              status: offer.status,
              keepInSale: offer.keepInSale,
              syncStatus: offer.syncStatus,
              lastSyncedAt: appliedAt,
              updatedAt: appliedAt,
            },
          }).returning({ id: offers.id })

          batchResults.push({
            action: "upsert",
            externalOfferId: offer.externalOfferId,
            result: "upserted",
            id: saved[0].id,
          })
          continue
        }

        const removed = await tx.update(offers).set({
          status: "DELETED",
          keepInSale: false,
          syncStatus: "SYNCED",
          lastSyncedAt: appliedAt,
          updatedAt: appliedAt,
        }).where(eq(offers.externalOfferId, operation.externalOfferId)).returning({ id: offers.id })

        batchResults.push({
          action: "remove",
          externalOfferId: operation.externalOfferId,
          result: removed[0] ? "removed" : "not_found",
          ...(removed[0] ? { id: removed[0].id } : {}),
        })
      }

      return batchResults
    })

    const summary: BatchSummary = {
      upserted: results.filter((result) => result.result === "upserted").length,
      removed: results.filter((result) => result.result === "removed").length,
      notFound: results.filter((result) => result.result === "not_found").length,
    }
    console.info(JSON.stringify({ event: "offers.batch.completed", requestId, count: results.length, ...summary }))
    const response: BatchResponse = {
      success: true,
      requestId,
      appliedAt: appliedAt.toISOString(),
      summary,
      results,
    }
    return NextResponse.json(response)
  } catch (error) {
    console.error(JSON.stringify({
      event: "offers.batch.failed",
      requestId,
      error: error instanceof Error ? error.message : "Unknown error",
    }))
    return NextResponse.json({ error: "Offer batch could not be applied.", requestId }, { status: 500 })
  }
}
