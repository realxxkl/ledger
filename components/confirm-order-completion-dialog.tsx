"use client"

import { useEffect, useRef } from "react"

export function ConfirmOrderCompletionDialog({
  open,
  orderLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean
  orderLabel: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  if (!open) return null

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="complete-order-title"
      aria-describedby="complete-order-description"
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-lg border-2 border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-background/80 backdrop:backdrop-blur-sm"
    >
      <div className="border-b-2 border-border p-5 sm:p-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Confirm order update</p>
        <h2 id="complete-order-title" className="mt-2 font-display text-2xl font-black uppercase tracking-tight">
          Are you sure?
        </h2>
        <p id="complete-order-description" className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Mark {orderLabel} as completed? This updates the ledger only; the saved Epic session will remain available.
        </p>
      </div>
      <div className="flex flex-col-reverse gap-2 p-5 sm:flex-row sm:justify-end sm:p-6">
        <button
          type="button"
          autoFocus
          onClick={onCancel}
          className="border-2 border-border px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
        >
          Keep order open
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="border-2 border-primary bg-primary px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          Yes, complete order
        </button>
      </div>
    </dialog>
  )
}
