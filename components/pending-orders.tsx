"use client"

import { FormEvent, useEffect, useState } from "react"
import { Clock3, PackageCheck, Plus } from "lucide-react"
import type { Entry } from "@/lib/types"
import { currency } from "@/lib/types"

const COMPLETED_STATUSES = new Set(["completed", "cancelled", "delivered", "refunded"])
const ORDER_STATUS_OPTIONS = ["New Order Received", "Preparing", "Delivered", "Refunded"] as const

function statusTone(status: string) {
  if (status === "Awaiting Delivery" || status === "To Receive") {
    return "border-primary bg-primary/10 text-primary"
  }
  return "border-border bg-muted/40 text-muted-foreground"
}

export function PendingOrders({
  entries,
  presets,
  feeConfig,
  epicSessions,
  onChange,
}: {
  entries: Entry[]
  presets: { id: string; name: string; cost: number }[]
  feeConfig: Record<string, { name: string; percent: number; flat: number }>
  epicSessions?: {
    orderId: string
    displayName: string
    accountId?: string
    refreshTokenStored?: boolean
    accessTokenStored?: boolean
    tokenUpdatedAt?: string
    tokenExpiresAt?: string
    authLink?: string
    authLinkExpiresAt?: string
    authUserCode?: string
  }[]
  onChange: () => void
}) {
  const [productName, setProductName] = useState("")
  const [platform, setPlatform] = useState("")
  const [orderId, setOrderId] = useState("")
  const [amount, setAmount] = useState("")
  const selectedPreset = presets.find((preset) => preset.name === productName)
  const selectedFee = feeConfig[platform]
  const platformFee = selectedFee
    ? Number(amount || 0) * (selectedFee.percent / 100) + selectedFee.flat
    : 0
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState("")
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null)
  const [authLinkOrderId, setAuthLinkOrderId] = useState<string | null>(null)
  const [authUserCodes, setAuthUserCodes] = useState<Record<number, string>>({})
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const savedSessions = epicSessions ?? []
    setEpicAccounts(Object.fromEntries(savedSessions.map((session) => [Number(session.orderId), session.displayName])))
    setAuthUserCodes(Object.fromEntries(savedSessions.filter((session) => session.authUserCode).map((session) => [Number(session.orderId), session.authUserCode!])))
    setAuthLinks(Object.fromEntries(
      savedSessions
        .filter((session) => session.authLink && session.authLinkExpiresAt)
        .map((session) => [Number(session.orderId), { url: session.authLink!, expiresAt: new Date(session.authLinkExpiresAt!).getTime() }]),
    ))
  }, [epicSessions])
  const [authError, setAuthError] = useState("")
  const [epicAccounts, setEpicAccounts] = useState<Record<number, string>>(
    () => Object.fromEntries((epicSessions ?? []).map((session) => [Number(session.orderId), session.displayName])),
  )
  const [authLinks, setAuthLinks] = useState<Record<number, { url: string; expiresAt: number }>>(
    () => Object.fromEntries((epicSessions ?? []).filter((session) => session.authLink && session.authLinkExpiresAt).map((session) => [Number(session.orderId), { url: session.authLink!, expiresAt: new Date(session.authLinkExpiresAt!).getTime() }])),
  )
  const [exchangeLinks, setExchangeLinks] = useState<Record<number, string>>({})
  const orders = entries.filter(
    (entry) => entry.u7buyOrderId && entry.orderStatus && !COMPLETED_STATUSES.has(entry.orderStatus.trim().toLowerCase()),
  )

  async function handleExchangeCode(order: Entry) {
    setAuthError("")
    try {
      const response = await fetch("/api/epic/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      })
      const data = await response.json()
      if (!response.ok || !data.code) throw new Error(data.error || "Epic exchange failed")
      const link = `https://www.epicgames.com/id/exchange?exchangeCode=${encodeURIComponent(data.code)}&redirectUrl=https%3A%2F%2Fwww.epicgames.com%2Faccount`
      setExchangeLinks((current) => ({ ...current, [order.id]: link }))
      await navigator.clipboard.writeText(link)
      setCopiedOrderId(order.u7buyOrderId ?? null)
      window.setTimeout(() => setCopiedOrderId(null), 1800)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not generate the Epic exchange code.")
    }
  }

  async function handleOpenFortnite(order: Entry) {
    setAuthError("")
    try {
      const response = await fetch("/api/epic/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      })
      const data = await response.json()
      if (!response.ok || !data.code) throw new Error(data.error)
      const link = `https://www.epicgames.com/id/exchange?exchangeCode=${encodeURIComponent(data.code)}&redirectUrl=https%3A%2F%2Fwww.epicgames.com%2Fid%2Flogin%3Fclient_id%3D3f69e56c7649492c8cc29f1af08a8a12%26response_type%3Dcode%26display%3Dpopup%2520guided`
      setExchangeLinks((current) => ({ ...current, [order.id]: link }))
      window.open(link, "_blank", "noopener,noreferrer")
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not open Fortnite with a fresh Epic exchange link.")
    }
  }

  async function handleStatusChange(order: Entry, orderStatus: string) {
    const response = await fetch("/api/entries", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: order.id, orderStatus }),
    })
    if (response.ok) {
      onChange()
    } else {
      setError("Could not update the order status. Please try again.")
    }
  }

  async function handleGenerateLoginLink(order: Entry) {
    if (!order.u7buyOrderId) return
    setAuthError("")
    setAuthLinkOrderId(order.u7buyOrderId)
    try {
      const response = await fetch("/api/epic/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      })
      const data = await response.json()
      if (!response.ok || !data.verification_uri_complete || !data.device_code) throw new Error(data.error)
      const expiresAt = Date.now() + Number(data.expires_in || 600) * 1000
      setAuthUserCodes((current) => ({ ...current, [order.id]: data.user_code }))
      setAuthLinks((current) => ({ ...current, [order.id]: { url: data.verification_uri_complete, expiresAt } }))
      await navigator.clipboard.writeText(data.verification_uri_complete)
      window.open(data.verification_uri_complete, "_blank", "noopener,noreferrer")
      setCopiedOrderId(order.u7buyOrderId)
      window.setTimeout(() => setCopiedOrderId(null), 1800)

      const interval = Math.max(Number(data.interval || 5), 3) * 1000
      const deadline = Date.now() + 5 * 60 * 1000
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, interval))
        const statusResponse = await fetch("/api/epic/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: order.id, deviceCode: data.device_code }),
        })
        const status = await statusResponse.json()
        if (status.status === "pending") continue
        if (!statusResponse.ok || status.status === "error") {
          throw new Error(status.error || "Epic authorization was not completed")
        }
        if (status.status === "completed") {
          setEpicAccounts((current) => ({ ...current, [order.id]: status.displayName || "Epic account" }))
          setAuthError("")
          onChange()
          break
        }
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not complete Epic authorization.")
    } finally {
      setAuthLinkOrderId(null)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const numericAmount = Number(amount)
    if (!productName.trim() || !platform || !orderId.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Select a product and platform, then enter an order ID and positive amount.")
      return
    }

    setIsSaving(true)
    setError("")
    try {
      const response = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: productName.trim(),
          platform: selectedFee?.name ?? platform,
          date: new Date().toISOString().slice(0, 10),
          earned: 0,
          paid: 0,
          profit: 0,
          orderAmount: numericAmount,
          orderCost: selectedPreset?.cost ?? 0,
          orderFee: platformFee,
          orderStatus: "New Order Received",
          u7buyOrderId: orderId.trim(),
        }),
      })
      if (!response.ok) throw new Error("Unable to save order")
      setProductName("")
      setOrderId("")
      setAmount("")
      onChange()
    } catch {
      setError("Could not create the order. Please try again.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="border-2 border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-border px-5 py-4">
        <div>
          <h2 className="font-display text-xl font-black uppercase tracking-tight">orders</h2>
          <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
            orders that need attention
          </p>
        </div>
        <span className="border-2 border-primary px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
          {orders.length} {orders.length === 1 ? "order" : "orders"}
        </span>
      </div>

      <form onSubmit={handleSubmit} className="border-b-2 border-border bg-background/40 px-5 py-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
          <Plus className="size-4" aria-hidden="true" />
          add new order
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_180px_auto] sm:items-end">
          <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Product name
            <select
              value={productName}
              onChange={(event) => setProductName(event.target.value)}
              className="h-10 border-2 border-border bg-card px-3 text-sm font-bold tracking-normal text-foreground outline-none focus:border-primary"
            >
              <option value="">Select a saved product</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.name}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Platform
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value)}
              className="h-10 border-2 border-border bg-card px-3 text-sm font-bold tracking-normal text-foreground outline-none focus:border-primary"
            >
              <option value="">Select a platform</option>
              {Object.entries(feeConfig).map(([key, fee]) => (
                <option key={key} value={key}>{fee.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Order ID
            <input
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
              placeholder="e.g. U7-1042"
              className="h-10 border-2 border-border bg-card px-3 text-sm font-bold tracking-normal text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Amount (USD)
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              className="h-10 border-2 border-border bg-card px-3 text-sm font-bold tracking-normal text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary"
            />
          </label>
          <button
            type="submit"
            disabled={isSaving}
            className="h-10 border-[2px] border-primary bg-primary px-4 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Add order"}
          </button>
        </div>
        {error && <p className="mt-2 text-xs font-bold text-destructive">{error}</p>}
      </form>

      {authError && <p className="border-b-2 border-border px-5 py-3 text-xs font-bold text-destructive">{authError}</p>}

      {orders.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
          <PackageCheck className="size-8 text-primary" aria-hidden="true" />
          <p className="text-sm font-bold uppercase tracking-wider text-muted-foreground">No pending orders</p>
          <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
            New U7Buy orders will appear here automatically when they arrive.
          </p>
        </div>
      ) : (
        <div className="divide-y-2 divide-border">
          {orders.map((order) => (
            <article key={order.id} className="grid gap-4 px-5 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate font-bold text-foreground">{order.service}</h3>
                  <span className="border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {order.platform}
                  </span>
                </div>
                <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
                  Order {order.u7buyOrderId} · {order.date}
                </p>
                {epicAccounts[order.id] && (
                  <p className="mt-2 text-xs font-bold uppercase tracking-wider text-primary">
                    Epic: {epicAccounts[order.id]}
                  </p>
                )}
                {(() => {
                  const epicSession = epicSessions?.find((session) => Number(session.orderId) === order.id)
                  return epicSession ? (
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Refresh token: {epicSession.refreshTokenStored ? "stored" : "missing"} · Access token: {epicSession.accessTokenStored ? "stored" : "missing"}
                    </p>
                  ) : null
                })()}
                <div className="mt-3 flex flex-col items-start gap-2">
                  {epicAccounts[order.id] ? (
                    <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <span>Authenticated as {epicAccounts[order.id]}</span>
                      {authUserCodes[order.id] && <span>User code: {authUserCodes[order.id]}</span>}
                      <button type="button" onClick={() => handleGenerateLoginLink(order)} className="border-2 border-border px-3 py-1.5 text-foreground transition-colors hover:border-primary hover:text-primary">
                        Regenerate auth link
                      </button>
                    </div>
                  ) : (() => {
                    const savedLink = authLinks[order.id]
                    const linkIsActive = Boolean(savedLink && savedLink.expiresAt > now)
                    return linkIsActive ? (
                      <div className="flex w-full max-w-xl gap-2">
                        <input readOnly value={savedLink.url} className="min-w-0 flex-1 border-2 border-border bg-background px-3 py-1.5 text-[10px] text-muted-foreground outline-none" aria-label={`Epic auth link for order ${order.u7buyOrderId}`} />
                        <button type="button" onClick={async () => { await navigator.clipboard.writeText(savedLink.url); setCopiedOrderId(order.u7buyOrderId ?? null); window.setTimeout(() => setCopiedOrderId(null), 1800) }} className="border-2 border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary">
                          {copiedOrderId === order.u7buyOrderId ? "Copied" : "Copy"}
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-start gap-1">
                        {savedLink && <span className="text-[10px] font-bold uppercase tracking-wider text-destructive">Link expired, generate a new one</span>}
                        <button type="button" onClick={() => handleGenerateLoginLink(order)} className="border-2 border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary">
                          {authLinkOrderId === order.u7buyOrderId ? "Generating..." : "Generate Epic auth link"}
                        </button>
                      </div>
                    )
                  })()}
                  {epicAccounts[order.id] && (
                    <>
                      <div className="flex w-full max-w-xl gap-2">
                        <input
                          readOnly
                          value={exchangeLinks[order.id] || "Generate an exchange code link"}
                          className="min-w-0 flex-1 border-2 border-border bg-background px-3 py-1.5 text-[10px] text-muted-foreground outline-none"
                          aria-label={`Epic exchange link for order ${order.u7buyOrderId}`}
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            if (!exchangeLinks[order.id]) return
                            await navigator.clipboard.writeText(exchangeLinks[order.id])
                            setCopiedOrderId(order.u7buyOrderId ?? null)
                            window.setTimeout(() => setCopiedOrderId(null), 1800)
                          }}
                          disabled={!exchangeLinks[order.id]}
                          className="border-2 border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                        >
                          {copiedOrderId === order.u7buyOrderId ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleExchangeCode(order)}
                          className="border-2 border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary"
                        >
                          Generate exchange code link
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenFortnite(order)}
                          className="border-2 border-primary bg-primary px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
                        >
                          Open Fortnite
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                <Clock3 className="size-3.5" aria-hidden="true" />
                <label className="sr-only" htmlFor={`order-status-${order.id}`}>
                  Status for order {order.u7buyOrderId}
                </label>
                <select
                  id={`order-status-${order.id}`}
                  value={order.orderStatus || "Preparing"}
                  onChange={(event) => handleStatusChange(order, event.target.value)}
                  className={`border px-2 py-1 font-bold uppercase tracking-wider outline-none ${statusTone(order.orderStatus || "")}`}
                >
                  {ORDER_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-right font-display text-lg font-black text-primary">{currency(order.earned)}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export function pendingOrderCount(entries: Entry[]) {
  return entries.filter(
    (entry) => entry.u7buyOrderId && entry.orderStatus && !COMPLETED_STATUSES.has(entry.orderStatus.trim().toLowerCase()),
  ).length
}
