"use client"

import { FormEvent, useState } from "react"
import { Clock3, PackageCheck, Plus } from "lucide-react"
import type { Entry } from "@/lib/types"
import { currency } from "@/lib/types"

const COMPLETED_STATUSES = new Set(["Completed", "Cancelled", "Delivered", "Refunded"])
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
  onChange,
}: {
  entries: Entry[]
  presets: { id: string; name: string; cost: number }[]
  feeConfig: Record<string, { name: string; percent: number; flat: number }>
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
  const [authError, setAuthError] = useState("")
  const [epicAccounts, setEpicAccounts] = useState<Record<number, string>>({})
  const orders = entries.filter(
    (entry) => entry.u7buyOrderId && entry.orderStatus && !COMPLETED_STATUSES.has(entry.orderStatus),
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
      if (!response.ok || !data.code) throw new Error(data.error)
      await navigator.clipboard.writeText(data.code)
      setCopiedOrderId(order.u7buyOrderId ?? null)
      window.setTimeout(() => setCopiedOrderId(null), 1800)
    } catch {
      setAuthError("Could not generate the Epic exchange code.")
    }
  }

  async function handleStatusChange(order: Entry, orderStatus: string) {
    const response = await fetch("/api/entries", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: order.id, orderStatus }),
    })
    if (response.ok) onChange()
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
        if (status.status === "completed") {
          setEpicAccounts((current) => ({ ...current, [order.id]: status.displayName || "Epic account" }))
          break
        }
        if (status.status === "error") throw new Error(status.error)
      }
    } catch {
      setAuthError("Could not generate the Epic auth link.")
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
                <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleGenerateLoginLink(order)}
                  className="mt-3 border-2 border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  {authLinkOrderId === order.u7buyOrderId
                    ? "Generating..."
                    : copiedOrderId === order.u7buyOrderId
                      ? "Epic link copied"
                      : "Generate Epic auth link"}
                </button>
                {epicAccounts[order.id] && (
                  <button
                    type="button"
                    onClick={() => handleExchangeCode(order)}
                    className="border-2 border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    {copiedOrderId === order.u7buyOrderId ? "Code copied" : "Generate exchange code"}
                  </button>
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
    (entry) => entry.u7buyOrderId && entry.orderStatus && !COMPLETED_STATUSES.has(entry.orderStatus),
  ).length
}
