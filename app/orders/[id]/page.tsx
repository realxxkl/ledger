import { OrderDetail } from "@/components/order-detail"

export const metadata = { title: "Order details | The Ledger" }

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <p className="mb-6 text-xs font-bold uppercase tracking-[0.25em] text-primary">The Ledger · Order record</p>
        <OrderDetail orderId={id} />
      </div>
    </main>
  )
}
