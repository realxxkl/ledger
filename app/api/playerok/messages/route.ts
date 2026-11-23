import { NextRequest, NextResponse } from "next/server"
import { desc, eq, or } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { ensureOrderTrackingSchema } from "@/lib/db/ensure-order-tracking-schema"
import { entries, playerokSession } from "@/lib/db/schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RecipientInput = {
  buyerUsername: string
  orderId?: string
  chatId?: string
}

type MessageResult = {
  buyerUsername: string
  status: "sent" | "failed" | "not_found" | "uncertain"
  detail: string
}

const CREATE_CHAT_MESSAGE_MUTATION = `
  mutation createChatMessage($input: CreateChatMessageInput!) {
    createChatMessage(input: $input) {
      id
      text
      createdAt
      __typename
    }
  }
`

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

    const body = await request.json()
    const { recipients, messageText } = body as {
      recipients: RecipientInput[]
      messageText: string
    }

    if (
      !Array.isArray(recipients) ||
      recipients.length === 0 ||
      recipients.length > 20 ||
      typeof messageText !== "string" ||
      !messageText.trim()
    ) {
      return NextResponse.json(
        { error: "Invalid recipients or messageText" },
        { status: 400 }
      )
    }

    await ensureOrderTrackingSchema()

    // 1. Get saved cookies
    const sessionRow = await db.select()
      .from(playerokSession)
      .orderBy(desc(playerokSession.updatedAt))
      .limit(1)

    const cookieString = sessionRow[0]?.cookies
    if (!cookieString) {
      return NextResponse.json(
        {
          error: "No Playerok session cookies saved on Ledger. Use the extension widget to sync your cookies first.",
        },
        { status: 400 }
      )
    }

    const results: MessageResult[] = []
    let stopped = false

    for (const recipient of recipients) {
      const buyerUsername = recipient.buyerUsername.trim()
      let chatId = recipient.chatId?.trim()

      // Look up chatId in database if not passed
      if (!chatId && recipient.orderId) {
        const orderRows = await db.select({ chatId: entries.chatId })
          .from(entries)
          .where(
            or(
              eq(entries.externalOrderId, recipient.orderId.trim()),
              eq(entries.externalOrderId, recipient.orderId.trim().toLowerCase())
            )
          )
          .limit(1)

        chatId = orderRows[0]?.chatId || undefined
      }

      if (!chatId) {
        // Fallback: look up by buyerUsername
        const userRows = await db.select({ chatId: entries.chatId })
          .from(entries)
          .where(eq(entries.buyerUsername, buyerUsername))
          .limit(1)

        chatId = userRows[0]?.chatId || undefined
      }

      if (!chatId) {
        results.push({
          buyerUsername,
          status: "not_found",
          detail: "No chat ID found for this buyer or order. Sync orders via the extension first.",
        })
        continue
      }

      // 2. Send via Playerok GraphQL with stored cookie
      try {
        const response = await fetch("https://playerok.com/graphql", {
          method: "POST",
          headers: {
            "Accept": "*/*",
            "Content-Type": "application/json",
            "Cookie": cookieString,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            "Origin": "https://playerok.com",
            "Referer": `https://playerok.com/chats/${chatId}`,
            "apollo-require-preflight": "true",
            "apollographql-client-name": "web",
            "x-gql-op": "createChatMessage",
            "x-gql-path": `/chats/${chatId}`,
          },
          body: JSON.stringify({
            operationName: "createChatMessage",
            variables: {
              input: {
                chatId,
                text: messageText,
              },
            },
            query: CREATE_CHAT_MESSAGE_MUTATION,
          }),
        })

        if (!response.ok) {
          let errDetail = `HTTP ${response.status}`
          if (response.status === 403) {
            errDetail = "Cloudflare blocked the server request (403). Session cookies may have expired or need renewal via extension."
          } else {
            try {
              const text = await response.text()
              const parsed = JSON.parse(text)
              if (parsed?.errors?.length > 0) {
                errDetail = parsed.errors.map((e: { message?: string }) => e.message).join("; ")
              } else if (parsed?.message) {
                errDetail = parsed.message
              }
            } catch {}
          }

          results.push({
            buyerUsername,
            status: response.status >= 500 ? "uncertain" : "failed",
            detail: errDetail,
          })
          stopped = true
          break
        }

        const data = await response.json()
        if (data.errors && data.errors.length > 0) {
          const msg = data.errors.map((e: { message?: string }) => e.message).join("; ")
          results.push({
            buyerUsername,
            status: "failed",
            detail: msg || "GraphQL error returned by Playerok",
          })
          stopped = true
          break
        }

        const createdId = data?.data?.createChatMessage?.id
        if (!createdId) {
          results.push({
            buyerUsername,
            status: "uncertain",
            detail: "No message ID returned by Playerok",
          })
          stopped = true
          break
        }

        results.push({
          buyerUsername,
          status: "sent",
          detail: "Message sent directly by Ledger server.",
        })

        await delay(1000)
      } catch (err) {
        results.push({
          buyerUsername,
          status: "failed",
          detail: err instanceof Error ? err.message : "Network failure communicating with Playerok",
        })
        stopped = true
        break
      }
    }

    return NextResponse.json({ results, stopped })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process message batch" },
      { status: 500 }
    )
  }
}
