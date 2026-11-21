"use client"

import { FormEvent, useCallback, useEffect, useState } from "react"
import { Archive, ExternalLink, LoaderCircle, Pencil, Plus, Power, PowerOff, RefreshCw, RotateCcw, Search, X } from "lucide-react"
import { currency } from "@/lib/types"

type OfferStatus = "APPROVED" | "PENDING" | "PAUSED" | "DELETED"

type Offer = {
  id: number
  externalOfferId: string
  title: string
  description: string | null
  imageUrl: string | null
  price: string
  rawPrice: string
  categoryId: string
  gameId: string
  status: OfferStatus
  keepInSale: boolean
  onSale: boolean
  syncStatus: string
  lastSyncedAt: string | null
  updatedAt: string
}

type OfferForm = {
  externalOfferId: string
  title: string
  description: string
  imageUrl: string
  price: string
  rawPrice: string
  categoryId: string
  gameId: string
  status: OfferStatus
  keepInSale: boolean
}

const EMPTY_FORM: OfferForm = {
  externalOfferId: "",
  title: "",
  description: "",
  imageUrl: "",
  price: "",
  rawPrice: "",
  categoryId: "",
  gameId: "",
  status: "APPROVED",
  keepInSale: true,
}

const inputClass =
  "w-full border-2 border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
const primaryButton =
  "inline-flex items-center justify-center gap-2 border-2 border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
const outlineButton =
  "inline-flex items-center justify-center gap-2 border-2 border-border px-3 py-2 text-xs font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"

type DetectedPlayerokOffer = {
  externalOfferId: string
  title: string
  description: string | null
  imageUrl: string | null
  price: number
  rawPrice: number
  categoryId: string
  gameId: string
  status: OfferStatus
  keepInSale: boolean
  onSale: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isDetectedPlayerokOffer(value: unknown): value is DetectedPlayerokOffer {
  return Boolean(
    isRecord(value) &&
      typeof value.externalOfferId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.externalOfferId) &&
      typeof value.title === "string" &&
      (typeof value.description === "string" || value.description === null) &&
      (typeof value.imageUrl === "string" || value.imageUrl === null) &&
      typeof value.price === "number" && Number.isFinite(value.price) && value.price >= 0 &&
      typeof value.rawPrice === "number" && Number.isFinite(value.rawPrice) && value.rawPrice >= 0 &&
      typeof value.categoryId === "string" &&
      typeof value.gameId === "string" &&
      (value.status === "APPROVED" || value.status === "PENDING" || value.status === "PAUSED" || value.status === "DELETED") &&
      typeof value.keepInSale === "boolean" &&
      typeof value.onSale === "boolean",
  )
}

function requestPlayerokOffers(action: "detect" | "republish" | "discontinue", itemId?: string) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const requestId = crypto.randomUUID()
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", listener)
      reject(new Error("Timed out waiting for the Playerok extension. Check that it is enabled and that your seller products page is open."))
    }, 60_000)

    function listener(event: MessageEvent<unknown>) {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        !isRecord(event.data) ||
        event.data.source !== "LEDGER_PLAYEROK_OFFERS_RESULT" ||
        event.data.requestId !== requestId
      ) {
        return
      }
      window.clearTimeout(timeout)
      window.removeEventListener("message", listener)
      if (!isRecord(event.data.payload)) {
        reject(new Error("The Playerok extension returned an invalid response."))
        return
      }
      resolve(event.data.payload)
    }

    window.addEventListener("message", listener)
    window.postMessage({
      source: "LEDGER_PLAYEROK_OFFERS_REQUEST",
      requestId,
      action,
      ...(itemId ? { itemId } : {}),
    }, window.location.origin)
  })
}

