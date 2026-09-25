"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"

export function AuthForm({ mode }: { mode: "setup" | "sign-in" }) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError("")

    const result =
      mode === "setup"
        ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password })

    if (result.error) {
      setError(mode === "setup" ? "Owner setup could not be completed." : "Email or password is incorrect.")
      setPending(false)
      return
    }

    router.push("/")
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-5" aria-label={mode === "setup" ? "Owner setup" : "Sign in"}>
      {mode === "setup" && (
        <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Name
          <input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className="border-2 border-border bg-background px-4 py-3 text-base font-normal normal-case tracking-normal text-foreground outline-none focus:border-primary" />
        </label>
      )}
      <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Email
        <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="border-2 border-border bg-background px-4 py-3 text-base font-normal normal-case tracking-normal text-foreground outline-none focus:border-primary" />
      </label>
      <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Password
        <input required minLength={8} type="password" autoComplete={mode === "setup" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} className="border-2 border-border bg-background px-4 py-3 text-base font-normal normal-case tracking-normal text-foreground outline-none focus:border-primary" />
      </label>
      {error && <p role="alert" className="text-sm text-negative">{error}</p>}
      <button disabled={pending} className="bg-primary px-5 py-3 text-sm font-black uppercase tracking-wider text-primary-foreground disabled:opacity-60">
        {pending ? "Please wait…" : mode === "setup" ? "Create owner account" : "Unlock ledger"}
      </button>
    </form>
  )
}
