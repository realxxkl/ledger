"use client"

import { useMemo, useState, useEffect } from "react"
import { Plus } from "lucide-react"
import type { LedgerData } from "@/lib/types"
import { currency } from "@/lib/types"
import { apiSend } from "@/lib/use-ledger"

const today = () => new Date().toISOString().slice(0, 10)

const inputCls =
  "w-full border-2 border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
const labelCls = "text-[10px] font-bold uppercase tracking-wider text-muted-foreground"

export function EntryForm({
  data,
  onDone,
}: {
  data: LedgerData
  onDone: () => void
}) {
  const presetNames = data.servicePresets
  const platformKeys = Object.keys(data.feeConfig)

  const [service, setService] = useState("")
  const [platform, setPlatform] = useState(platformKeys[0] ?? "")
  const [date, setDate] = useState(today())
  const [earned, setEarned] = useState("")
  const [paid, setPaid] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [exchangeRate, setExchangeRate] = useState<number | null>(null)
  const [exchangeRateLoading, setExchangeRateLoading] = useState(false)

  const fee = data.feeConfig[platform]
  const earnedNum = Number(earned) || 0
  const paidNum = Number(paid) || 0
  const feePercent = fee?.percent ?? 0
  const feeAmt = useMemo(
    () => earnedNum * (feePercent / 100) + (fee?.flat ?? 0),
    [earnedNum, feePercent, fee],
  )

  // Calculate the USD cost: if EGP preset is selected and we have an exchange rate, convert; otherwise use paid as USD
  const paidUsd = useMemo(() => {
    const selectedPreset = presetNames.find((p) => p.name === service)
    if (selectedPreset?.currency === 'egp' && exchangeRate) {
      return paidNum / exchangeRate
    }
    return paidNum
  }, [paidNum, exchangeRate, service, presetNames])

  const profit = earnedNum - feeAmt - paidUsd

  const onSelectService = async (name: string) => {
    setService(name)
    const preset = presetNames.find((p) => p.name === name)
    if (preset) {
      setPaid(String(preset.cost))
      // If preset is in EGP, fetch the exchange rate
      if (preset.currency === 'egp') {
        setExchangeRateLoading(true)
        try {
          const res = await fetch('/api/exchange-rate')
          const data = await res.json()
          if (data.rate) {
            setExchangeRate(data.rate)
          }
        } catch (err) {
          console.error('[v0] Failed to fetch exchange rate:', err)
        } finally {
          setExchangeRateLoading(false)
        }
      } else {
        setExchangeRate(null)
      }
    } else {
      setExchangeRate(null)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (!service || !platform || !date) {
      setError("Service, platform, and date are required.")
      return
    }
    setSaving(true)
    try {
      const selectedPreset = presetNames.find((p) => p.name === service)
      const payload: any = {
        service,
        platform: fee?.name ?? platform,
        date,
        earned: earnedNum,
        feePercent,
        feeAmt,
        paid: paidUsd,
        profit,
      }

      // If preset was in EGP and we have an exchange rate, pass it along
      if (selectedPreset?.currency === 'egp' && exchangeRate) {
        payload.costCurrency = 'egp'
        payload.exchangeRate = exchangeRate
      }

      await apiSend("/api/entries", "POST", payload)
      setService("")
      setEarned("")
      setPaid("")
      setDate(today())
      setExchangeRate(null)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 border-2 border-border bg-card p-5">
      <h2 className="font-display text-xl font-black uppercase tracking-tight">New Sale</h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={labelCls}>Service / Item</span>
          <input
            value={service}
            onChange={(e) => setService(e.target.value)}
            placeholder="e.g. Logo design, or type your own"
            className={inputCls}
          />
          {presetNames.length > 0 && (
            <div className="mt-1 grid grid-cols-2 gap-2">
              {presetNames.map((p) => {
                const active = service === p.name
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectService(p.name)}
                    title={p.cost ? `Cost ${currency(p.cost)}` : undefined}
                    className={`truncate border-2 px-3 py-2 text-left text-sm font-bold uppercase tracking-wider transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background text-foreground hover:border-primary"
                    }`}
                  >
                    {p.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Platform</span>
          {platformKeys.length > 0 ? (
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={inputCls}>
              {platformKeys.map((k) => (
                <option key={k} value={k}>
                  {data.feeConfig[k].name} ({data.feeConfig[k].percent}%
                  {data.feeConfig[k].flat ? ` + ${currency(data.feeConfig[k].flat)}` : ""})
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

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>Earned, Gross ($)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={earned}
              onChange={(e) => setEarned(e.target.value)}
              placeholder="0.00"
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>Other Costs ($)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
              placeholder="0.00"
              className={inputCls}
            />
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-1 border-2 border-border bg-background px-4 py-3 text-sm">
        <Row label="Gross earned" value={currency(earnedNum)} />
        <Row label="Per-sale fee" value={`-${currency(feeAmt)}`} tone="text-negative" />
        {exchangeRate ? (
          <Row
            label="Cost (EGP → USD)"
            value={`${Number(paid).toFixed(2)} EGP ÷ ${exchangeRate.toFixed(4)} = ${currency(paidUsd)}`}
            tone="text-muted-foreground"
          />
        ) : (
          <Row label="Other costs" value={`-${currency(paidUsd)}`} tone="text-negative" />
        )}
        <div className="mt-1 border-t border-border pt-1.5">
          <Row
            label="Profit"
            value={currency(profit)}
            bold
            tone={profit >= 0 ? "text-primary" : "text-negative"}
          />
        </div>
      </div>

      {error && <p className="text-sm uppercase tracking-wider text-negative">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="flex items-center justify-center gap-2 border-2 border-primary bg-primary px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <Plus className="size-4" aria-hidden="true" />
        {saving ? "Saving…" : "+ Add Sale"}
      </button>
    </form>
  )
}

function Row({
  label,
  value,
  tone = "text-foreground",
  bold = false,
}: {
  label: string
  value: string
  tone?: string
  bold?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-xs uppercase tracking-wider text-muted-foreground ${bold ? "font-bold" : ""}`}>
        {label}
      </span>
      <span className={`${bold ? "font-display text-lg font-black" : "text-sm"} ${tone}`}>{value}</span>
    </div>
  )
}