function isPlayerokOfferId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isOffer(value: unknown): value is Offer {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value && typeof value.id === "number" &&
      "externalOfferId" in value && typeof value.externalOfferId === "string" &&
      "title" in value && typeof value.title === "string" &&
      "imageUrl" in value && (typeof value.imageUrl === "string" || value.imageUrl === null) &&
      "price" in value && typeof value.price === "string" &&
      "rawPrice" in value && typeof value.rawPrice === "string" &&
      "categoryId" in value && typeof value.categoryId === "string" &&
      "gameId" in value && typeof value.gameId === "string" &&
      "status" in value &&
      (value.status === "APPROVED" || value.status === "PENDING" || value.status === "PAUSED" || value.status === "DELETED") &&
      "keepInSale" in value && typeof value.keepInSale === "boolean" &&
      "onSale" in value && typeof value.onSale === "boolean" &&
      "syncStatus" in value && typeof value.syncStatus === "string" &&
      "updatedAt" in value && typeof value.updatedAt === "string",
  )
}

function offerStatusTone(status: string) {
  if (status === "APPROVED") return "border-primary/50 bg-primary/10 text-primary"
  if (status === "PENDING") return "border-amber-500/50 bg-amber-500/10 text-amber-300"
  if (status === "DELETED") return "border-border bg-muted/40 text-muted-foreground"
  return "border-border bg-background text-foreground"
}

