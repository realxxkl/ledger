"use client"

import { useRef, useState } from "react"
import { Plus, Trash2, Download, Upload } from "lucide-react"
import type { LedgerData } from "@/lib/types"
import { currency } from "@/lib/types"
import { apiSend } from "@/lib/use-ledger"

const inputCls =
  "w-full border-2 border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
const primaryBtn =
  "flex items-center justify-center gap-2 border-2 border-primary bg-primary px-4 py-2 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
const outlineBtn =
  "flex items-center justify-center gap-2 border-2 border-border px-4 py-2 text-sm font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary"

export function SettingsPanel({ data, onChange }: { data: LedgerData; onChange: () => void }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <FeesSection data={data} onChange={onChange} />
      <div className="flex flex-col gap-6">
        <PresetsSection data={data} onChange={onChange} />
        <BackupSection data={data} onChange={onChange} />
      </div>
    </div>
  )
}

function FeesSection({ data, onChange }: { data: LedgerData; onChange: () => void }) {
  const [name, setName] = useState("")
  const [percent, setPercent] = useState("")
  const [flat, setFlat] = useState("")

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await apiSend("/api/fees", "PUT", {
      name: name.trim(),
      percent: Number(percent) || 0,
      flat: Number(flat) || 0,
    })
    setName("")
    setPercent("")
    setFlat("")
    onChange()
  }

  const remove = async (key: string) => {
    await apiSend(`/api/fees?key=${encodeURIComponent(key)}`, "DELETE")
    onChange()
  }

  return (
    <div className="border-2 border-border bg-card">
      <div className="border-b-2 border-border px-5 py-4">
        <h2 className="font-display text-xl font-black uppercase tracking-tight">Platform Fees</h2>
        <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
          Percent + flat fee applied per platform.
        </p>
      </div>
      <form onSubmit={save} className="grid grid-cols-3 gap-3 border-b-2 border-border p-5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Platform" className={`${inputCls} col-span-3`} />
        <input type="number" step="0.01" min="0" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="Percent %" className={inputCls} />
        <input type="number" step="0.01" min="0" value={flat} onChange={(e) => setFlat(e.target.value)} placeholder="Flat $" className={inputCls} />
        <button type="submit" className={primaryBtn}>
          <Plus className="size-4" aria-hidden="true" />
          Save
        </button>
      </form>
      {Object.keys(data.feeConfig).length === 0 ? (
        <p className="px-5 py-6 text-center text-sm uppercase tracking-wider text-muted-foreground">
          No platforms configured.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {Object.entries(data.feeConfig).map(([key, cfg]) => (
            <li key={key} className="flex items-center justify-between px-5 py-3 text-sm">
              <span className="font-bold">{cfg.name}</span>
              <div className="flex items-center gap-4">
                <span className="text-muted-foreground">
                  {cfg.percent}%{cfg.flat ? ` + ${currency(cfg.flat)}` : ""}
                </span>
                <button
                  onClick={() => remove(key)}
                  className="p-1.5 text-muted-foreground transition-colors hover:text-negative"
                  aria-label={`Delete ${cfg.name} fee`}
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

function PresetsSection({ data, onChange }: { data: LedgerData; onChange: () => void }) {
  const [name, setName] = useState("")
  const [cost, setCost] = useState("")

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await apiSend("/api/presets", "POST", { name: name.trim(), cost: Number(cost) || 0 })
    setName("")
    setCost("")
    onChange()
  }

  const remove = async (id: string) => {
    await apiSend(`/api/presets?id=${id}`, "DELETE")
    onChange()
  }

  return (
    <div className="border-2 border-border bg-card">
      <div className="border-b-2 border-border px-5 py-4">
        <h2 className="font-display text-xl font-black uppercase tracking-tight">Service Presets</h2>
      </div>
      <form onSubmit={add} className="grid grid-cols-3 gap-3 border-b-2 border-border p-5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Service name" className={`${inputCls} col-span-2`} />
        <input type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Cost $" className={inputCls} />
        <button type="submit" className={`${primaryBtn} col-span-3 justify-self-start`}>
          <Plus className="size-4" aria-hidden="true" />
          Add Preset
        </button>
      </form>
      {data.servicePresets.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm uppercase tracking-wider text-muted-foreground">
          No presets.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {data.servicePresets.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-5 py-3 text-sm">
              <span className="font-bold">{p.name}</span>
              <div className="flex items-center gap-4">
                <span className="text-muted-foreground">{currency(p.cost)}</span>
                <button
                  onClick={() => remove(p.id)}
                  className="p-1.5 text-muted-foreground transition-colors hover:text-negative"
                  aria-label={`Delete ${p.name} preset`}
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

function BackupSection({ data, onChange }: { data: LedgerData; onChange: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState("")

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `ledger-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importData = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setStatus("Importing…")
    try {
      const parsed = JSON.parse(await file.text())
      await apiSend("/api/import", "POST", parsed)
      setStatus("Import complete.")
      onChange()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Import failed.")
    } finally {
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  return (
    <div className="border-2 border-border bg-card p-5">
      <h2 className="font-display text-xl font-black uppercase tracking-tight">Backup</h2>
      <p className="mb-4 mt-1 text-xs uppercase tracking-wider text-muted-foreground">
        Export or restore all your data as JSON.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={outlineBtn} onClick={exportData}>
          <Download className="size-4" aria-hidden="true" />
          Export
        </button>
        <button type="button" className={outlineBtn} onClick={() => fileRef.current?.click()}>
          <Upload className="size-4" aria-hidden="true" />
          Import
        </button>
        <input ref={fileRef} type="file" accept="application/json" onChange={importData} className="hidden" />
        {status && <span className="text-xs uppercase tracking-wider text-muted-foreground">{status}</span>}
      </div>
    </div>
  )
}
