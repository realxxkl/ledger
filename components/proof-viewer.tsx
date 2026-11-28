"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Copy, Download, Eye, LoaderCircle, Send, X } from "lucide-react"

async function convertBlobToPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob

  const objectUrl = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error("Could not decode proof image"))
      image.src = objectUrl
    })

    const canvas = document.createElement("canvas")
    canvas.width = img.naturalWidth || img.width
    canvas.height = img.naturalHeight || img.height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas context unavailable")
    ctx.drawImage(img, 0, 0)

    const pngBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((result) => resolve(result), "image/png"),
    )
    if (!pngBlob) throw new Error("Could not encode PNG for clipboard")
    return pngBlob
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export function ProofViewer({
  proofImageUrl,
  orderLabel,
  vbucksAfter,
  orderId,
  isPlayerokOrder,
  playerokMessageSent,
  playerokDealCompleted,
  playerokDeliveryError,
  onChange,
}: {
  proofImageUrl: string
  orderLabel: string
  vbucksAfter?: number
  orderId?: string
  isPlayerokOrder?: boolean
  playerokMessageSent?: boolean
  playerokDealCompleted?: boolean
  playerokDeliveryError?: string
  onChange?: () => void | Promise<unknown>
}) {
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "error">("idle")
  const [copyError, setCopyError] = useState("")
  const [sendingToPlayerok, setSendingToPlayerok] = useState(false)
  const [playerokActionError, setPlayerokActionError] = useState("")
  const [previewOpen, setPreviewOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (previewOpen && !dialog.open) dialog.showModal()
    if (!previewOpen && dialog.open) dialog.close()
  }, [previewOpen])

  async function handleCopyImage() {
    if (copyState === "copying") return
    setCopyError("")

    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      setCopyState("error")
      setCopyError("Image clipboard is not supported here. Use Download instead.")
      return
    }

    setCopyState("copying")
    try {
      const response = await fetch(proofImageUrl)
      if (!response.ok) throw new Error("Could not fetch proof screenshot")
      const blob = await response.blob()
      const pngBlob = await convertBlobToPng(blob)
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })])
      setCopyState("copied")
      window.setTimeout(() => {
        setCopyState((current) => (current === "copied" ? "idle" : current))
      }, 2000)
    } catch (err) {
      setCopyState("error")
      setCopyError(
        err instanceof Error
          ? `${err.message}. Use Download instead.`
          : "Could not copy image. Use Download instead.",
      )
    }
  }

  const downloadHref = `${proofImageUrl}?download=1`
  const playerokDone = Boolean(playerokMessageSent && playerokDealCompleted)
  const playerokStatusText = playerokMessageSent
    ? "PlayerOK: Proof sent, deal not marked yet"
    : playerokDealCompleted
      ? "PlayerOK: Deal marked, proof not sent"
      : "PlayerOK: Not delivered yet"

  async function handleDeliverToPlayerok() {
    if (!orderId || sendingToPlayerok) return
    setSendingToPlayerok(true)
    setPlayerokActionError("")
    try {
      const response = await fetch(`/api/orders/${orderId}/playerok-deliver`, {
        method: "POST",
      })
      const payload = await response.json().catch(() => ({}))
      await onChange?.()
      if (!response.ok || payload?.error) {
        throw new Error(payload?.error || "Could not send proof and complete deal on PlayerOK")
      }
    } catch (err) {
      setPlayerokActionError(
        err instanceof Error ? err.message : "Could not send proof and complete deal on PlayerOK",
      )
    } finally {
      setSendingToPlayerok(false)
    }
  }

  return (
    <div className="border-2 border-positive/40 bg-positive/5 p-3">
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="group relative shrink-0 border-2 border-border bg-background"
          aria-label={`Preview fulfillment proof for order ${orderLabel}`}
        >
          <img
            src={proofImageUrl}
            alt={`Fulfillment lobby proof for ${orderLabel}`}
            className="h-20 w-36 object-cover transition-opacity group-hover:opacity-85"
          />
          <span className="absolute right-1 bottom-1 inline-flex items-center gap-1 border border-border bg-background/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground">
            <Eye className="size-2.5" aria-hidden="true" />
            Zoom
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-positive">
              Fulfillment Proof
            </p>
            {vbucksAfter !== undefined && (
              <span className="border border-positive/50 bg-positive/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-positive">
                Final balance: {vbucksAfter} V-Bucks
              </span>
            )}
            {isPlayerokOrder && (
              <span
                className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  playerokDone
                    ? "border-positive/50 bg-positive/10 text-positive"
                    : "border-fee/60 bg-fee/10 text-fee"
                }`}
              >
                {playerokDone && <Check className="size-3" aria-hidden="true" />}
                {playerokDone ? "PlayerOK: Proof sent & marked completed" : playerokStatusText}
              </span>
            )}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={copyState === "copying"}
              onClick={handleCopyImage}
              className="inline-flex items-center gap-1.5 border-2 border-primary bg-primary px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
            >
              {copyState === "copying" ? (
                <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : copyState === "copied" ? (
                <Check className="size-3" aria-hidden="true" />
              ) : (
                <Copy className="size-3" aria-hidden="true" />
              )}
              {copyState === "copying"
                ? "Copying…"
                : copyState === "copied"
                  ? "Copied!"
                  : "Copy Image"}
            </button>
            <a
              href={downloadHref}
              download={`order-${orderLabel}-proof.png`}
              className="inline-flex items-center gap-1.5 border-2 border-border bg-background px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <Download className="size-3" aria-hidden="true" />
              Download
            </a>
            {isPlayerokOrder && orderId && !playerokDone && (
              <button
                type="button"
                disabled={sendingToPlayerok}
                onClick={handleDeliverToPlayerok}
                className="inline-flex items-center gap-1.5 border-2 border-border bg-background px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-wait disabled:opacity-60"
              >
                {sendingToPlayerok ? (
                  <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <Send className="size-3" aria-hidden="true" />
                )}
                {sendingToPlayerok
                  ? "Sending to PlayerOK…"
                  : playerokDeliveryError || playerokMessageSent || playerokDealCompleted
                    ? "Retry PlayerOK"
                    : "Send & Complete on PlayerOK"}
              </button>
            )}
          </div>
          {copyState === "error" && copyError && (
            <p role="alert" className="mt-2 text-xs font-bold text-destructive">
              {copyError}
            </p>
          )}
          {isPlayerokOrder && !playerokDone && (playerokActionError || playerokDeliveryError) && (
            <p role="alert" className="mt-2 text-xs font-bold text-destructive">
              {playerokActionError || playerokDeliveryError}
            </p>
          )}
        </div>
      </div>

      {previewOpen && (
        <dialog
          ref={dialogRef}
          onCancel={(event) => {
            event.preventDefault()
            setPreviewOpen(false)
          }}
          className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl border-2 border-primary bg-card p-0 text-foreground shadow-2xl backdrop:bg-background/85 backdrop:backdrop-blur-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-border px-4 py-3">
            <span className="text-xs font-black uppercase tracking-wider text-primary">
              Fulfillment Proof · {orderLabel}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={copyState === "copying"}
                onClick={handleCopyImage}
                className="inline-flex items-center gap-1.5 border border-primary bg-primary px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-primary-foreground"
              >
                {copyState === "copied" ? <Check className="size-3" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
                {copyState === "copied" ? "Copied!" : "Copy Image"}
              </button>
              <a
                href={downloadHref}
                download={`order-${orderLabel}-proof.png`}
                className="inline-flex items-center gap-1.5 border border-border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-foreground hover:border-primary hover:text-primary"
              >
                <Download className="size-3" aria-hidden="true" />
                Download
              </a>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="border border-border p-1 text-muted-foreground hover:border-primary hover:text-foreground"
                aria-label="Close proof preview"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="p-4">
            <img
              src={proofImageUrl}
              alt={`Full size fulfillment proof for ${orderLabel}`}
              className="mx-auto max-h-[75vh] w-auto border border-border object-contain"
            />
          </div>
        </dialog>
      )}
    </div>
  )
}