export function OffersPanel() {
  const [offers, setOffers] = useState<Offer[]>([])
  const [form, setForm] = useState<OfferForm>(EMPTY_FORM)
  const [editingExternalId, setEditingExternalId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [visibility, setVisibility] = useState<"all" | "active" | "archived">("active")
  const [loading, setLoading] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [selectedOfferIds, setSelectedOfferIds] = useState<Set<string>>(() => new Set())
  const [bulkSaleStatus, setBulkSaleStatus] = useState<boolean | null>(null)
  const [bulkProgress, setBulkProgress] = useState("")
  const [saving, setSaving] = useState(false)
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const loadOffers = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch("/api/offers/batch")
      const payload: unknown = await response.json()
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : "Offers could not be loaded."
        throw new Error(message)
      }
      if (
        !payload ||
        typeof payload !== "object" ||
        !("offers" in payload) ||
        !Array.isArray(payload.offers) ||
        !payload.offers.every(isOffer)
      ) {
        throw new Error("The offers endpoint returned an invalid response.")
      }
      setOffers(payload.offers)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Offers could not be loaded.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadOffers()
  }, [loadOffers])

  const filteredOffers = offers.filter((offer) => {
    const active = offer.status !== "DELETED"
    if (visibility === "active" && !active) return false
    if (visibility === "archived" && active) return false
    const query = search.trim().toLowerCase()
    return !query || [
      offer.title,
      offer.externalOfferId,
      offer.categoryId,
      offer.gameId,
      offer.status,
    ].some((value) => value.toLowerCase().includes(query))
  })
  const selectableVisibleOffers = filteredOffers.filter(
    (offer) => offer.status !== "DELETED" && isPlayerokOfferId(offer.externalOfferId),
  )
  const selectedOffers = offers.filter(
    (offer) => selectedOfferIds.has(offer.externalOfferId) && offer.status !== "DELETED" && isPlayerokOfferId(offer.externalOfferId),
  )
  const allVisibleOffersSelected = selectableVisibleOffers.length > 0 &&
    selectableVisibleOffers.every((offer) => selectedOfferIds.has(offer.externalOfferId))

  function toggleVisibleOfferSelection(checked: boolean) {
    setSelectedOfferIds((current) => {
      const next = new Set(current)
      for (const offer of selectableVisibleOffers) {
        if (checked) next.add(offer.externalOfferId)
        else next.delete(offer.externalOfferId)
      }
      return next
    })
  }

  function toggleOfferSelection(externalOfferId: string, checked: boolean) {
    setSelectedOfferIds((current) => {
      const next = new Set(current)
      if (checked) next.add(externalOfferId)
      else next.delete(externalOfferId)
      return next
    })
  }

  function startEdit(offer: Offer) {
    setEditingExternalId(offer.externalOfferId)
    setForm({
      externalOfferId: offer.externalOfferId,
      title: offer.title,
      description: offer.description ?? "",
      imageUrl: offer.imageUrl ?? "",
      price: offer.price,
      rawPrice: offer.rawPrice,
      categoryId: offer.categoryId,
      gameId: offer.gameId,
      status: offer.status === "PENDING" || offer.status === "PAUSED" || offer.status === "DELETED"
        ? offer.status
        : "APPROVED",
      keepInSale: offer.keepInSale,
    })
    setError("")
    setNotice("")
  }

  function resetForm() {
    setEditingExternalId(null)
    setForm(EMPTY_FORM)
    setError("")
    setNotice("")
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError("")
    setNotice("")
    try {
      const response = await fetch("/api/offers/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operations: [{
            action: "upsert",
            offer: {
              externalOfferId: form.externalOfferId.trim(),
              title: form.title.trim(),
              description: form.description || null,
              imageUrl: form.imageUrl.trim() || null,
              price: Number(form.price),
              rawPrice: Number(form.rawPrice),
              categoryId: form.categoryId.trim(),
              gameId: form.gameId.trim(),
              status: form.status,
              keepInSale: form.status === "DELETED" ? false : form.keepInSale,
            },
          }],
        }),
      })
      const payload: unknown = await response.json()
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : "Offer could not be saved."
        throw new Error(message)
      }
      resetForm()
      setNotice(editingExternalId ? "Offer updated in the local inventory." : "Offer added to the local inventory.")
      await loadOffers()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Offer could not be saved.")
    } finally {
      setSaving(false)
    }
  }

  async function archiveOffer(offer: Offer) {
    if (busyOfferId) return
    if (!window.confirm(`Archive "${offer.title}" from the local inventory?`)) return

    setBusyOfferId(offer.externalOfferId)
    setError("")
    setNotice("")
    try {
      const response = await fetch("/api/offers/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operations: [{ action: "remove", externalOfferId: offer.externalOfferId }],
        }),
      })
      const payload: unknown = await response.json()
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : "Offer could not be archived."
        throw new Error(message)
      }
      setNotice("Offer archived in the local inventory. Playerok was not changed.")
      await loadOffers()
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Offer could not be archived.")
    } finally {
      setBusyOfferId(null)
    }
  }

  async function restoreOffer(offer: Offer) {
    if (busyOfferId) return
    setBusyOfferId(offer.externalOfferId)
    setError("")
    setNotice("")
    try {
      const response = await fetch("/api/offers/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operations: [{
            action: "upsert",
            offer: {
              externalOfferId: offer.externalOfferId,
              title: offer.title,
              description: offer.description,
              price: Number(offer.price),
              rawPrice: Number(offer.rawPrice),
              categoryId: offer.categoryId,
              gameId: offer.gameId,
              status: "APPROVED",
              keepInSale: true,
              syncStatus: offer.syncStatus,
            },
          }],
        }),
      })
      const payload: unknown = await response.json()
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : "Offer could not be restored."
        throw new Error(message)
      }
      setNotice("Offer restored in the local inventory. Playerok was not changed.")
      await loadOffers()
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "Offer could not be restored.")
    } finally {
      setBusyOfferId(null)
    }
  }

  async function detectPlayerokOffers() {
    if (detecting) return
    setDetecting(true)
    setError("")
    setNotice("")
    try {
      const result = await requestPlayerokOffers("detect")
      if (typeof result.error === "string") throw new Error(result.error)
      if (!Array.isArray(result.offers) || !result.offers.every(isDetectedPlayerokOffer)) {
        throw new Error("The Playerok extension returned incomplete offer data.")
      }
      if (result.offers.length === 0) {
        setNotice("Playerok scan completed. No listings were found.")
        return
      }

      const detectedOffers = result.offers
      for (let offset = 0; offset < detectedOffers.length; offset += 100) {
        const batch = detectedOffers.slice(offset, offset + 100)
        const response = await fetch("/api/offers/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operations: batch.map((offer) => ({
              action: "upsert",
              offer: { ...offer, syncStatus: "SYNCED" },
            })),
          }),
        })
        const payload: unknown = await response.json()
        if (!response.ok) {
          const message = isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "Detected offers could not be saved to the local catalog."
          throw new Error(`Synced ${Math.min(offset, detectedOffers.length)} of ${detectedOffers.length} offers. ${message}`)
        }
      }

      await loadOffers()
      setNotice(`Detected and synced ${detectedOffers.length} Playerok offer(s). Local offers not returned by the scan were left unchanged.`)
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Playerok offers could not be detected.")
    } finally {
      setDetecting(false)
    }
  }

  async function savePlayerokSaleStatus(offer: Offer, nextOnSale: boolean) {
    const action = nextOnSale ? "republish" : "discontinue"
    const result = await requestPlayerokOffers(action, offer.externalOfferId)
    if (result.success !== true || result.onSale !== nextOnSale) {
      throw new Error(typeof result.error === "string" ? result.error : "Playerok did not confirm the requested offer status.")
    }

    const response = await fetch("/api/offers/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operations: [{
          action: "upsert",
          offer: {
            externalOfferId: offer.externalOfferId,
            title: offer.title,
            description: offer.description,
            imageUrl: offer.imageUrl,
            price: Number(offer.price),
            rawPrice: Number(offer.rawPrice),
            categoryId: offer.categoryId,
            gameId: offer.gameId,
            status: offer.status,
            keepInSale: offer.keepInSale,
            onSale: nextOnSale,
            syncStatus: "SYNCED",
          },
        }],
      }),
    })
    const payload: unknown = await response.json()
    if (!response.ok) {
      const message = isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : "The Ledger mirror could not be updated."
      throw new Error(`Playerok was updated, but the Ledger mirror was not: ${message}`)
    }
  }

  async function changePlayerokSaleStatus(offer: Offer) {
    if (busyOfferId || bulkSaleStatus !== null || !isPlayerokOfferId(offer.externalOfferId)) return
    const nextOnSale = !offer.onSale
    const actionLabel = nextOnSale ? "put on sale" : "take off sale"
    if (!window.confirm(`Are you sure you want to ${actionLabel} "${offer.title}" on Playerok?`)) return

    setBusyOfferId(offer.externalOfferId)
    setError("")
    setNotice("")
    try {
      await savePlayerokSaleStatus(offer, nextOnSale)
      await loadOffers()
      setNotice(`"${offer.title}" is now ${nextOnSale ? "on sale" : "off sale"} on Playerok.`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Playerok offer status could not be changed.")
    } finally {
      setBusyOfferId(null)
    }
  }

  async function changeSelectedPlayerokSaleStatus(nextOnSale: boolean) {
    if (bulkSaleStatus !== null || busyOfferId !== null || detecting || saving || selectedOffers.length === 0) return

    const offersToChange = selectedOffers.filter((offer) => offer.onSale !== nextOnSale)
    if (offersToChange.length === 0) {
      setNotice(`All ${selectedOffers.length} selected offers are already ${nextOnSale ? "on sale" : "off sale"}.`)
      setError("")
      return
    }

    const actionLabel = nextOnSale ? "put on sale" : "take off sale"
    if (!window.confirm(`Are you sure you want to ${actionLabel} ${offersToChange.length} selected offer(s) on Playerok?`)) return

    setBulkSaleStatus(nextOnSale)
    setError("")
    setNotice("")
    const updatedIds: string[] = []
    const unchangedIds = selectedOffers
      .filter((offer) => offer.onSale === nextOnSale)
      .map((offer) => offer.externalOfferId)
    const failures: Array<{ title: string; message: string }> = []
    try {
      for (let index = 0; index < offersToChange.length; index += 1) {
        const offer = offersToChange[index]
        setBusyOfferId(offer.externalOfferId)
        setBulkProgress(`${index + 1} of ${offersToChange.length}: ${offer.title}`)
        try {
          await savePlayerokSaleStatus(offer, nextOnSale)
          updatedIds.push(offer.externalOfferId)
        } catch (actionError) {
          failures.push({
            title: offer.title,
            message: actionError instanceof Error ? actionError.message : "Playerok offer status could not be changed.",
          })
        } finally {
          setBusyOfferId(null)
        }
      }

      setSelectedOfferIds((current) => {
        const next = new Set(current)
        for (const externalOfferId of [...updatedIds, ...unchangedIds]) next.delete(externalOfferId)
        return next
      })
      await loadOffers()

      if (failures.length > 0) {
        const details = failures.slice(0, 3).map(({ title, message }) => `${title}: ${message}`).join(" · ")
        const remaining = failures.length > 3 ? ` · and ${failures.length - 3} more error(s)` : ""
        setError(`${updatedIds.length} updated; ${failures.length} had errors. ${details}${remaining}`)
      } else {
        setNotice(`${updatedIds.length} selected offer(s) are now ${nextOnSale ? "on sale" : "off sale"} on Playerok.`)
      }
    } finally {
      setBusyOfferId(null)
      setBulkSaleStatus(null)
      setBulkProgress("")
    }
  }

  const archivedCount = offers.filter((offer) => offer.status === "DELETED").length

  return (
    <section className="border-2 border-border bg-card">
      <header className="flex flex-col gap-3 border-b-2 border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Local catalog</p>
          <h2 className="mt-1 font-display text-2xl font-black uppercase tracking-tight">Offers</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {offers.filter((offer) => offer.onSale && offer.status !== "DELETED").length} on sale ·{" "}
            {offers.filter((offer) => !offer.onSale && offer.status !== "DELETED").length} off sale · {archivedCount} archived.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Detect scans the signed-in Playerok seller products tab. Sale buttons change live Playerok status; other edits remain local.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void detectPlayerokOffers()} disabled={detecting || loading || saving || bulkSaleStatus !== null} className={outlineButton}>
            {detecting
              ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              : <RefreshCw className="size-4" aria-hidden="true" />}
            {detecting ? "Scanning Playerok…" : "Detect Playerok offers"}
          </button>
          <a
            href="https://playerok.com/sell"
            target="_blank"
            rel="noopener noreferrer"
            className={outlineButton}
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            Open Playerok
          </a>
          <button type="button" onClick={() => void loadOffers()} disabled={loading} className={outlineButton}>
            {loading
              ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              : <RefreshCw className="size-4" aria-hidden="true" />}
            Refresh
          </button>
        </div>
      </header>

      <form onSubmit={submitForm} className="grid gap-3 border-b-2 border-border p-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-4">
          <h3 className="text-sm font-bold uppercase tracking-wider">
            {editingExternalId ? "Edit offer" : "Add offer"}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            This saves a local mirror only; it does not create or modify a Playerok listing.
          </p>
        </div>
        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground sm:col-span-2">
          External offer ID
          <input
            required
            maxLength={200}
            value={form.externalOfferId}
            onChange={(event) => setForm((current) => ({ ...current, externalOfferId: event.target.value }))}
            className={`${inputClass} mt-1`}
            readOnly={Boolean(editingExternalId)}
          />
        </label>
        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground sm:col-span-2">
          Title
          <input
            required
            maxLength={300}
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Price
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={form.price}
            onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Raw price
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={form.rawPrice}
            onChange={(event) => setForm((current) => ({ ...current, rawPrice: event.target.value }))}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Category ID
          <input
            required
            maxLength={200}
            value={form.categoryId}
            onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Game ID
          <input
            required
            maxLength={200}
            value={form.gameId}
            onChange={(event) => setForm((current) => ({ ...current, gameId: event.target.value }))}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Listing status
          <select
            value={form.status}
            onChange={(event) => setForm((current) => ({
              ...current,
              status: event.target.value as OfferStatus,
              keepInSale: event.target.value === "DELETED" ? false : current.keepInSale,
            }))}
            className={`${inputClass} mt-1`}
          >
            <option value="APPROVED">Approved</option>
            <option value="PENDING">Pending</option>
            <option value="PAUSED">Paused</option>
            <option value="DELETED">Deleted</option>
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <input
            type="checkbox"
            checked={form.keepInSale}
            disabled={form.status === "DELETED"}
            onChange={(event) => setForm((current) => ({ ...current, keepInSale: event.target.checked }))}
          />
          Keep in sale
        </label>
        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground sm:col-span-2 lg:col-span-4">
          Description
          <textarea
            maxLength={10000}
            rows={2}
            value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground sm:col-span-2 lg:col-span-4">
          Image URL (HTTPS)
          <input
            type="url"
            maxLength={2048}
            value={form.imageUrl}
            onChange={(event) => setForm((current) => ({ ...current, imageUrl: event.target.value }))}
            placeholder="https://example.com/offer-image.jpg"
            className={`${inputClass} mt-1`}
          />
          <span className="mt-1 block normal-case tracking-normal">
            Used for the local preview. Live Playerok listings still require a file uploaded through Playerok.
          </span>
        </label>
        {form.imageUrl.trim().startsWith("https://") && (
          <div className="sm:col-span-2 lg:col-span-4">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Preview</p>
            <img
              src={form.imageUrl.trim()}
              alt="Offer image preview"
              referrerPolicy="no-referrer"
              className="max-h-40 max-w-full border-2 border-border object-contain"
            />
          </div>
        )}
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
          <button type="submit" disabled={saving || bulkSaleStatus !== null} className={primaryButton}>
            {saving
              ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              : <Plus className="size-4" aria-hidden="true" />}
            {saving ? "Saving…" : editingExternalId ? "Save changes" : "Add to inventory"}
          </button>
          {editingExternalId && (
            <button type="button" onClick={resetForm} disabled={saving} className={outlineButton}>
              <X className="size-4" aria-hidden="true" />
              Cancel edit
            </button>
          )}
        </div>
      </form>

      {error && <p role="alert" className="border-b-2 border-border px-5 py-3 text-sm font-bold text-negative">{error}</p>}
      {notice && <p role="status" className="border-b-2 border-border px-5 py-3 text-sm font-bold text-primary">{notice}</p>}

      <div className="flex flex-col gap-3 border-b-2 border-border p-5 sm:flex-row">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Search offers</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title, ID, category, or game"
            className={`${inputClass} pl-9`}
          />
        </label>
        <label className="sr-only" htmlFor="offer-visibility">Offer visibility</label>
        <select
          id="offer-visibility"
          value={visibility}
          onChange={(event) => setVisibility(event.target.value as typeof visibility)}
          className={`${inputClass} sm:w-48`}
        >
          <option value="active">Active offers</option>
          <option value="archived">Archived offers</option>
          <option value="all">All offers</option>
        </select>
      </div>

      {filteredOffers.length > 0 && (
        <div className="flex flex-col gap-3 border-b-2 border-border bg-muted/20 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <input
                type="checkbox"
                checked={allVisibleOffersSelected}
                disabled={selectableVisibleOffers.length === 0 || bulkSaleStatus !== null || busyOfferId !== null}
                onChange={(event) => toggleVisibleOfferSelection(event.target.checked)}
                aria-label="Select all eligible visible offers"
              />
              Select all visible ({selectableVisibleOffers.length})
            </label>
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {selectedOffers.length} selected
            </span>
            {selectedOfferIds.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedOfferIds(new Set<string>())}
                disabled={bulkSaleStatus !== null || busyOfferId !== null}
                className="text-xs font-bold uppercase tracking-wider text-primary underline underline-offset-2 disabled:opacity-50"
              >
                Clear selection
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void changeSelectedPlayerokSaleStatus(true)}
              disabled={selectedOffers.length === 0 || busyOfferId !== null || detecting || saving || bulkSaleStatus !== null}
              className={outlineButton}
            >
              <Power className="size-3.5" aria-hidden="true" />
              Put selected on sale
            </button>
            <button
              type="button"
              onClick={() => void changeSelectedPlayerokSaleStatus(false)}
              disabled={selectedOffers.length === 0 || busyOfferId !== null || detecting || saving || bulkSaleStatus !== null}
              className={`${outlineButton} hover:border-negative hover:text-negative`}
            >
              <PowerOff className="size-3.5" aria-hidden="true" />
              Take selected off sale
            </button>
          </div>
          {bulkSaleStatus !== null && (
            <p role="status" className="text-xs font-bold text-primary sm:basis-full">
              Updating Playerok offers: {bulkProgress}
            </p>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Loading local offers…
        </div>
      ) : filteredOffers.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            {search ? "No matching offers" : visibility === "archived" ? "No archived offers" : "No offers yet"}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Add an offer above or sync local mirror data through the batch API.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {filteredOffers.map((offer) => {
            const archived = offer.status === "DELETED"
            const busy = busyOfferId === offer.externalOfferId
            return (
              <article key={offer.externalOfferId} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="flex min-w-0 gap-3">
                  {!archived && isPlayerokOfferId(offer.externalOfferId) && (
                    <label className="flex shrink-0 items-start pt-1">
                      <input
                        type="checkbox"
                        checked={selectedOfferIds.has(offer.externalOfferId)}
                        disabled={bulkSaleStatus !== null || busyOfferId !== null}
                        onChange={(event) => toggleOfferSelection(offer.externalOfferId, event.target.checked)}
                        aria-label={`Select ${offer.title}`}
                      />
                    </label>
                  )}
                  {offer.imageUrl && (
                    <img
                      src={offer.imageUrl}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="size-16 shrink-0 border border-border object-cover"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-bold text-foreground">{offer.title}</h3>
                      <span className={`border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${offerStatusTone(offer.status)}`}>
                        {offer.status}
                      </span>
                      <span className="border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {offer.onSale ? "On sale" : "Off sale"}
                      </span>
                      {offer.keepInSale && (
                        <span className="border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Keep in sale
                        </span>
                      )}
                    </div>
                    <p className="mt-1 break-all text-xs text-muted-foreground">ID: {offer.externalOfferId}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Price {currency(Number(offer.price))}</span>
                      <span>Raw {currency(Number(offer.rawPrice))}</span>
                      <span>Category {offer.categoryId}</span>
                      <span>Game {offer.gameId}</span>
                      <span>Mirror {offer.syncStatus}</span>
                    </div>
                    {offer.description && <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{offer.description}</p>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!archived && isPlayerokOfferId(offer.externalOfferId) && (
                    <button
                      type="button"
                      onClick={() => void changePlayerokSaleStatus(offer)}
                      disabled={busyOfferId !== null || detecting || saving || bulkSaleStatus !== null}
                      className={`${outlineButton} ${offer.onSale ? "hover:border-negative hover:text-negative" : ""}`}
                    >
                      {busy
                        ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        : offer.onSale
                          ? <PowerOff className="size-3.5" aria-hidden="true" />
                          : <Power className="size-3.5" aria-hidden="true" />}
                      {offer.onSale ? "Take off sale" : "Put on sale"}
                    </button>
                  )}
                  <button type="button" onClick={() => startEdit(offer)} disabled={busyOfferId !== null || saving || bulkSaleStatus !== null} className={outlineButton}>
                    <Pencil className="size-3.5" aria-hidden="true" />
                    Edit
                  </button>
                  {archived ? (
                    <button type="button" onClick={() => void restoreOffer(offer)} disabled={busyOfferId !== null || saving || bulkSaleStatus !== null} className={outlineButton}>
                      {busy
                        ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        : <RotateCcw className="size-3.5" aria-hidden="true" />}
                      Restore
                    </button>
                  ) : (
                    <button type="button" onClick={() => void archiveOffer(offer)} disabled={busyOfferId !== null || saving || bulkSaleStatus !== null} className={`${outlineButton} hover:border-negative hover:text-negative`}>
                      {busy
                        ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        : <Archive className="size-3.5" aria-hidden="true" />}
                      Archive
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
