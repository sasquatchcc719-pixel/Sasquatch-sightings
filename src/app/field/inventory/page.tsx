'use client'

/**
 * Truck inventory — field counter. Tap +/- when a jug is used or restocked;
 * the photo makes bottle matching instant. Hitting zero marks the product
 * out of stock (and Foreman stops recommending it).
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Minus, Package, Plus } from 'lucide-react'

type Row = {
  id: string
  name: string
  brand: string | null
  image_url: string | null
  item_type: string
  in_stock: boolean
  quantity_on_hand: number | null
  quantity_unit: string
  reorder_threshold: number | null
}

export default function FieldInventoryPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/field/inventory', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setRows(data.products ?? []))
      .finally(() => setLoading(false))
  }, [])

  const adjust = async (id: string, delta: number) => {
    setBusyId(id)
    try {
      const res = await fetch('/api/field/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: id, delta }),
      })
      const data = await res.json()
      if (res.ok && data.product) {
        setRows((prev) =>
          prev.map((r) => (r.id === id ? (data.product as Row) : r)),
        )
      }
    } finally {
      setBusyId(null)
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100">
      <div className="mx-auto max-w-2xl space-y-3">
        <div className="flex items-center gap-3">
          <Link href="/field" className="text-slate-400 hover:text-white">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Package className="h-5 w-5" /> Truck Inventory
          </h1>
        </div>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : (
          rows.map((r) => {
            const low =
              r.reorder_threshold != null &&
              (r.quantity_on_hand ?? 0) <= r.reorder_threshold
            return (
              <div
                key={r.id}
                className={`flex items-center gap-3 rounded-xl border p-3 ${
                  r.in_stock
                    ? low
                      ? 'border-amber-500/40 bg-amber-500/5'
                      : 'border-white/10 bg-white/5'
                    : 'border-red-500/40 bg-red-500/5 opacity-70'
                }`}
              >
                {r.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.image_url}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-lg bg-white object-contain p-0.5"
                  />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white/10">
                    <Package className="h-5 w-5 text-slate-500" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-slate-400">
                    {r.quantity_on_hand ?? '—'} {r.quantity_unit}
                    {low && r.in_stock ? ' · LOW' : ''}
                    {!r.in_stock ? ' · OUT OF STOCK' : ''}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => adjust(r.id, -1)}
                  className="rounded-lg bg-white/10 p-2.5 hover:bg-white/20 disabled:opacity-40"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => adjust(r.id, 1)}
                  className="rounded-lg bg-white/10 p-2.5 hover:bg-white/20 disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            )
          })
        )}
        <p className="text-xs text-slate-500">
          Used a jug? Tap minus. Restocked? Tap plus. Zero flips a product to
          out-of-stock and Foreman stops recommending it.
        </p>
      </div>
    </main>
  )
}
