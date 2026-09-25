import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { AuthForm } from "@/components/auth-form"
import { auth } from "@/lib/auth"
import { pool } from "@/lib/db"

export default async function SetupPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (session?.user) redirect("/")

  const result = await pool.query<{ exists: boolean }>('SELECT EXISTS (SELECT 1 FROM public."user") AS exists')
  if (result.rows[0]?.exists) redirect("/sign-in")

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <section className="w-full max-w-md border-2 border-border bg-card p-6 sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-primary">One-time setup</p>
        <h1 className="mt-3 font-display text-4xl font-black uppercase tracking-tight text-foreground">Create owner</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Create the only account that can access this shared ledger. Existing ledger data will remain unchanged.</p>
        <div className="mt-8"><AuthForm mode="setup" /></div>
      </section>
    </main>
  )
}
