"use client"

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, Bot, Check, KeyRound, LoaderCircle, RotateCcw, Save, Send, X } from "lucide-react"
import type { Entry } from "@/lib/types"
import {
  buildFortniteLoginLink,
  isValidCardLast4,
  isValidGameLoginLink,
  normalizePackCombination,
  parseVbucksAmount,
} from "@/lib/bot-status"

type FieldKey = "epicUsername" | "cardLast4" | "gameLoginLink" | "vbucksAmount" | "packCombination"

export function BotHandoffPanel({
  order,
  epicDisplayName,
  hasEpicSession,
  onChange,
}: {
  order: Entry
  epicDisplayName?: string
  hasEpicSession?: boolean
  onChange: () => void | Promise<unknown>
}) {
  const defaultEpicUsername = order.epicUsername ?? epicDisplayName ?? ""
  const defaultCardLast4 = order.cardLast4 ?? ""
  const defaultGameLoginLink = order.gameLoginLink ?? ""
  const parsedServiceVbucks = parseVbucksAmount(order.service)
  const defaultVbucksAmount =
    order.vbucksAmount !== undefined
      ? String(order.vbucksAmount)
      : parsedServiceVbucks !== null
        ? String(parsedServiceVbucks)
        : ""
  const defaultPackCombination =
    order.packCombination && order.packCombination.length > 0
      ? order.packCombination.join(", ")
      : ""

  const [epicUsername, setEpicUsername] = useState(defaultEpicUsername)
  const [cardLast4, setCardLast4] = useState(defaultCardLast4)
  const [gameLoginLink, setGameLoginLink] = useState(defaultGameLoginLink)
  const [vbucksAmount, setVbucksAmount] = useState(defaultVbucksAmount)
  const [packCombination, setPackCombination] = useState(defaultPackCombination)

  const dirtyFieldsRef = useRef<Set<FieldKey>>(new Set())
  const lastOrderIdRef = useRef(order.id)

  const [busyAction, setBusyAction] = useState<"send" | "save" | "unqueue" | "link" | "reset" | "requeue" | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [errorPreviewOpen, setErrorPreviewOpen] = useState(false)
  const errorDialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = errorDialogRef.current
    if (!dialog) return
    if (errorPreviewOpen && !dialog.open) dialog.showModal()
    if (!errorPreviewOpen && dialog.open) dialog.close()
  }, [errorPreviewOpen])

  useEffect(() => {
    if (lastOrderIdRef.current !== order.id) {
      lastOrderIdRef.current = order.id
      dirtyFieldsRef.current.clear()
      setEpicUsername(defaultEpicUsername)
      setCardLast4(defaultCardLast4)
      setGameLoginLink(defaultGameLoginLink)
      setVbucksAmount(defaultVbucksAmount)
      setPackCombination(defaultPackCombination)
      setError("")
      setNotice("")
      return
    }

    if (!dirtyFieldsRef.current.has("epicUsername")) setEpicUsername(defaultEpicUsername)
    if (!dirtyFieldsRef.current.has("cardLast4")) setCardLast4(defaultCardLast4)
    if (!dirtyFieldsRef.current.has("gameLoginLink")) setGameLoginLink(defaultGameLoginLink)
    if (!dirtyFieldsRef.current.has("vbucksAmount")) setVbucksAmount(defaultVbucksAmount)
    if (!dirtyFieldsRef.current.has("packCombination")) setPackCombination(defaultPackCombination)
  }, [
    order.id,
    defaultEpicUsername,
    defaultCardLast4,
    defaultGameLoginLink,
    defaultVbucksAmount,
    defaultPackCombination,
  ])

  function markDirty(field: FieldKey) {
    dirtyFieldsRef.current.add(field)
    setError("")
    setNotice("")
  }

  const isProcessing = order.orderStatus === "BOT_PROCESSING"
  const isQueued = order.orderStatus === "READY_FOR_TOPUP"
  const isMismatch = order.orderStatus === "USERNAME_MISMATCH"
  const isEscalation = order.orderStatus === "HOLD_ESCALATION"

  async function handleGenerateLink() {
    if (busyAction || isProcessing) return
    setBusyAction("link")
    setError("")
    setNotice("")
    try {
      const response = await fetch("/api/epic/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.code) {
        throw new Error(data?.error || "Could not generate Fortnite login link")
      }
      const link = buildFortniteLoginLink(data.code)
      dirtyFieldsRef.current.add("gameLoginLink")
      setGameLoginLink(link)
      setNotice("Fresh Fortnite login link generated. Click Save Fields or Send to Bot.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate Fortnite login link")
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSaveFields() {
    if (busyAction || isProcessing) return
    setError("")
    setNotice("")

    const trimmedCard = cardLast4.trim()
    if (trimmedCard && !isValidCardLast4(trimmedCard)) {
      setError("Card last 4 must be exactly 4 digits.")
      return
    }
    const trimmedLink = gameLoginLink.trim()
    if (trimmedLink && !isValidGameLoginLink(trimmedLink)) {
      setError("Game login link must be a valid http(s) URL.")
      return
    }
    const trimmedVbucks = vbucksAmount.trim()
    let parsedVbucks: number | null = null
    if (trimmedVbucks) {
      if (!/^\d+$/.test(trimmedVbucks)) {
        setError("V-Bucks amount must be a positive integer.")
        return
      }
      parsedVbucks = Number(trimmedVbucks)
      if (!Number.isSafeInteger(parsedVbucks) || parsedVbucks <= 0) {
        setError("V-Bucks amount must be a positive integer.")
        return
      }
    }
    const packResult = normalizePackCombination(packCombination)
    if (!packResult.ok) {
      setError(packResult.error)
      return
    }

    setBusyAction("save")
    try {
      const response = await fetch("/api/entries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: Number(order.id),
          epicUsername: epicUsername.trim() || null,
          cardLast4: trimmedCard || null,
          gameLoginLink: trimmedLink || null,
          vbucksAmount: parsedVbucks,
          packCombination: packResult.value,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || "Could not save bot handoff fields")
      }
      dirtyFieldsRef.current.clear()
      setNotice("Bot fields saved.")
      await onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save bot handoff fields")
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSendToBot() {
    if (busyAction || isProcessing) return
    setError("")
    setNotice("")

    const trimmedUsername = epicUsername.trim()
    const trimmedCard = cardLast4.trim()
    const trimmedLink = gameLoginLink.trim()
    const trimmedVbucks = vbucksAmount.trim()

    if (!trimmedUsername) {
      setError("Epic username is required before sending to bot.")
      return
    }
    if (!isValidCardLast4(trimmedCard)) {
      setError("Card last 4 digits must be exactly 4 digits.")
      return
    }
    if (!isValidGameLoginLink(trimmedLink)) {
      setError("Valid Epic game login link (http/https) is required.")
      return
    }
    if (!/^\d+$/.test(trimmedVbucks)) {
      setError("V-Bucks amount must be a positive integer.")
      return
    }
    const parsedVbucks = Number(trimmedVbucks)
    if (!Number.isSafeInteger(parsedVbucks) || parsedVbucks <= 0) {
      setError("V-Bucks amount must be a positive integer.")
      return
    }
    const packResult = normalizePackCombination(packCombination)
    if (!packResult.ok) {
      setError(packResult.error)
      return
    }

    setBusyAction("send")
    try {
      const response = await fetch("/api/entries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: Number(order.id),
          epicUsername: trimmedUsername,
          cardLast4: trimmedCard,
          gameLoginLink: trimmedLink,
          vbucksAmount: parsedVbucks,
          packCombination: packResult.value,
          orderStatus: "READY_FOR_TOPUP",
          unlockQueue: isMismatch || isEscalation,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || "Could not queue order for bot")
      }
      dirtyFieldsRef.current.clear()
      setNotice(
        isMismatch || isEscalation
          ? "Queued for bot (READY_FOR_TOPUP) and unlocked bot queue."
          : "Queued for bot (READY_FOR_TOPUP).",
      )
      await onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not queue order for bot")
    } finally {
      setBusyAction(null)
    }
  }

  async function handleRemoveFromQueue() {
    if (busyAction || !isQueued) return
    setBusyAction("unqueue")
    setError("")
    setNotice("")
    try {
      const response = await fetch("/api/entries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: Number(order.id),
          orderStatus: "In Progress",
          clearError: true,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || "Could not remove order from queue")
      }
      setNotice("Removed from bot queue.")
      await onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove order from queue")
    } finally {
      setBusyAction(null)
    }
  }

  async function handleResetStatus(
    targetStatus: "In Progress" | "READY_FOR_TOPUP",
    action: "reset" | "requeue",
  ) {
    if (busyAction) return
    setBusyAction(action)
    setError("")
    setNotice("")
    const shouldUnlock = isEscalation || (isMismatch && targetStatus === "READY_FOR_TOPUP")
    try {
      const response = await fetch("/api/entries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: Number(order.id),
          orderStatus: targetStatus,
          clearError: true,
          unlockQueue: shouldUnlock,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || "Could not reset order status")
      }
      dirtyFieldsRef.current.clear()
      setNotice(
        targetStatus === "READY_FOR_TOPUP"
          ? shouldUnlock
            ? "Returned to Ready for Top-Up and unlocked bot queue."
            : "Returned to Ready for Top-Up (READY_FOR_TOPUP)."
          : isEscalation
            ? "Escalation acknowledged and bot queue unlocked."
            : hasEpicSession
              ? "Reset to Authenticated."
              : "Reset to In Progress.",
      )
      await onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset order status")
    } finally {
      setBusyAction(null)
    }
  }

  const sendLabel = isQueued
    ? "Update Queue"
    : isMismatch || isEscalation
      ? "Re-send to Bot"
      : "Send to Bot"

  return (
    <div className="border-t border-border bg-background/40 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-primary">
          <Bot className="size-3.5" aria-hidden="true" />
          Bot Handoff Controls
        </div>
        {isProcessing && (
          <span className="inline-flex items-center gap-1.5 border border-primary/50 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
            <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Running on phone
          </span>
        )}
      </div>

      {isProcessing && (
        <p className="mb-3 border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          Bot claimed this order. If it could not start (for example, phone locked or ADB offline), reset it to{" "}
          {hasEpicSession ? "Authenticated" : "In Progress"} or return it to Ready for Top-Up without losing saved fields.
        </p>
      )}

      {(isMismatch || isEscalation || order.errorReason) && (
        <div
          role="alert"
          className={`mb-3 flex flex-wrap items-center justify-between gap-3 border-2 p-3 ${
            isEscalation
              ? "border-destructive bg-destructive/10"
              : "border-fee/70 bg-fee/10"
          }`}
        >
          <div className="min-w-0 flex-1">
            <p
              className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider ${
                isEscalation ? "text-destructive" : "text-fee"
              }`}
            >
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              {isEscalation
                ? "Hold Escalation — Manual Intervention Required"
                : isMismatch
                  ? "Username Mismatch — Update Link & Save Fields"
                  : "Bot Error"}
            </p>
            {order.errorReason && (
              <p className="mt-1 text-xs font-bold text-foreground">{order.errorReason}</p>
            )}
            {isEscalation && (
              <p className="mt-1 text-xs text-muted-foreground">
                Clicking Re-send to Bot or Acknowledge &amp; Unlock will automatically clear the global bot queue lock.
              </p>
            )}
          </div>
          {order.errorImageUrl && (
            <button
              type="button"
              onClick={() => setErrorPreviewOpen(true)}
              className="shrink-0 text-left"
            >
              <img
                src={order.errorImageUrl}
                alt={`Error screenshot for order ${order.u7buyOrderId || order.id}`}
                className="h-14 w-24 border border-border bg-background object-cover hover:opacity-85"
              />
            </button>
          )}
        </div>
      )}

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(150px,1fr)_100px_110px_minmax(140px,1fr)_minmax(220px,2fr)]">
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Epic Username
          <input
            type="text"
            value={epicUsername}
            disabled={isProcessing}
            onChange={(event) => {
              markDirty("epicUsername")
              setEpicUsername(event.target.value)
            }}
            placeholder="Epic display name"
            className="h-9 border-2 border-border bg-card px-2.5 text-xs font-bold text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary disabled:opacity-60"
          />
        </label>

        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Card Last 4
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={cardLast4}
            disabled={isProcessing}
            onChange={(event) => {
              markDirty("cardLast4")
              setCardLast4(event.target.value.replace(/\D/g, "").slice(0, 4))
            }}
            placeholder="1234"
            className="h-9 border-2 border-border bg-card px-2.5 text-xs font-bold text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary disabled:opacity-60"
          />
        </label>

        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          V-Bucks
          <input
            type="number"
            min={1}
            step={1}
            value={vbucksAmount}
            disabled={isProcessing}
            onChange={(event) => {
              markDirty("vbucksAmount")
              setVbucksAmount(event.target.value)
            }}
            placeholder="2800"
            className="h-9 border-2 border-border bg-card px-2.5 text-xs font-bold text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary disabled:opacity-60"
          />
        </label>

        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Pack Tiers (opt.)
          <input
            type="text"
            value={packCombination}
            disabled={isProcessing}
            onChange={(event) => {
              markDirty("packCombination")
              setPackCombination(event.target.value)
            }}
            placeholder={vbucksAmount ? `Auto: [${vbucksAmount}]` : "e.g. 1000, 1000"}
            className="h-9 border-2 border-border bg-card px-2.5 text-xs font-bold text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary disabled:opacity-60"
          />
        </label>

        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground sm:col-span-2 lg:col-span-1">
          Game Login Link
          <div className="flex gap-1.5">
            <input
              type="url"
              value={gameLoginLink}
              disabled={isProcessing}
              onChange={(event) => {
                markDirty("gameLoginLink")
                setGameLoginLink(event.target.value)
              }}
              placeholder="https://www.epicgames.com/id/exchange?..."
              className="h-9 min-w-0 flex-1 border-2 border-border bg-card px-2.5 text-xs font-bold text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary disabled:opacity-60"
            />
            {hasEpicSession && (
              <button
                type="button"
                disabled={busyAction !== null || isProcessing}
                onClick={handleGenerateLink}
                title="Generate a fresh Fortnite exchange login link from the saved Epic session"
                className="inline-flex h-9 shrink-0 items-center gap-1 border-2 border-border bg-card px-2.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busyAction === "link" ? (
                  <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <KeyRound className="size-3" aria-hidden="true" />
                )}
                Link
              </button>
            )}
          </div>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busyAction !== null || isProcessing}
          onClick={handleSendToBot}
          className="inline-flex items-center gap-1.5 border-2 border-primary bg-primary px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busyAction === "send" ? (
            <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Send className="size-3" aria-hidden="true" />
          )}
          {busyAction === "send" ? "Sending…" : sendLabel}
        </button>

        <button
          type="button"
          disabled={busyAction !== null || isProcessing}
          onClick={handleSaveFields}
          className="inline-flex items-center gap-1.5 border-2 border-border bg-background px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busyAction === "save" ? (
            <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Save className="size-3" aria-hidden="true" />
          )}
          {busyAction === "save" ? "Saving…" : "Save Fields"}
        </button>

        {isQueued && (
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={handleRemoveFromQueue}
            className="inline-flex items-center gap-1.5 border-2 border-border bg-background px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyAction === "unqueue" && (
              <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            )}
            Remove from Queue
          </button>
        )}

        {(isProcessing || isMismatch || isEscalation) && (
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => handleResetStatus("In Progress", "reset")}
            className={`inline-flex items-center gap-1.5 border-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              isEscalation
                ? "border-primary bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground"
                : "border-border bg-background text-foreground hover:border-primary hover:text-primary"
            }`}
          >
            {busyAction === "reset" ? (
              <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <RotateCcw className="size-3" aria-hidden="true" />
            )}
            {busyAction === "reset"
              ? isEscalation
                ? "Acknowledging…"
                : "Resetting…"
              : isEscalation
                ? "Acknowledge & Unlock"
                : hasEpicSession
                  ? "Reset to Authenticated"
                  : "Reset to In Progress"}
          </button>
        )}

        {isProcessing && (
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => handleResetStatus("READY_FOR_TOPUP", "requeue")}
            className="inline-flex items-center gap-1.5 border-2 border-primary bg-primary/15 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyAction === "requeue" ? (
              <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <RotateCcw className="size-3" aria-hidden="true" />
            )}
            {busyAction === "requeue" ? "Returning…" : "Back to Ready for Top-Up"}
          </button>
        )}

        {notice && (
          <span role="status" className="inline-flex items-center gap-1 text-xs font-bold text-primary">
            <Check className="size-3.5" aria-hidden="true" />
            {notice}
          </span>
        )}
        {error && (
          <span role="alert" className="text-xs font-bold text-destructive">
            {error}
          </span>
        )}
      </div>

      {order.errorImageUrl && errorPreviewOpen && (
        <dialog
          ref={errorDialogRef}
          onCancel={(event) => {
            event.preventDefault()
            setErrorPreviewOpen(false)
          }}
          className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl border-2 border-destructive bg-card p-0 text-foreground shadow-2xl backdrop:bg-background/85 backdrop:backdrop-blur-sm"
        >
          <div className="flex items-center justify-between border-b-2 border-border px-4 py-3">
            <span className="text-xs font-black uppercase tracking-wider text-destructive">
              Error Screenshot · Order {order.u7buyOrderId || order.id}
            </span>
            <button
              type="button"
              onClick={() => setErrorPreviewOpen(false)}
              className="border border-border p-1 text-muted-foreground hover:border-primary hover:text-foreground"
              aria-label="Close error screenshot preview"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <div className="p-4">
            <img
              src={order.errorImageUrl}
              alt={`Full size error screenshot for order ${order.u7buyOrderId || order.id}`}
              className="mx-auto max-h-[75vh] w-auto border border-border object-contain"
            />
          </div>
        </dialog>
      )}
    </div>
  )
}
