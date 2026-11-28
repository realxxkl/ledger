import crypto from "node:crypto"
import { pool } from "@/lib/db"
import { ensureBotSchema } from "@/lib/db/ensure-bot-schema"

export const MAX_BOT_MEDIA_BYTES = 10 * 1024 * 1024

export type SupportedImageMimeType = "image/png" | "image/jpeg" | "image/webp"

export function detectImageMimeType(buffer: Buffer): SupportedImageMimeType | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png"
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg"
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp"
  }

  return null
}

function validateImageBuffer(buffer: Buffer): { buffer: Buffer; mimeType: SupportedImageMimeType } {
  if (buffer.length === 0) {
    throw new Error("Screenshot image is empty")
  }
  if (buffer.length > MAX_BOT_MEDIA_BYTES) {
    throw new Error(`Screenshot exceeds maximum size of ${MAX_BOT_MEDIA_BYTES / (1024 * 1024)} MB`)
  }
  const mimeType = detectImageMimeType(buffer)
  if (!mimeType) {
    throw new Error("Unsupported image format; expected PNG, JPEG, or WebP")
  }
  return { buffer, mimeType }
}

export function decodeBase64Image(raw: string): { buffer: Buffer; mimeType: SupportedImageMimeType } {
  const withoutPrefix = raw.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/i, "")
  const cleaned = withoutPrefix.replace(/\s+/g, "")
  if (!cleaned || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
    throw new Error("Invalid base64 screenshot payload")
  }

  const buffer = Buffer.from(cleaned, "base64")
  return validateImageBuffer(buffer)
}

export async function readUploadedImage(file: Blob): Promise<{ buffer: Buffer; mimeType: SupportedImageMimeType }> {
  if (file.size > MAX_BOT_MEDIA_BYTES) {
    throw new Error(`Screenshot exceeds maximum size of ${MAX_BOT_MEDIA_BYTES / (1024 * 1024)} MB`)
  }
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  return validateImageBuffer(buffer)
}

export async function saveBotMedia(input: {
  orderId: number | null
  kind: "proof" | "error"
  buffer: Buffer
  mimeType: SupportedImageMimeType
}): Promise<{ id: string; url: string }> {
  await ensureBotSchema()
  const id = crypto.randomUUID()
  await pool.query(
    `INSERT INTO bot_media (id, order_id, kind, mime_type, data, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, input.orderId, input.kind, input.mimeType, input.buffer, input.buffer.length],
  )
  return { id, url: `/api/media/${id}` }
}

export async function getBotMedia(id: string): Promise<{
  id: string
  orderId: number | null
  kind: string
  mimeType: string
  data: Buffer
  sizeBytes: number
} | null> {
  await ensureBotSchema()
  const result = await pool.query(
    `SELECT id, order_id, kind, mime_type, data, size_bytes
     FROM bot_media
     WHERE id = $1
     LIMIT 1`,
    [id],
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    id: String(row.id),
    orderId: row.order_id !== null && row.order_id !== undefined ? Number(row.order_id) : null,
    kind: String(row.kind),
    mimeType: String(row.mime_type),
    data: Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data),
    sizeBytes: Number(row.size_bytes),
  }
}

export function mimeToExtension(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg"
  if (mimeType === "image/webp") return "webp"
  return "png"
}
