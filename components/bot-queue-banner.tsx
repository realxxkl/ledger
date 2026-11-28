"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, Lock, LoaderCircle, Unlock, X } from "lucide-react"
import type { BotQueueState, Entry } from "@/lib/types"

export function BotQueueBanner({
  botQueue,
  entries,
  onChange,
  compactWhenActive = false,
}: {
  botQueue?: BotQueueState
  entries?: Entry[]
  onChange: () => void | Promise<unknown>
  compactWhenActive?: boolean
}) {
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState("")
  const [previewOpen, setPreviewOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (previewOpen && !dialog.open) dialog.showModal()
    if (!previewOpen && dialog.open) dialog.close()
  }, [previewOpen])

  const isLocked = Boolean(botQueue?.locked)
  if (!isLocked && compactWhenActive) {
    return null
  }

  const orderList = entries ?? []
  const queuedCount = orderList.filter((e) => e.orderStatus === "READY_FOR_TOPUP").length
  const processingCount = orderList.filter((e) => e.orderStatus === "BOT_PROCESSING").length
  const attentionCount = orderList.filter(
    (e) => e.orderStatus === "USERNAME_MISMATCH" || e.orderStatus === "HOLD_ESCALATION",
  ).length

  async function setQueueLocked(locked: boolean) {
    if (updating) return
    setUpdating(true)
    setError("")
    try {
      const response = await fetch("/api/bot-queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error || "Could not update bot queue status")
      }
      await onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update bot queue status")
    } finally {
      setUpdating(false)
    }
  }

  if (isLocked) {
    return (
      <section
        role="alert"
        aria-live="polite"
        className="border-2 border-destructive bg-destructive/10 p-5"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 border-2 border-destructive bg-destructive px-2.5 py-1 text-xs font-black uppercase tracking-wider text-destructive-foreground">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                Bot Queue: LOCKED
              </span>
              {botQueue?.orderId && (
                <Link
                  href={`/orders/${botQueue.orderId}`}
                  className="border border-destructive/50 bg-background/60 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-foreground underline underline-offset-2 hover:text-primary"
                >
                  Inspect Order #{botQueue.orderId}
                </Link>
              )}
              {entries && (
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {queuedCount} queued · {processingCount} processing
                </span>
              )}
            </div>
            <p className="mt-3 text-sm font-bold text-foreground">
              {botQueue?.reason || "Queue locked after bot error. Verify the phone state before resuming."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              The bot will not claim any new orders while locked so unclaimed Google Play packs cannot redeem onto the next buyer.
            </p>
            {error && <p className="mt-2 text-xs font-bold text-destructive">{error}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {botQueue?.errorImageUrl && (
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="group flex flex-col items-start gap-1 text-left"
              >
                <img
                  src={botQueue.errorImageUrl}
                  alt="Bot error screenshot"
                  className="h-20 w-32 border-2 border-destructive/70 bg-background object-cover transition-opacity group-hover:opacity-85"
                />
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground underline group-hover:text-foreground">
                  Inspect screenshot
                </span>
              </button>
            )}
            <button
              type="button"
              disabled={updating}
              onClick={() => setQueueLocked(false)}
              className="inline-flex items-center gap-2 border-2 border-primary bg-primary px-4 py-2.5 text-xs font-black uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
            >
              {updating ? (
                <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Unlock className="size-4" aria-hidden="true" />
              )}
              {updating ? "Unlocking…" : "Unlock Queue"}
            </button>
          </div>
        </div>

        {botQueue?.errorImageUrl && previewOpen && (
          <dialog
            ref={dialogRef}
            onCancel={(event) => {
              event.preventDefault()
              setPreviewOpen(false)
            }}
            className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl border-2 border-destructive bg-card p-0 text-foreground shadow-2xl backdrop:bg-background/85 backdrop:backdrop-blur-sm"
          >
            <div className="flex items-center justify-between border-b-2 border-border px-4 py-3">
              <span className="text-xs font-black uppercase tracking-wider text-destructive">
                Lock Error Screenshot
              </span>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="border border-border p-1 text-muted-foreground hover:border-primary hover:text-foreground"
                aria-label="Close screenshot preview"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="p-4">
              <img
                src={botQueue.errorImageUrl}
                alt="Full size bot lock error screenshot"
                className="mx-auto max-h-[75vh] w-auto border border-border object-contain"
              />
            </div>
          </dialog>
        )}
      </section>
    )
  }

  return (
    <section
      aria-label="Bot Queue Status"
      className="flex flex-wrap items-center justify-between gap-3 border-2 border-border bg-card px-5 py-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 border border-primary/50 bg-primary/10 px-2.5 py-1 text-xs font-black uppercase tracking-wider text-primary">
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
          Bot Queue: Active
        </span>
        {entries && (
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {queuedCount} queued · {processingCount} processing
          </span>
        )}
        {attentionCount > 0 && (
          <span className="border border-fee/60 bg-fee/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fee">
            {attentionCount} needs attention
          </span>
        )}
        {error && <span className="text-xs font-bold text-destructive">{error}</span>}
      </div>

      <button
        type="button"
        disabled={updating}
        onClick={() => setQueueLocked(true)}
        className="inline-flex items-center gap-1.5 border-2 border-border bg-background px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:cursor-wait disabled:opacity-60"
      >
        {updating ? (
          <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <Lock className="size-3" aria-hidden="true" />
        )}
        {updating ? "Locking…" : "Lock Queue"}
      </button>
    </section>
  )
}
