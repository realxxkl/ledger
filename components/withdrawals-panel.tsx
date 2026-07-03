"use client"

import { useState } from "react"
import { Trash2 } from "lucide-react"
import type { LedgerData } from "@/lib/types"
import { currency } from "@/lib/types"
import { apiSend } from "@/lib/use-ledger"

const today = () => new Date().toISOString().slice(0, 10)

const inputCls =
  "w-full border-2 border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
const labelCls = "text-[10px] font-bold uppercase tracking-wider text-muted-foreground"

export function WithdrawalsPanel({ data, onChange }: { data: LedgerData; onChange: () => void }) {
  const platformKeys = Object.keys(data.feeConfig)
  const [platform, setPlatform] = useState(platformKeys[0] ?? "")
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState("")
  const [fee, setFee] = useState("")
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!platform || !date) return
    setSaving(true)
    try {
      await apiSend("/api/withdrawals", "POST", {
        platform: data.feeConfig[platform]?.name ?? platform,
        date,
        amount: Number(amount) || 0,
        fee: Number(fee) || 0,
      })
      setAmount("")
      setFee("")
      setDate(today())
      onChange()
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(id)
    try {
      await apiSend(`/api/withdrawals?id=${id}`, "DELETE")
      onChange()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="border-2 border-border bg-card">
      <div className="border-b-2 border-border px-5 py-4">
        <h2 className="font-display text-xl font-black uppercase tracking-tight">Withdrawals</h2>
        <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
          Log it here when you actually pull money out. The flat withdrawal fee is charged once per
          withdrawal — not per sale.
        </p>
      </div>

      <form onSubmit={add} className="grid grid-cols-2 items-end gap-3 border-b-2 border-border p-5 lg:grid-cols-5">
        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Platform</span>
          {platformKeys.length > 0 ? (
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={inputCls}>
              {platformKeys.map((k) => (
                <option key={k} value={k}>
                  {data.feeConfig[k].name}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              placeholder="e.g. Etsy"
              className={inputCls}
            />
          )}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Amount ($, optional)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Fee Charged ($)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            placeholder="0.00"
            className={inputCls}
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="col-span-2 border-2 border-primary bg-primary px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 lg:col-span-1"
        >
          {saving ? "Saving…" : "Log Withdrawal"}
        </button>
      </form>

      {data.withdrawals.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm uppercase tracking-wider text-muted-foreground">
          No withdrawals recorded.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {data.withdrawals.map((w) => (
            <li key={w.id} className="flex items-center justify-between px-5 py-3 text-sm">
              <div className="flex flex-col">
                <span className="font-bold">{w.platform}</span>
                <span className="text-xs text-muted-foreground">{w.date}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-display text-lg font-black">{currency(w.amount)}</span>
                {w.fee > 0 && (
                  <span className="text-xs uppercase tracking-wider text-negative">
                    fee {currency(w.fee)}
                  </span>
                )}
                <button
                  onClick={() => remove(w.id)}
                  disabled={busy === w.id}
                  className="p-1.5 text-muted-foreground transition-colors hover:text-negative disabled:opacity-50"
                  aria-label={`Delete withdrawal from ${w.platform}`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
