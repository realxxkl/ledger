import crypto from "node:crypto"
import { desc, eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { ensureOrderTrackingSchema } from "@/lib/db/ensure-order-tracking-schema"
import { entries, playerokSession } from "@/lib/db/schema"
import { getBotMedia, mimeToExtension } from "@/lib/bot-media"

export const PLAYEROK_COMPLETION_MESSAGE = "Готово ✅"

export type PlayerokFulfillmentResult = {
  attempted: boolean
  messageSent: boolean
  dealCompleted: boolean
  chatId: string | null
  dealId: string | null
  error: string | null
}

const UPLOAD_CHAT_IMAGE_MUTATION = `
  mutation uploadChatImageIntoTemporaryStore($file: Upload!, $input: UploadTemporaryAttachmentInput!) {
    uploadChatImageIntoTemporaryStore(file: $file, input: $input) {
      expiresAt
      id
      url
      chatId
      clientAttachmentId
      __typename
    }
  }
`

const CREATE_CHAT_MESSAGE_MUTATION = `
  mutation createChatMessage($input: CreateChatMessageInput!) {
    createChatMessage(input: $input) {
      id
      text
      createdAt
      images {
        id
        url
        __typename
      }
      __typename
    }
  }
`

const UPDATE_DEAL_MUTATION = `
  mutation updateDeal($input: UpdateItemDealInput!) {
    updateDeal(input: $input) {
      id
      status
      prevStatus
      completedAt
      __typename
    }
  }
`

const GET_DEAL_CHAT_QUERY = `
  query getDealChat($id: ID!) {
    deal(id: $id) {
      id
      chat {
        id
      }
    }
  }
`

const GET_DEAL_STATUS_QUERY = `
  query getDealStatus($id: ID!) {
    deal(id: $id) {
      id
      status
    }
  }
`

function buildPlayerokHeaders(
  cookieString: string,
  op: string,
  path: string,
  referer: string,
  includeJsonContentType = true,
): Record<string, string> {
  return {
    Accept: "*/*",
    ...(includeJsonContentType ? { "Content-Type": "application/json" } : {}),
    Cookie: cookieString,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    Origin: "https://playerok.com",
    Referer: referer,
    "apollo-require-preflight": "true",
    "apollographql-client-name": "web",
    "x-gql-op": op,
    "x-gql-path": path,
    "x-timezone-offset": String(new Date().getTimezoneOffset()),
  }
}

async function parsePlayerokGraphqlResponse<T>(
  response: Response,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  if (!response.ok) {
    if (response.status === 403) {
      return {
        ok: false,
        error:
          "Cloudflare blocked the request (403) or Playerok cookies expired. Click [Sync Cookies] in the extension and retry.",
      }
    }

    let detail = `HTTP ${response.status}`
    try {
      const text = await response.text()
      const parsed = JSON.parse(text) as { errors?: Array<{ message?: string }>; message?: string }
      if (Array.isArray(parsed?.errors) && parsed.errors.length > 0) {
        detail = parsed.errors.map((e) => e?.message || "GraphQL error").join("; ")
      } else if (parsed?.message) {
        detail = parsed.message
      } else if (text.trim()) {
        detail = text.trim().slice(0, 200)
      }
    } catch {
      // Preserve HTTP status fallback when response is not JSON.
    }
    return { ok: false, error: detail }
  }

  let json: { data?: T; errors?: Array<{ message?: string }> }
  try {
    json = (await response.json()) as { data?: T; errors?: Array<{ message?: string }> }
  } catch {
    return { ok: false, error: "Invalid JSON response from Playerok" }
  }

  if (Array.isArray(json.errors) && json.errors.length > 0) {
    const msg = json.errors.map((e) => e?.message || "GraphQL error").join("; ")
    return { ok: false, error: msg || "GraphQL error returned by Playerok" }
  }

  return { ok: true, data: (json.data ?? {}) as T }
}

export async function fulfillOrderOnPlayerok(input: {
  orderId: number
  imageBuffer?: Buffer
  mimeType?: string
}): Promise<PlayerokFulfillmentResult> {
  let messageSent = false
  let dealCompleted = false
  let chatId: string | null = null
  let dealId: string | null = null

  try {
    await ensureOrderTrackingSchema()

    const rows = await db
      .select({
        id: entries.id,
        source: entries.source,
        platform: entries.platform,
        externalOrderId: entries.externalOrderId,
        u7buyOrderId: entries.u7buyOrderId,
        buyerUsername: entries.buyerUsername,
        chatId: entries.chatId,
        proofImageUrl: entries.proofImageUrl,
        playerokMessageSent: entries.playerokMessageSent,
        playerokDealCompleted: entries.playerokDealCompleted,
        playerokDeliveryError: entries.playerokDeliveryError,
      })
      .from(entries)
      .where(eq(entries.id, input.orderId))
      .limit(1)

    const order = rows[0]
    if (!order) {
      return {
        attempted: false,
        messageSent: false,
        dealCompleted: false,
        chatId: null,
        dealId: null,
        error: "Order not found",
      }
    }

    messageSent = Boolean(order.playerokMessageSent)
    dealCompleted = Boolean(order.playerokDealCompleted)
    chatId = order.chatId?.trim() || null
    dealId = (order.externalOrderId || order.u7buyOrderId || "").trim() || null

    const isPlayerok = order.source === "playerok" || order.platform === "PO"
    if (!isPlayerok || !dealId) {
      return {
        attempted: false,
        messageSent,
        dealCompleted,
        chatId,
        dealId,
        error: null,
      }
    }

    if (messageSent && dealCompleted) {
      if (order.playerokDeliveryError) {
        await db
          .update(entries)
          .set({ playerokDeliveryError: null })
          .where(eq(entries.id, input.orderId))
      }
      return {
        attempted: true,
        messageSent: true,
        dealCompleted: true,
        chatId,
        dealId,
        error: null,
      }
    }

    const sessionRows = await db
      .select({ cookies: playerokSession.cookies })
      .from(playerokSession)
      .orderBy(desc(playerokSession.updatedAt))
      .limit(1)

    const cookieString = sessionRows[0]?.cookies?.trim()
    if (!cookieString) {
      const noCookieError =
        "No Playerok session cookies saved on Ledger. Click [Sync Cookies] in the extension first."
      await db
        .update(entries)
        .set({ playerokDeliveryError: noCookieError })
        .where(eq(entries.id, input.orderId))
      return {
        attempted: true,
        messageSent,
        dealCompleted,
        chatId,
        dealId,
        error: noCookieError,
      }
    }

    const errors: string[] = []

    if (!messageSent) {
      let resolvedChatId = chatId

      if (!resolvedChatId && order.buyerUsername?.trim()) {
        const userRows = await db
          .select({ chatId: entries.chatId })
          .from(entries)
          .where(
            sql`LOWER(${entries.buyerUsername}) = LOWER(${order.buyerUsername.trim()}) AND ${entries.chatId} IS NOT NULL AND ${entries.chatId} != ''`,
          )
          .limit(1)
        resolvedChatId = userRows[0]?.chatId?.trim() || null
      }

      if (!resolvedChatId) {
        try {
          const dealChatResp = await fetch("https://playerok.com/graphql", {
            method: "POST",
            headers: buildPlayerokHeaders(
              cookieString,
              "getDealChat",
              "/deal/[id]",
              `https://playerok.com/deal/${encodeURIComponent(dealId)}`,
              true,
            ),
            body: JSON.stringify({
              operationName: "getDealChat",
              variables: { id: dealId },
              query: GET_DEAL_CHAT_QUERY,
            }),
          })
          const dealChatParsed = await parsePlayerokGraphqlResponse<{
            deal?: { id?: string; chat?: { id?: string } | null } | null
          }>(dealChatResp)
          if (dealChatParsed.ok) {
            resolvedChatId = dealChatParsed.data.deal?.chat?.id?.trim() || null
          }
        } catch {
          // Fall through to missing chatId handling.
        }
      }

      if (resolvedChatId && resolvedChatId !== order.chatId) {
        await db
          .update(entries)
          .set({ chatId: resolvedChatId })
          .where(eq(entries.id, input.orderId))
      }
      chatId = resolvedChatId

      if (!chatId) {
        errors.push(
          "No Playerok chat ID found for this order. Sync orders/chats via the extension first.",
        )
      } else {
        let imgBuffer = input.imageBuffer
        let imgMimeType = input.mimeType

        if (!imgBuffer || !imgMimeType) {
          const mediaMatch = (order.proofImageUrl ?? "").match(/\/api\/media\/([0-9a-f-]{36})/i)
          if (mediaMatch) {
            const media = await getBotMedia(mediaMatch[1])
            if (media) {
              imgBuffer = media.data
              imgMimeType = media.mimeType
            }
          }
        }

        if (!imgBuffer || !imgMimeType) {
          errors.push("Proof screenshot not found in storage.")
        } else {
          try {
            const formData = new FormData()
            formData.append(
              "operations",
              JSON.stringify({
                operationName: "uploadChatImageIntoTemporaryStore",
                variables: {
                  file: null,
                  input: {
                    chatId,
                    clientAttachmentId: crypto.randomUUID(),
                  },
                },
                query: UPLOAD_CHAT_IMAGE_MUTATION,
              }),
            )
            formData.append("map", JSON.stringify({ "1": ["variables.file"] }))
            const ext = mimeToExtension(imgMimeType)
            formData.append(
              "1",
              new File([new Uint8Array(imgBuffer)], `chat-image-${Date.now()}.${ext}`, {
                type: imgMimeType,
              }),
            )

            const uploadResp = await fetch("https://playerok.com/graphql", {
              method: "POST",
              headers: buildPlayerokHeaders(
                cookieString,
                "uploadChatImageIntoTemporaryStore",
                "/chats/[id]",
                `https://playerok.com/chats/${encodeURIComponent(chatId)}`,
                false,
              ),
              body: formData,
            })

            const uploadParsed = await parsePlayerokGraphqlResponse<{
              uploadChatImageIntoTemporaryStore?: { id?: string } | null
            }>(uploadResp)

            if (!uploadParsed.ok) {
              errors.push(`Proof upload failed: ${uploadParsed.error}`)
            } else {
              const uploadedImageId = uploadParsed.data.uploadChatImageIntoTemporaryStore?.id
              if (!uploadedImageId) {
                errors.push("Proof upload failed: Playerok did not return an attachment ID.")
              } else {
                const msgResp = await fetch("https://playerok.com/graphql", {
                  method: "POST",
                  headers: buildPlayerokHeaders(
                    cookieString,
                    "createChatMessage",
                    "/chats/[id]",
                    `https://playerok.com/chats/${encodeURIComponent(chatId)}`,
                    true,
                  ),
                  body: JSON.stringify({
                    operationName: "createChatMessage",
                    variables: {
                      input: {
                        chatId,
                        imagesIds: [uploadedImageId],
                        text: PLAYEROK_COMPLETION_MESSAGE,
                      },
                    },
                    query: CREATE_CHAT_MESSAGE_MUTATION,
                  }),
                })

                const msgParsed = await parsePlayerokGraphqlResponse<{
                  createChatMessage?: { id?: string } | null
                }>(msgResp)

                if (!msgParsed.ok) {
                  errors.push(`Chat message failed: ${msgParsed.error}`)
                } else if (!msgParsed.data.createChatMessage?.id) {
                  errors.push("Chat message failed: Playerok returned no message ID.")
                } else {
                  messageSent = true
                  await db
                    .update(entries)
                    .set({ playerokMessageSent: true })
                    .where(eq(entries.id, input.orderId))
                }
              }
            }
          } catch (err) {
            errors.push(
              `Chat delivery error: ${err instanceof Error ? err.message : "Network error"}`,
            )
          }
        }
      }
    }

    if (!dealCompleted) {
      try {
        const dealResp = await fetch("https://playerok.com/graphql", {
          method: "POST",
          headers: buildPlayerokHeaders(
            cookieString,
            "updateDeal",
            "/deal/[id]",
            `https://playerok.com/deal/${encodeURIComponent(dealId)}`,
            true,
          ),
          body: JSON.stringify({
            operationName: "updateDeal",
            variables: {
              input: {
                id: dealId,
                status: "SENT",
              },
            },
            query: UPDATE_DEAL_MUTATION,
          }),
        })

        const dealParsed = await parsePlayerokGraphqlResponse<{
          updateDeal?: { id?: string; status?: string } | null
        }>(dealResp)

        if (dealParsed.ok && dealParsed.data.updateDeal?.id) {
          dealCompleted = true
        } else {
          // Verify whether the deal was already marked SENT/CONFIRMED manually on Playerok.
          let verifiedAlreadyDone = false
          try {
            const statusResp = await fetch("https://playerok.com/graphql", {
              method: "POST",
              headers: buildPlayerokHeaders(
                cookieString,
                "getDealStatus",
                "/deal/[id]",
                `https://playerok.com/deal/${encodeURIComponent(dealId)}`,
                true,
              ),
              body: JSON.stringify({
                operationName: "getDealStatus",
                variables: { id: dealId },
                query: GET_DEAL_STATUS_QUERY,
              }),
            })
            const statusParsed = await parsePlayerokGraphqlResponse<{
              deal?: { id?: string; status?: string } | null
            }>(statusResp)
            const remoteStatus = String(statusParsed.ok ? statusParsed.data.deal?.status ?? "" : "")
              .trim()
              .toUpperCase()
            if (remoteStatus === "SENT" || remoteStatus === "CONFIRMED") {
              verifiedAlreadyDone = true
            }
          } catch {
            // Keep original updateDeal error below.
          }

          if (verifiedAlreadyDone) {
            dealCompleted = true
          } else {
            errors.push(
              `Mark completed failed: ${dealParsed.ok ? "Playerok returned no deal ID" : dealParsed.error}`,
            )
          }
        }

        if (dealCompleted) {
          await db
            .update(entries)
            .set({ playerokDealCompleted: true })
            .where(eq(entries.id, input.orderId))
        }
      } catch (err) {
        errors.push(
          `Mark completed error: ${err instanceof Error ? err.message : "Network error"}`,
        )
      }
    }

    const finalError = errors.length > 0 ? errors.join(" | ") : null
    await db
      .update(entries)
      .set({ playerokDeliveryError: finalError })
      .where(eq(entries.id, input.orderId))

    return {
      attempted: true,
      messageSent,
      dealCompleted,
      chatId,
      dealId,
      error: finalError,
    }
  } catch (err) {
    const errMsg =
      err instanceof Error ? err.message : "Unexpected error syncing completion to Playerok"
    console.error("[Playerok Fulfillment] Unexpected failure:", err)
    try {
      await db
        .update(entries)
        .set({ playerokDeliveryError: errMsg })
        .where(eq(entries.id, input.orderId))
    } catch {
      // Ignore secondary DB failure during best-effort error recording.
    }
    return {
      attempted: true,
      messageSent,
      dealCompleted,
      chatId,
      dealId,
      error: errMsg,
    }
  }
}
