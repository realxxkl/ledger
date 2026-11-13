"use client"

import Link from "next/link"
import { Check } from "lucide-react"
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

  return (
    <section className="border-2 border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-border p-5">
        <div>
          <Link href="/?tab=pending-orders" className="text-xs font-bold uppercase tracking-wider text-primary underline">← All orders</Link>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Order {order.u7buyOrderId}</p>
          <h2 className="mt-2 font-display text-3xl font-black uppercase tracking-tight">{order.service}</h2>
          <p className="mt-2 text-xs uppercase tracking-wider text-muted-foreground">{order.platform} · Entry #{order.id}</p>
        </div>
        <span className="inline-flex items-center gap-2 border-2 border-primary px-3 py-2 text-xs font-bold uppercase tracking-wider text-primary">
          {sessionExists && <Check className="size-3.5" aria-hidden="true" />}
          {getOrderStatusLabel(order.orderStatus, Boolean(sessionExists))}
        </span>
      </header>
      <div className="grid gap-px bg-border sm:grid-cols-2">
        <div className="bg-card p-5">
          <label htmlFor="order-date" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Order date</label>
          <input id="order-date" type="date" value={order.date} disabled={savingDate} onChange={(event) => updateDate(event.target.value)} className="mt-2 block h-10 border-2 border-border bg-background px-3 text-sm font-bold outline-none focus:border-primary disabled:opacity-60" />
          {savingDate && <p className="mt-2 text-xs text-muted-foreground">Saving date…</p>}
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
        <Metric label="Order cost" value={currency(order.orderCost ?? 0)} />
        <Metric label="Platform fee" value={currency(order.orderFee ?? 0)} />
        <Metric label={orderStatusGroup === "In Progress" ? "Profit to be made" : "Profit"} value={currency(displayedProfit)} />
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
      {savingDate && <LoadingScreen message="Saving order date" overlay />}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="border-2 border-border p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-2 font-display text-xl font-black">{value}</p></div>
}
