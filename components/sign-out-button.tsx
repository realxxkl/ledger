"use client"

import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"

export function SignOutButton() {
  const router = useRouter()

  return (
    <button
      type="button"
      onClick={async () => {
        await authClient.signOut()
        router.push("/sign-in")
        router.refresh()
      }}
      className="border-2 border-border px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
    >
      Sign out
    </button>
  )
}
