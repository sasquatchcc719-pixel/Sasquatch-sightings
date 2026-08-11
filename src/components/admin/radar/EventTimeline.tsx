'use client'

/**
 * Dated interventions, newest first — the "why" column for every rank chart.
 *
 * Exists because of a specific failure: a rank discontinuity on 2026-06-30 was
 * attributed to a competitor editing their listing, when it was actually our
 * own commit changing how Radar measured. Reading a number without its cause is
 * how that happens, so `instrument` events are styled loudest of all.
 */

import { useCallback, useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Plus, X, AlertTriangle, History } from 'lucide-react'

type MarketingEvent = {
  id: string
  occurred_at: string
  category: string
  title: string
  detail: string | null
  town_slugs: string[] | null
  source: string
  external_ref: string | null
}

/**
 * `instrument` is deliberately the alarm colour. A change to how we MEASURE
 * looks exactly like a change in the business until someone says otherwise,
 * and that ambiguity has already cost a full day of wrong conclusions.
 */
const CATEGORY_STYLE: Record<string, { chip: string; label: string }> = {
  instrument: { chip: 'bg-red-500/15 text-red-300 border-red-500/40', label: 'instrument' },
  gbp: { chip: 'bg-amber-500/15 text-amber-300 border-amber-500/40', label: 'GBP' },
  competitor: { chip: 'bg-purple-500/15 text-purple-300 border-purple-500/40', label: 'competitor' },
  marketing: { chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', label: 'marketing' },
  website: { chip: 'bg-blue-500/15 text-blue-300 border-blue-500/40', label: 'website' },
  reviews: { chip: 'bg-teal-500/15 text-teal-300 border-teal-500/40', label: 'reviews' },
  external: { chip: 'bg-slate-500/15 text-slate-300 border-slate-500/40', label: 'external' },
}

const CATEGORIES = Object.keys(CATEGORY_STYLE)

function styleFor(category: string) {
  return (
    CATEGORY_STYLE[category] ?? {
      chip: 'bg-white/10 text-white/60 border-white/20',
      label: category,
    }
  )
}

export function EventTimeline() {
  const [events, setEvents] = useState<MarketingEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/marketing/events')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      setEvents(json.events ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const shown = filter ? events.filter((e) => e.category === filter) : events

  return (
    <Card className="border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <History className="h-4 w-4 text-white/50" />
        <h3 className="text-sm font-semibold text-white">What changed, and when</h3>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-md border border-white/15 bg-slate-900 px-2 py-1 text-xs text-white"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {styleFor(c).label}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
            {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
            {adding ? '' : 'Log an event'}
          </Button>
        </div>
      </div>

      <p className="mb-3 text-xs text-white/40">
        Log anything that could move a number — an ad campaign, a GBP edit, a
        competitor move. Red <span className="font-medium text-red-300">instrument</span>{' '}
        entries mean the measurement changed, not the business.
      </p>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {adding && <AddEvent onDone={() => { setAdding(false); void load() }} />}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-white/60">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : !shown.length ? (
        <p className="py-2 text-sm text-white/50">No events logged yet.</p>
      ) : (
        <ol className="space-y-2">
          {shown.map((e) => {
            const s = styleFor(e.category)
            return (
              <li
                key={e.id}
                className="rounded-lg border border-white/10 bg-slate-900/40 px-3 py-2"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs text-white/50">
                    {new Date(e.occurred_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                  <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${s.chip}`}>
                    {s.label}
                  </span>
                  <span className="text-sm font-medium text-white">{e.title}</span>
                </div>
                {e.detail && (
                  <p className="mt-1 text-xs leading-relaxed text-white/60">{e.detail}</p>
                )}
                {(e.external_ref || (e.town_slugs?.length ?? 0) > 0) && (
                  <p className="mt-1 font-mono text-[10px] text-white/30">
                    {e.external_ref}
                    {e.external_ref && e.town_slugs?.length ? ' · ' : ''}
                    {e.town_slugs?.join(', ')}
                  </p>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}

function AddEvent({ onDone }: { onDone: () => void }) {
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10))
  const [category, setCategory] = useState('marketing')
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/api/admin/marketing/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          occurred_at: new Date(`${occurredAt}T12:00:00`).toISOString(),
          category,
          title,
          detail: detail || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to save')
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-3 rounded-lg border border-emerald-500/30 bg-slate-900/60 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label className="text-xs text-white/60">Date</Label>
          <Input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-white/60">Category</Label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 w-full rounded-md border border-white/15 bg-slate-900 px-2 text-sm text-white"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {styleFor(c).label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <Label className="text-xs text-white/60">What happened</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Dropped 500 door hangers in Gleneagle"
          />
        </div>
        <div className="sm:col-span-2">
          <Label className="text-xs text-white/60">Detail (optional)</Label>
          <Input
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="Anything future-you would need to interpret a chart"
          />
        </div>
      </div>
      {err && <p className="mt-2 text-sm text-red-300">{err}</p>}
      <div className="mt-2 flex justify-end">
        <Button size="sm" onClick={submit} disabled={busy || !title.trim()}>
          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save
        </Button>
      </div>
    </div>
  )
}
