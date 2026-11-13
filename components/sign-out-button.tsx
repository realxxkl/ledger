"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { LoaderCircle } from "lucide-react"
import { authClient } from "@/lib/auth-client"

export function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    try {
      await authClient.signOut()
      router.push("/sign-in")
      router.refresh()
    } catch {
      setPending(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={signOut}
        disabled={pending}
        className="border-2 border-border px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:cursor-wait disabled:opacity-60"
      >
        {pending && <LoaderCircle className="mr-2 inline size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </>
  )
}
