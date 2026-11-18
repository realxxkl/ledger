"use client"

import { FormEvent, useCallback, useEffect, useState } from "react"
import { Archive, ExternalLink, LoaderCircle, Pencil, Plus, RefreshCw, RotateCcw, Search, X } from "lucide-react"
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
  status: string
  keepInSale: boolean
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
      "status" in value && typeof value.status === "string" &&
      "keepInSale" in value && typeof value.keepInSale === "boolean" &&
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

  const activeCount = offers.filter((offer) => offer.status !== "DELETED").length
  const archivedCount = offers.length - activeCount

  return (
    <section className="border-2 border-border bg-card">
      <header className="flex flex-col gap-3 border-b-2 border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Local catalog</p>
          <h2 className="mt-1 font-display text-2xl font-black uppercase tracking-tight">Offers</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {activeCount} active · {archivedCount} archived. Changes here do not publish to Playerok.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
          <button type="submit" disabled={saving} className={primaryButton}>
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
                        {offer.keepInSale ? "In sale" : "Not in sale"}
                      </span>
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
                  <button type="button" onClick={() => startEdit(offer)} className={outlineButton}>
                    <Pencil className="size-3.5" aria-hidden="true" />
                    Edit
                  </button>
                  {archived ? (
                    <button type="button" onClick={() => void restoreOffer(offer)} disabled={busyOfferId !== null} className={outlineButton}>
                      {busy
                        ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        : <RotateCcw className="size-3.5" aria-hidden="true" />}
                      Restore
                    </button>
                  ) : (
                    <button type="button" onClick={() => void archiveOffer(offer)} disabled={busyOfferId !== null} className={`${outlineButton} hover:border-negative hover:text-negative`}>
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
