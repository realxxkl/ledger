"use client"

import { FormEvent, useEffect, useState } from "react"
import Link from "next/link"
import { Clock3, PackageCheck, Plus, Search } from "lucide-react"
import type { Entry } from "@/lib/types"
import { currency } from "@/lib/types"

const COMPLETED_STATUSES = new Set(["completed", "cancelled", "delivered", "refunded"])
const ORDER_STATUS_OPTIONS = ["In Progress", "Completed", "Refunded"] as const

export function getOrderStatusGroup(status?: string) {
  const normalized = (status ?? "").trim().toLowerCase()
  if (normalized === "refunded") return "Refunded"
  if (normalized === "completed" || normalized === "delivered") return "Completed"
  return "In Progress"
}

function statusTone(status: string) {
  if (status === "In Progress") return "border-primary bg-primary/10 text-primary"
  return "border-border bg-muted/40 text-muted-foreground"
}

export function PendingOrders({
  entries,
  presets,
  feeConfig,
  epicSessions,
  onChange,
  focusedOrderId,
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
  focusedOrderId?: string
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
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<(typeof ORDER_STATUS_OPTIONS)[number]>("In Progress")
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
  const [fortniteLoginLinks, setFortniteLoginLinks] = useState<Record<number, string>>({})
  const orders = entries.filter((entry) => {
    if (!entry.u7buyOrderId) return false
    if (focusedOrderId) return entry.id === focusedOrderId
    if ((entry.orderStatus ?? "").trim().toLowerCase() === "cancelled") return false
    if (getOrderStatusGroup(entry.orderStatus) !== statusFilter) return false
    const query = search.trim().toLowerCase()
    return !query || [entry.u7buyOrderId, entry.service, entry.platform, entry.orderStatus].some((value) => value?.toLowerCase().includes(query))
  })

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
      setExchangeLinks((current) => ({ ...current, [Number(order.id)]: link }))
      await navigator.clipboard.writeText(link)
      setCopiedOrderId(order.u7buyOrderId ?? null)
      window.setTimeout(() => setCopiedOrderId(null), 1800)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not generate the Epic exchange code.")
    }
  }

  async function handleCopyFortniteLoginLink(order: Entry) {
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
      setFortniteLoginLinks((current) => ({ ...current, [Number(order.id)]: link }))
      await navigator.clipboard.writeText(link)
      setCopiedOrderId(order.u7buyOrderId ?? null)
      window.setTimeout(() => setCopiedOrderId(null), 1800)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not generate the Fortnite login link.")
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
      setAuthUserCodes((current) => ({ ...current, [Number(order.id)]: data.user_code }))
      setAuthLinks((current) => ({ ...current, [Number(order.id)]: { url: data.verification_uri_complete, expiresAt } }))
      await navigator.clipboard.writeText(data.verification_uri_complete)
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
          setEpicAccounts((current) => ({ ...current, [Number(order.id)]: status.displayName || "Epic account" }))
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
      {!focusedOrderId && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-border px-5 py-4">
          <div>
            <h2 className="font-display text-xl font-black uppercase tracking-tight">orders</h2>
            <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">active order fulfillment</p>
          </div>
          <span className="border-2 border-primary px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
            {orders.length} {orders.length === 1 ? "order" : "orders"}
          </span>
        </div>
      )}
      {focusedOrderId && <h3 className="border-b-2 border-border px-5 py-4 font-display text-lg font-black uppercase tracking-tight">Order fulfillment</h3>}

      {!focusedOrderId && <form onSubmit={handleSubmit} className="border-b-2 border-border bg-background/40 px-5 py-4">
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
      </form>}

      {!focusedOrderId && <div className="flex flex-wrap items-center gap-3 border-b-2 border-border px-5 py-3">
        <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Sort by status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as (typeof ORDER_STATUS_OPTIONS)[number])} className="h-10 border-2 border-border bg-background px-3 text-sm font-bold text-foreground outline-none focus:border-primary">
            {ORDER_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <Search className="size-4 text-muted-foreground" aria-hidden="true" />
        <label className="sr-only" htmlFor="order-search">Search orders</label>
        <input id="order-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order ID, product, platform, or status" className="h-10 min-w-0 flex-1 border-2 border-border bg-background px-3 text-sm outline-none focus:border-primary" />
      </div>}

      {authError && <p className="border-b-2 border-border px-5 py-3 text-xs font-bold text-destructive">{authError}</p>}

      {orders.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
          <PackageCheck className="size-8 text-primary" aria-hidden="true" />
          <p className="text-sm font-bold uppercase tracking-wider text-muted-foreground">{search ? "No matching orders" : "No orders yet"}</p>
          <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
            {search ? "Try another order ID, product, platform, or status." : "New U7Buy orders will appear here automatically when they arrive."}
          </p>
        </div>
      ) : (
        <div className="divide-y-2 divide-border">
          {orders.map((order) => (
            <article key={order.id} className="grid gap-4 px-5 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/orders/${order.id}`} className="truncate font-bold text-foreground underline decoration-border underline-offset-4 hover:text-primary">{order.service}</Link>
                  <span className="border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {order.platform}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                  <span>Order {order.u7buyOrderId}</span>
                  <span aria-hidden="true">·</span>
                  <span>{order.date}</span>
                </div>
                {focusedOrderId && (
                  <p className="mt-2 text-xs font-bold uppercase tracking-wider text-primary">
                    Epic: {epicAccounts[Number(order.id)] || "unauthenticated"}
                  </p>
                )}
                {(() => {
                  const epicSession = epicSessions?.find((session) => Number(session.orderId) === Number(order.id))
                  return focusedOrderId && epicSession ? (
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Refresh token: {epicSession.refreshTokenStored ? "stored" : "missing"} · Access token: {epicSession.accessTokenStored ? "stored" : "missing"}
                    </p>
                  ) : null
                })()}
                {focusedOrderId && <div className="mt-3 flex flex-col items-start gap-2">
                  {["completed", "delivered"].includes((order.orderStatus ?? "").toLowerCase()) ? (
                    <p className="text-xs font-bold text-primary">Epic access has been revoked and purged.</p>
                  ) : <>
                  {epicAccounts[Number(order.id)] ? (
                    <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <span>Authenticated as {epicAccounts[Number(order.id)]}</span>
                      {authUserCodes[Number(order.id)] && <span>User code: {authUserCodes[Number(order.id)]}</span>}
                      <button type="button" onClick={() => handleGenerateLoginLink(order)} className="border-2 border-border px-3 py-1.5 text-foreground transition-colors hover:border-primary hover:text-primary">
                        Regenerate auth link
                      </button>
                    </div>
                  ) : (() => {
                    const savedLink = authLinks[Number(order.id)]
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
                  {epicAccounts[Number(order.id)] && (
                    <>
                      <div className="flex w-full max-w-xl gap-2">
                        <input
                          readOnly
                          value={exchangeLinks[Number(order.id)] || "Generate an exchange code link"}
                          className="min-w-0 flex-1 border-2 border-border bg-background px-3 py-1.5 text-[10px] text-muted-foreground outline-none"
                          aria-label={`Epic exchange link for order ${order.u7buyOrderId}`}
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            if (!exchangeLinks[Number(order.id)]) return
                            await navigator.clipboard.writeText(exchangeLinks[Number(order.id)])
                            setCopiedOrderId(order.u7buyOrderId ?? null)
                            window.setTimeout(() => setCopiedOrderId(null), 1800)
                          }}
                          disabled={!exchangeLinks[Number(order.id)]}
                          className="border-2 border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                        >
                          {copiedOrderId === order.u7buyOrderId ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <div className="flex w-full max-w-xl gap-2">
                        <input
                          readOnly
                          value={fortniteLoginLinks[Number(order.id)] || "Generate a Fortnite login link"}
                          className="min-w-0 flex-1 border-2 border-border bg-background px-3 py-1.5 text-[10px] text-muted-foreground outline-none"
                          aria-label={`Fortnite login link for order ${order.u7buyOrderId}`}
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            if (!fortniteLoginLinks[Number(order.id)]) return
                            await navigator.clipboard.writeText(fortniteLoginLinks[Number(order.id)])
                            setCopiedOrderId(order.u7buyOrderId ?? null)
                            window.setTimeout(() => setCopiedOrderId(null), 1800)
                          }}
                          disabled={!fortniteLoginLinks[Number(order.id)]}
                          className="border-2 border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                        >
                          {copiedOrderId === order.u7buyOrderId ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => handleExchangeCode(order)} className="border-2 border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary">
                          Generate &amp; copy exchange code link
                        </button>
                        <button type="button" onClick={() => handleCopyFortniteLoginLink(order)} className="border-2 border-primary bg-primary px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90">
                          Generate &amp; copy Fortnite login link
                        </button>
                      </div>
                    </>
                  )}
                  </>}
                </div>}
              </div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                {focusedOrderId ? (
                  <>
                    <Clock3 className="size-3.5" aria-hidden="true" />
                    <label className="sr-only" htmlFor={`order-status-${order.id}`}>Status for order {order.u7buyOrderId}</label>
                    <select
                      id={`order-status-${order.id}`}
                      value={getOrderStatusGroup(order.orderStatus)}
                      onChange={(event) => handleStatusChange(order, event.target.value)}
                      className={`border px-2 py-1 font-bold uppercase tracking-wider outline-none ${statusTone(getOrderStatusGroup(order.orderStatus))}`}
                    >
                      {ORDER_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </>
                ) : (
                  <span className={`border px-2 py-1 font-bold uppercase tracking-wider ${statusTone(getOrderStatusGroup(order.orderStatus))}`}>
                    {getOrderStatusGroup(order.orderStatus)}
                  </span>
                )}
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
