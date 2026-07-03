"use client"

import useSWR from "swr"
import type { LedgerData } from "@/lib/types"

const fetcher = async (url: string): Promise<LedgerData> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error("Failed to load ledger")
  return res.json()
}

export function useLedger() {
  const { data, error, isLoading, mutate } = useSWR<LedgerData>("/api/ledger", fetcher, {
    revalidateOnFocus: false,
  })
  return { data, error, isLoading, mutate }
}

export async function apiSend(
  url: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown,
): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || "Request failed")
  }
}
