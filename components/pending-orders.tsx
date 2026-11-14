"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Check, LoaderCircle, PackageCheck, Plus, Search } from "lucide-react"
import type { Entry } from "@/lib/types"
import { currency } from "@/lib/types"
import { ConfirmOrderCompletionDialog } from "@/components/confirm-order-completion-dialog"

const COMPLETED_STATUSES = new Set(["completed", "cancelled", "delivered", "refunded"])
const ORDER_STATUS_OPTIONS = ["In Progress", "Completed", "Refunded"] as const
function formatRemainingTime(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

export function getOrderStatusGroup(status?: string) {
  const normalized = (status ?? "").trim().toLowerCase()
  if (normalized === "refunded") return "Refunded"
  if (normalized === "completed" || normalized === "delivered") return "Completed"
  return "In Progress"
}

export function getOrderStatusLabel(status: string | undefined, authenticated: boolean) {
  const group = getOrderStatusGroup(status)
  return group === "In Progress" ? (authenticated ? "Authenticated" : "Unauthenticated") : group
}

function statusTone(status: string) {
  if (status === "In Progress" || status === "Unauthenticated" || status === "Authenticated") return "border-primary bg-primary/10 text-primary"
  return "border-border bg-muted/40 text-muted-foreground"
}

function orderProfit(order: Entry) {
  const status = getOrderStatusGroup(order.orderStatus)
  if (status === "In Progress") return (order.orderAmount ?? 0) - (order.orderCost ?? 0) - (order.orderFee ?? 0)
  return status === "Refunded" ? 0 : order.profit
}

function OrderSuccessCelebration({ title, description }: { title: string; description: string }) {
  return (
    <div className="account-stored-celebration" role="status" aria-live="polite">
      <div className="account-stored-celebration__icon" aria-hidden="true"><Check className="account-stored-celebration__check size-4" /></div>
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="account-stored-celebration__confetti" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <span key={index} className="account-stored-celebration__particle" style={{ left: `${index * 8 + 4}%`, animationDelay: `${(index % 4) * 75}ms` }} />
        ))}
      </div>
    </div>
  )
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
  onChange: () => void | Promise<unknown>
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
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null)
  const [updatingOrderStatus, setUpdatingOrderStatus] = useState<"Completed" | "Refunded" | null>(null)
  const [completionConfirmOrder, setCompletionConfirmOrder] = useState<Entry | null>(null)
  const [error, setError] = useState("")
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null)
  const [copyingOrderId, setCopyingOrderId] = useState<string | null>(null)
  const [celebration, setCelebration] = useState<{ orderId: string; type: "account" | "completed" } | null>(null)
  const [celebrationCollapsing, setCelebrationCollapsing] = useState(false)
  const celebrationTimer = useRef<number | null>(null)
  const [exchangeBusyOrderId, setExchangeBusyOrderId] = useState<string | null>(null)
  const [fortniteBusyOrderId, setFortniteBusyOrderId] = useState<string | null>(null)
  const [generatingAuthLinkOrderId, setGeneratingAuthLinkOrderId] = useState<string | null>(null)
  const activeAuthOrderIdRef = useRef<string | null>(null)
  const [expiredAuthLinks, setExpiredAuthLinks] = useState<Record<number, boolean>>({})
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<(typeof ORDER_STATUS_OPTIONS)[number]>("In Progress")
  const [authUserCodes, setAuthUserCodes] = useState<Record<number, string>>({})
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      window.clearInterval(timer)
      if (celebrationTimer.current !== null) window.clearTimeout(celebrationTimer.current)
    }
  }, [])
  useEffect(() => {
    const savedSessions = epicSessions ?? []
    setEpicAccounts(Object.fromEntries(savedSessions.filter((session) => session.accessTokenStored).map((session) => [Number(session.orderId), session.displayName])))
    setAuthUserCodes(Object.fromEntries(savedSessions.filter((session) => session.authUserCode).map((session) => [Number(session.orderId), session.authUserCode!])))
    const expiredSessions = savedSessions.filter((session) => session.authLink && session.authLinkExpiresAt && new Date(session.authLinkExpiresAt).getTime() <= Date.now())
    setExpiredAuthLinks(Object.fromEntries(expiredSessions.map((session) => [Number(session.orderId), true])))
    setAuthLinks(Object.fromEntries(
      savedSessions
        .filter((session) => session.authLink && session.authLinkExpiresAt && new Date(session.authLinkExpiresAt).getTime() > Date.now())
        .map((session) => [Number(session.orderId), { url: session.authLink!, expiresAt: new Date(session.authLinkExpiresAt!).getTime() }]),
    ))
  }, [epicSessions])
  const [authError, setAuthError] = useState("")
  const [balanceWarning, setBalanceWarning] = useState("")
  const [balanceSyncError, setBalanceSyncError] = useState("")
  const [refreshingBalanceOrderId, setRefreshingBalanceOrderId] = useState<string | null>(null)
  const [epicAccounts, setEpicAccounts] = useState<Record<number, string>>(
    () => Object.fromEntries((epicSessions ?? []).filter((session) => session.accessTokenStored).map((session) => [Number(session.orderId), session.displayName])),
  )
  const [authLinks, setAuthLinks] = useState<Record<number, { url: string; expiresAt: number }>>(
    () => Object.fromEntries((epicSessions ?? []).filter((session) => session.authLink && session.authLinkExpiresAt && new Date(session.authLinkExpiresAt).getTime() > Date.now()).map((session) => [Number(session.orderId), { url: session.authLink!, expiresAt: new Date(session.authLinkExpiresAt!).getTime() }])),
  )
  useEffect(() => {
    const expiredIds = Object.entries(authLinks).filter(([, link]) => link.expiresAt <= now).map(([id]) => Number(id))
    if (expiredIds.length === 0) return
    setAuthLinks((current) => {
      const next = { ...current }
      expiredIds.forEach((id) => delete next[id])
      return next
    })
    setExpiredAuthLinks((current) => ({ ...current, ...Object.fromEntries(expiredIds.map((id) => [id, true])) }))
  }, [authLinks, now])
  const [exchangeLinks, setExchangeLinks] = useState<Record<number, string>>({})
  const [fortniteLoginLinks, setFortniteLoginLinks] = useState<Record<number, string>>({})
  async function copyOrderLink(order: Entry, link: string) {
    if (!link) return
    setCopyingOrderId(order.id)
    setAuthError("")
    try {
      await navigator.clipboard.writeText(link)
      setCopiedOrderId(order.u7buyOrderId ?? null)
      window.setTimeout(() => setCopiedOrderId(null), 1800)
    } catch {
      setAuthError("Could not copy the link. Check your browser clipboard permissions.")
    } finally {
      setCopyingOrderId(null)
    }
  }

  function showCelebration(orderId: string, type: "account" | "completed") {
    setCelebration({ orderId, type })
    setCelebrationCollapsing(false)
    if (celebrationTimer.current !== null) window.clearTimeout(celebrationTimer.current)
    celebrationTimer.current = window.setTimeout(() => {
      setCelebrationCollapsing(true)
      celebrationTimer.current = window.setTimeout(() => {
        setCelebration(null)
        setCelebrationCollapsing(false)
        celebrationTimer.current = null
      }, 360)
    }, 2600)
  }

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
    setExchangeBusyOrderId(order.id)
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
    } finally {
      setExchangeBusyOrderId(null)
    }
  }

  async function handleCopyFortniteLoginLink(order: Entry) {
    setAuthError("")
    setFortniteBusyOrderId(order.id)
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
    } finally {
      setFortniteBusyOrderId(null)
    }
  }

  async function handleStatusChange(order: Entry, orderStatus: "Completed" | "Refunded") {
    setUpdatingOrderId(order.id)
    setUpdatingOrderStatus(orderStatus)
    setError("")
    try {
      const response = await fetch("/api/entries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: order.id, orderStatus }),
      })
      if (!response.ok) {
        const result = await response.json().catch(() => null)
        throw new Error(result?.error || "Could not update the order status. Please try again.")
      }
      if (orderStatus === "Refunded" && activeAuthOrderIdRef.current === order.u7buyOrderId) {
        activeAuthOrderIdRef.current = null
        setGeneratingAuthLinkOrderId(null)
      }
      await onChange()
      if (orderStatus === "Completed") showCelebration(order.id, "completed")
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not update the order status. Please try again.")
    } finally {
      setUpdatingOrderId(null)
      setUpdatingOrderStatus(null)
    }
  }

  async function confirmCompletion() {
    if (!completionConfirmOrder) return
    const order = completionConfirmOrder
    setCompletionConfirmOrder(null)
    await handleStatusChange(order, "Completed")
  }

  async function handleRefreshBalance(order: Entry) {
    setRefreshingBalanceOrderId(order.id)
    setBalanceSyncError("")
    try {
      const response = await fetch(`/api/orders/${order.id}/sync-balance`, { method: "POST" })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Could not refresh the Epic balance")
      await onChange()
    } catch (error) {
      setBalanceSyncError(error instanceof Error ? error.message : "Could not refresh the Epic balance")
    } finally {
      setRefreshingBalanceOrderId(null)
    }
  }

  async function handleGenerateLoginLink(order: Entry) {
    if (!order.u7buyOrderId) return
    setAuthError("")
    setBalanceWarning("")
    activeAuthOrderIdRef.current = order.u7buyOrderId
    setGeneratingAuthLinkOrderId(order.u7buyOrderId)
    try {
      const response = await fetch("/api/epic/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      })
      const data = await response.json()
      if (!response.ok || !data.verification_uri_complete || !data.device_code) throw new Error(data.error)
      const expiresInSeconds = Math.min(Math.max(Number(data.expires_in) || 300, 1), 300)
      const expiresAt = Date.now() + expiresInSeconds * 1000
      setExpiredAuthLinks((current) => ({ ...current, [Number(order.id)]: false }))
      setAuthUserCodes((current) => ({ ...current, [Number(order.id)]: data.user_code }))
      setAuthLinks((current) => ({ ...current, [Number(order.id)]: { url: data.verification_uri_complete, expiresAt } }))
      await navigator.clipboard.writeText(data.verification_uri_complete)
      setCopiedOrderId(order.u7buyOrderId)
      window.setTimeout(() => setCopiedOrderId(null), 1800)
      setGeneratingAuthLinkOrderId(null)

      const interval = Math.max(Number(data.interval || 5), 3) * 1000
      while (Date.now() < expiresAt && activeAuthOrderIdRef.current === order.u7buyOrderId) {
        await new Promise((resolve) => window.setTimeout(resolve, interval))
        if (activeAuthOrderIdRef.current !== order.u7buyOrderId) break
        const statusResponse = await fetch("/api/epic/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: order.id, deviceCode: data.device_code }),
        })
        const status = await statusResponse.json()
        if (activeAuthOrderIdRef.current !== order.u7buyOrderId) break
        if (status.status === "pending") continue
        if (!statusResponse.ok || status.status === "error") {
          throw new Error(status.error || "Epic authorization was not completed")
        }
        if (status.status === "completed") {
          setEpicAccounts((current) => ({ ...current, [Number(order.id)]: status.displayName || "Epic account" }))
          setBalanceWarning(status.balanceWarning || "")
          setAuthError("")
          activeAuthOrderIdRef.current = null
          setGeneratingAuthLinkOrderId(null)
          setAuthLinks((current) => {
            const next = { ...current }
            delete next[Number(order.id)]
            return next
          })
          showCelebration(order.id, "account")
          await onChange()
          break
        }
      }
      if (activeAuthOrderIdRef.current === order.u7buyOrderId) {
        activeAuthOrderIdRef.current = null
        setGeneratingAuthLinkOrderId(null)
        setAuthLinks((current) => {
          const next = { ...current }
          delete next[Number(order.id)]
          return next
        })
        setExpiredAuthLinks((current) => ({ ...current, [Number(order.id)]: true }))
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not complete Epic authorization.")
    } finally {
      if (activeAuthOrderIdRef.current === order.u7buyOrderId) {
        activeAuthOrderIdRef.current = null
        setGeneratingAuthLinkOrderId(null)
      }
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
      await onChange()
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
            className="flex h-10 items-center justify-center gap-2 border-[2px] border-primary bg-primary px-4 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving && <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {isSaving ? "Saving…" : "Add order"}
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
      {balanceWarning && <p className="border-b-2 border-border px-5 py-3 text-xs font-bold text-amber-700">{balanceWarning}</p>}
      {balanceSyncError && <p role="alert" className="border-b-2 border-border px-5 py-3 text-xs font-bold text-destructive">{balanceSyncError}</p>}

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
            <article key={order.id} className={focusedOrderId ? "grid gap-5 px-5 py-5 md:grid-cols-[minmax(0,1fr)_minmax(280px,auto)] md:items-center" : "grid gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"}>
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
                {celebration?.orderId === order.id && (
                  <div className={`mt-4 grid overflow-hidden transition-[grid-template-rows,margin,opacity] duration-300 ease-in motion-reduce:transition-none ${celebrationCollapsing ? "mt-0 grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]"}`} aria-hidden={celebrationCollapsing || undefined}>
                    <div className="min-h-0 overflow-hidden">
                      <OrderSuccessCelebration
                        title={celebration.type === "account" ? "Account authenticated" : "Order completed"}
                        description={celebration.type === "account" ? "Epic account verified and securely stored for this order." : "Fulfillment is complete and the final profit is recorded."}
                      />
                    </div>
                  </div>
                )}
                {focusedOrderId && <div className="mt-4 grid w-full max-w-2xl gap-3 border-l-2 border-primary/50 pl-4">
                  {["completed", "delivered", "refunded"].includes((order.orderStatus ?? "").trim().toLowerCase()) ? (
                    <p className="text-xs font-bold text-primary">{getOrderStatusGroup(order.orderStatus) === "Refunded" ? "Order refunded. Epic authorization is no longer needed." : "Epic access has been revoked and purged."}</p>
                  ) : <>
                  {epicAccounts[Number(order.id)] ? (
                    <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5 border border-primary/50 bg-primary/10 px-2 py-1 text-primary"><Check className="size-3" aria-hidden="true" />Authenticated as {epicAccounts[Number(order.id)]}</span>
                      {order.vbucksBefore !== undefined && (
                        <span className="inline-flex items-center border border-primary/50 bg-primary/10 px-2 py-1 text-primary">
                          Current balance: {order.vbucksBefore} VBucks
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={refreshingBalanceOrderId === order.id}
                        onClick={() => handleRefreshBalance(order)}
                        className="inline-flex items-center gap-1.5 border border-border px-2 py-1 transition-colors hover:border-primary hover:text-primary disabled:cursor-wait disabled:opacity-60"
                      >
                        {refreshingBalanceOrderId === order.id && <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                        {order.vbucksBefore === undefined ? "Fetch balance" : "Refresh balance"}
                      </button>
                      {authUserCodes[Number(order.id)] && <span>User code: {authUserCodes[Number(order.id)]}</span>}
                      <button type="button" disabled={generatingAuthLinkOrderId === order.u7buyOrderId} onClick={() => handleGenerateLoginLink(order)} className="inline-flex items-center gap-2 border-2 border-border px-3 py-1.5 text-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-wait disabled:opacity-60">
                        {generatingAuthLinkOrderId === order.u7buyOrderId && <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                        Regenerate auth link
                      </button>
                    </div>
                  ) : (() => {
                    const savedLink = authLinks[Number(order.id)]
                    const linkIsActive = Boolean(savedLink && savedLink.expiresAt > now)
                    return linkIsActive ? (
                      <div className="flex w-full max-w-xl gap-2">
                        <input readOnly value={savedLink.url} className="min-w-0 flex-1 border-2 border-border bg-background px-3 py-1.5 text-[10px] text-muted-foreground outline-none" aria-label={`Epic auth link for order ${order.u7buyOrderId}`} />
                        <button type="button" disabled={copyingOrderId === order.id} onClick={() => copyOrderLink(order, savedLink.url)} className="inline-flex items-center gap-2 border-2 border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-wait disabled:opacity-60">
                          {copyingOrderId === order.id && <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                          {copyingOrderId === order.id ? "Copying…" : copiedOrderId === order.u7buyOrderId ? "Copied" : "Copy"}
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-start gap-1">
                        {(expiredAuthLinks[Number(order.id)] || (savedLink && savedLink.expiresAt <= now)) && <span className="text-[10px] font-bold uppercase tracking-wider text-destructive">Link expired, generate a new one</span>}
                        <button type="button" disabled={generatingAuthLinkOrderId === order.u7buyOrderId} onClick={() => handleGenerateLoginLink(order)} className="inline-flex items-center gap-2 border-2 border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-wait disabled:opacity-60">
                          {generatingAuthLinkOrderId === order.u7buyOrderId && <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                          {generatingAuthLinkOrderId === order.u7buyOrderId ? "Generating…" : "Generate Epic auth link"}
                        </button>
                      </div>
                    )
                  })()}
                  {!epicAccounts[Number(order.id)] &&
                    authLinks[Number(order.id)]?.expiresAt > now &&
                    authUserCodes[Number(order.id)] && (
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Epic verification code: <span className="text-foreground">{authUserCodes[Number(order.id)]}</span>
                      </p>
                    )}
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
                          onClick={() => copyOrderLink(order, exchangeLinks[Number(order.id)])}
                          disabled={!exchangeLinks[Number(order.id)] || copyingOrderId === order.id}
                          className="border-2 border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                        >
                          {copyingOrderId === order.id && <LoaderCircle className="mr-1 inline size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                          {copyingOrderId === order.id ? "Copying…" : copiedOrderId === order.u7buyOrderId ? "Copied" : "Copy"}
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
                          onClick={() => copyOrderLink(order, fortniteLoginLinks[Number(order.id)])}
                          disabled={!fortniteLoginLinks[Number(order.id)] || copyingOrderId === order.id}
                          className="border-2 border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                        >
                          {copyingOrderId === order.id && <LoaderCircle className="mr-1 inline size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                          {copyingOrderId === order.id ? "Copying…" : copiedOrderId === order.u7buyOrderId ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={exchangeBusyOrderId === order.id} onClick={() => handleExchangeCode(order)} className="border-2 border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-wait disabled:opacity-60">
                          {exchangeBusyOrderId === order.id && <LoaderCircle className="mr-1 inline size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                          {exchangeBusyOrderId === order.id ? "Generating exchange link…" : "Generate & copy exchange code link"}
                        </button>
                        <button type="button" disabled={fortniteBusyOrderId === order.id} onClick={() => handleCopyFortniteLoginLink(order)} className="border-2 border-primary bg-primary px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60">
                          {fortniteBusyOrderId === order.id && <LoaderCircle className="mr-1 inline size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                          {fortniteBusyOrderId === order.id ? "Generating login link…" : "Generate & copy Fortnite login link"}
                        </button>
                      </div>
                    </>
                  )}
                  </>}
                  {getOrderStatusGroup(order.orderStatus) === "In Progress" && !epicAccounts[Number(order.id)] && authLinks[Number(order.id)] && authLinks[Number(order.id)].expiresAt > now && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-primary">
                      <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      <span role="status" aria-live="polite">Waiting for Epic authorization. Complete the link to continue.</span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground" aria-live="off">
                        Expires in {formatRemainingTime(authLinks[Number(order.id)].expiresAt - now)}
                      </span>
                    </div>
                  )}
                </div>}
              </div>
              <div className="flex min-w-0 flex-col items-start gap-3 sm:items-end">
                <span className={`inline-flex items-center gap-1.5 border px-2 py-1 text-xs font-bold uppercase tracking-wider ${statusTone(getOrderStatusLabel(order.orderStatus, Boolean(epicAccounts[Number(order.id)] || epicSessions?.some((session) => session.orderId === order.id && session.accessTokenStored))))}`}>
                  {getOrderStatusLabel(order.orderStatus, Boolean(epicAccounts[Number(order.id)] || epicSessions?.some((session) => session.orderId === order.id && session.accessTokenStored))) === "Authenticated" && <Check className="size-3" aria-hidden="true" />}
                  {getOrderStatusLabel(order.orderStatus, Boolean(epicAccounts[Number(order.id)] || epicSessions?.some((session) => session.orderId === order.id && session.accessTokenStored)))}
                </span>
                {focusedOrderId && getOrderStatusGroup(order.orderStatus) === "In Progress" && (
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <button
                      type="button"
                      disabled={updatingOrderId === order.id}
                      onClick={() => setCompletionConfirmOrder(order)}
                      className="border-2 border-primary bg-primary px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
                    >
                        {updatingOrderId === order.id && updatingOrderStatus === "Completed" && <LoaderCircle className="mr-1 inline size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                        {updatingOrderId === order.id && updatingOrderStatus === "Completed" ? "Completing…" : "Mark as completed"}

                    </button>
                    <button
                      type="button"
                      disabled={updatingOrderId === order.id}
                      onClick={() => handleStatusChange(order, "Refunded")}
                      className="border-2 border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-destructive hover:text-destructive disabled:cursor-wait disabled:opacity-60"
                    >
                      {updatingOrderId === order.id && updatingOrderStatus === "Refunded" && <LoaderCircle className="mr-1 inline size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                      {updatingOrderId === order.id && updatingOrderStatus === "Refunded" ? "Refunding…" : "Problems with order? Refunded"}
                    </button>
                  </div>
                )}
                {focusedOrderId && error && <p role="alert" className="text-left text-xs font-bold text-destructive sm:text-right">{error}</p>}
                <div className="border-t border-border pt-3 sm:text-right">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    {getOrderStatusGroup(order.orderStatus) === "In Progress" ? "Profit to be made" : "Profit"}
                  </p>
                  <p className="mt-1 font-display text-xl font-black text-primary">{currency(orderProfit(order))}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      <ConfirmOrderCompletionDialog
        open={Boolean(completionConfirmOrder)}
        orderLabel={completionConfirmOrder?.service ?? "this order"}
        onCancel={() => setCompletionConfirmOrder(null)}
        onConfirm={() => void confirmCompletion()}
      />
    </section>
  )
}

export function pendingOrderCount(entries: Entry[]) {
  return entries.filter(
    (entry) => entry.u7buyOrderId && entry.orderStatus && !COMPLETED_STATUSES.has(entry.orderStatus.trim().toLowerCase()),
  ).length
}
