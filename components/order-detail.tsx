"use client"

import Link from "next/link"
import { Check, LoaderCircle } from "lucide-react"
import { useState } from "react"
import { useLedger } from "@/lib/use-ledger"
import { currency } from "@/lib/types"
import { getOrderStatusGroup, getOrderStatusLabel, PendingOrders } from "@/components/pending-orders"
import { LoadingScreen } from "@/components/loading-screen"

export function OrderDetail({ orderId }: { orderId: string }) {
  const { data, isLoading, mutate } = useLedger()
  const [savingDate, setSavingDate] = useState(false)
  const [dateError, setDateError] = useState("")
  const order = data?.entries.find((entry) => entry.id === orderId && entry.u7buyOrderId)
  const sessionExists = data?.epicSessions?.some((session) => session.orderId === orderId && session.accessTokenStored)
  const orderStatusGroup = getOrderStatusGroup(order?.orderStatus)
  const completed = orderStatusGroup === "Completed"
  const displayedProfit = orderStatusGroup === "In Progress"
    ? (order?.orderAmount ?? 0) - (order?.orderCost ?? 0) - (order?.orderFee ?? 0)
    : orderStatusGroup === "Refunded" ? 0 : order?.profit ?? 0

  async function updateDate(date: string) {
    if (!order || !date) return
    setSavingDate(true)
    setDateError("")
    try {
      const response = await fetch("/api/entries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: order.id, date }),
      })
      if (!response.ok) throw new Error("Could not update order date")
      await mutate()
    } catch (error) {
      setDateError(error instanceof Error ? error.message : "Could not update order date")
    } finally {
      setSavingDate(false)
    }
  }

  if (isLoading || !data) return <LoadingScreen message="Loading order details" />
  if (!order) return (
    <section className="border-2 border-border bg-card p-6">
      <p className="font-bold uppercase tracking-wider">Order not found</p>
      <Link href="/?tab=pending-orders" className="mt-4 inline-block text-sm text-primary underline">Back to orders</Link>
    </section>
  )

  const playerokDealUrl =
    order.u7buyOrderId && (order.source === "playerok" || order.platform === "PO")
      ? `https://playerok.com/deal/${encodeURIComponent(order.u7buyOrderId)}`
      : null

  return (
    <section className="border-2 border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-border p-5">
        <div>
          <Link href="/?tab=pending-orders" className="text-xs font-bold uppercase tracking-wider text-primary underline">← All orders</Link>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
            Order{" "}
            {playerokDealUrl ? (
              <a
                href={playerokDealUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
                aria-label={`Open Playerok deal ${order.u7buyOrderId}`}
              >
                {order.u7buyOrderId}
              </a>
            ) : order.u7buyOrderId}
          </p>
          <h2 className="mt-2 font-display text-3xl font-black uppercase tracking-tight">{order.service}</h2>
          <p className="mt-2 text-xs uppercase tracking-wider text-muted-foreground">{order.platform} · Entry #{order.id}</p>
        </div>
        <span className="inline-flex items-center gap-2 border-2 border-primary px-3 py-2 text-xs font-bold uppercase tracking-wider text-primary">
          {sessionExists && <Check className="size-3.5" aria-hidden="true" />}
          {getOrderStatusLabel(order.orderStatus, Boolean(sessionExists))}
        </span>
        {completed && order.vbucksAfter !== undefined && (
          <span className="inline-flex items-center border-2 border-positive/50 bg-positive/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-positive">
            Final balance: {order.vbucksAfter} VBucks
          </span>
        )}
      </header>
      <div className="grid gap-px bg-border sm:grid-cols-2">
        <div className="bg-card p-5">
          <label htmlFor="order-date" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Order date</label>
          <input id="order-date" type="date" value={order.date} disabled={savingDate} onChange={(event) => updateDate(event.target.value)} className="mt-2 block h-10 border-2 border-border bg-background px-3 text-sm font-bold outline-none focus:border-primary disabled:opacity-60" />
          <p className="mt-3 text-xs text-muted-foreground">Waiting since: {order.waitingSince ?? order.date}</p>
          {savingDate && <p className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground" role="status"><LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Saving date…</p>}
          {dateError && <p role="alert" className="mt-2 text-xs font-bold text-destructive">{dateError}</p>}
        </div>
        <div className="bg-card p-5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Epic account access</p>
          {completed ? (
            <p className="mt-2 text-sm font-bold text-primary">Epic access has been revoked and purged.</p>
          ) : sessionExists ? (
            <p className="mt-2 text-sm font-bold">Epic session is connected to this order.</p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No Epic session is stored for this order.</p>
          )}
        </div>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Metric label="Order amount" value={currency(order.orderAmount ?? 0)} />
        <Metric label="Order cost" value={currency(order.orderCost ?? 0)} tone="negative" />
        <Metric label="Platform fee" value={currency(order.orderFee ?? 0)} tone="fee" />
        <Metric label={orderStatusGroup === "In Progress" ? "Profit to be made" : "Profit"} value={currency(displayedProfit)} tone="positive" />
        {order.vbucksBefore !== undefined && <Metric label="VBucks before fulfillment" value={`${order.vbucksBefore} VBucks`} />}
      </div>
      <div className="border-t-2 border-border p-5">
        <PendingOrders
          entries={[order]}
          presets={data.servicePresets}
          feeConfig={data.feeConfig}
          epicSessions={data.epicSessions}
          focusedOrderId={order.id}
          onChange={() => mutate()}
        />
      </div>
    </section>
  )
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "negative" | "fee" | "positive" }) {
  const toneStyles = {
    default: "border-border text-foreground",
    negative: "border-negative/40 text-negative",
    fee: "border-fee/50 text-fee",
    positive: "border-positive/40 text-positive",
  }
  return <div className={`border-2 p-4 ${toneStyles[tone]}`}><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-2 font-display text-xl font-black">{value}</p></div>
}
