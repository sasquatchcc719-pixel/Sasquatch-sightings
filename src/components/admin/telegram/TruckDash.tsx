'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ReportShell,
  SettingsPanel,
} from '@/components/admin/telegram/ReportShell'
import { Loader2 } from 'lucide-react'

type Product = {
  id: string
  name: string
  brand: string | null
  quantity_on_hand: number | string | null
  quantity_unit: string | null
  reorder_threshold: number | string | null
}

type Task = { id: string; title: string; status: string; triggered_at: string }
type Rule = {
  id: string
  asset_id: string
  task_name: string
  interval_value: number
  interval_unit: string
}
type Asset = { id: string; name: string }

function formatWhen(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function TruckDash() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [lastSent, setLastSent] = useState<string | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [low, setLow] = useState<Product[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/comms/telegram/truck', {
      cache: 'no-store',
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Failed to load')
    setMessage(json.message)
    setLastSent(json.lastSent)
    setProducts(json.products ?? [])
    setLow(json.low ?? [])
    setTasks(json.tasks ?? [])
    setRules(json.rules ?? [])
    setAssets(json.assets ?? [])
    const next: Record<string, string> = {}
    for (const p of json.products ?? []) {
      next[p.id] = String(p.reorder_threshold ?? '')
    }
    setDrafts(next)
  }, [])

  useEffect(() => {
    load()
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load'),
      )
      .finally(() => setLoading(false))
  }, [load])

  async function saveThreshold(id: string) {
    setSaving(id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/chemicals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reorder_threshold: drafts[id] === '' ? null : Number(drafts[id]),
        }),
      })
      if (!res.ok) throw new Error('Could not save')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-white/40" />
      </div>
    )
  }

  const assetName = (id: string) =>
    assets.find((a) => a.id === id)?.name ?? 'Machine'

  return (
    <ReportShell
      kicker="Telegram channel"
      title="Truck"
      lede="Chemicals at reorder and machines that hit their interval. Telegram only speaks when something crosses the line — change the line here."
      when="8:00am inventory · 8:15am maintenance"
      lastSent={formatWhen(lastSent)}
      message={
        message ?? 'Quiet. Nothing is below reorder and no maintenance is open.'
      }
      settings={
        <SettingsPanel
          title="Reorder points"
          hint="Saving a number here is what arms the afternoon Telegram. Full SDS and dilutions stay on Chemicals."
        >
          <div className="max-h-[32rem] space-y-3 overflow-auto pr-1">
            {products.map((product) => (
              <div
                key={product.id}
                className="rounded-xl border border-white/10 p-3"
              >
                <p className="text-sm text-white">{product.name}</p>
                <p className="text-[11px] text-white/40">
                  On hand {product.quantity_on_hand ?? '—'}{' '}
                  {product.quantity_unit}
                </p>
                <div className="mt-2 flex gap-2">
                  <Input
                    type="number"
                    value={drafts[product.id] ?? ''}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [product.id]: e.target.value,
                      }))
                    }
                    className="border-white/15 bg-white/5 text-white"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void saveThreshold(product.id)}
                    disabled={saving === product.id}
                    className="bg-amber-400 text-stone-950 hover:bg-amber-300"
                  >
                    Save
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </SettingsPanel>
      }
    >
      {error ? (
        <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
          <p className="text-[11px] tracking-wide text-white/40 uppercase">
            Below reorder
          </p>
          <p
            className="mt-1 text-5xl text-amber-300"
            style={{
              fontFamily: 'var(--font-telegram-display), Georgia, serif',
            }}
          >
            {low.length}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
          <p className="text-[11px] tracking-wide text-white/40 uppercase">
            Open maintenance
          </p>
          <p
            className="mt-1 text-5xl text-white"
            style={{
              fontFamily: 'var(--font-telegram-display), Georgia, serif',
            }}
          >
            {tasks.length}
          </p>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-black/30 p-5">
        <h2
          className="text-2xl text-white"
          style={{ fontFamily: 'var(--font-telegram-display), Georgia, serif' }}
        >
          Side-work queue
        </h2>
        {tasks.length === 0 ? (
          <p className="mt-2 text-sm text-white/50">Nothing waiting.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm text-white/80">
            {tasks.map((task) => (
              <li key={task.id}>{task.title}</li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-[11px] tracking-wide text-white/40 uppercase">
          Active intervals
        </p>
        <ul className="mt-2 space-y-1 text-sm text-white/60">
          {rules.map((rule) => (
            <li key={rule.id}>
              {assetName(rule.asset_id)} · {rule.task_name} every{' '}
              {rule.interval_value} {rule.interval_unit}
            </li>
          ))}
        </ul>
      </section>
    </ReportShell>
  )
}
