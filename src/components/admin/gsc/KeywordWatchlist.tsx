'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Search,
  Plus,
  Trash2,
  Loader2,
  ChevronUp,
  Pause,
  Play,
} from 'lucide-react'

type Tone = 'good' | 'warn' | 'bad' | 'neutral'

interface TrendPoint {
  date: string
  position: number | null
  impressions: number
}

export interface WatchlistKeyword {
  id: string
  keyword: string
  active: boolean
  notes: string | null
  backfilledAt: string | null
  createdAt: string
  weeksTracked: number
  page: string | null
  position: number | null
  impressions: number
  clicks: number
  verdict: {
    marker: string
    headline: string
    detail: string | null
    tone: Tone
  }
  trend: TrendPoint[]
}

const TONE_TEXT: Record<Tone, string> = {
  good: 'text-emerald-400',
  warn: 'text-amber-400',
  bad: 'text-red-400',
  neutral: 'text-muted-foreground',
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Position sparkline. Rank is inverted — a better (lower) position draws a
 * taller bar, so "up and to the right" means what everyone expects it to.
 */
function PositionTrend({ points }: { points: TrendPoint[] }) {
  const ranked = points
    .map((point) => point.position)
    .filter((value): value is number => value != null)

  if (ranked.length < 2) {
    return (
      <span className="text-muted-foreground text-xs">
        {ranked.length === 1 ? 'One week of data' : 'No history yet'}
      </span>
    )
  }

  const best = Math.min(...ranked)
  const worst = Math.max(...ranked)
  const span = worst - best || 1

  return (
    <div className="flex h-8 items-end gap-1">
      {points.slice(-10).map((point, index) =>
        point.position == null ? (
          <div
            key={index}
            title={`${formatDate(point.date)} — no views`}
            className="bg-muted-foreground/25 h-1 w-2 rounded-sm"
          />
        ) : (
          <div
            key={index}
            title={`${formatDate(point.date)} — #${Math.round(point.position)}`}
            className="w-2 rounded-sm bg-sky-500/70"
            style={{
              height: `${20 + (1 - (point.position - best) / span) * 80}%`,
            }}
          />
        ),
      )}
    </div>
  )
}

export function KeywordWatchlist({
  showPageChrome = true,
}: {
  /** The standalone Search Rankings page wants its own title and intro. */
  showPageChrome?: boolean
}) {
  const [keywords, setKeywords] = useState<WatchlistKeyword[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const [form, setForm] = useState({ keyword: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setPageError(null)
    try {
      const res = await fetch('/api/admin/marketing/search-rankings/keywords')
      const data = (await res.json()) as {
        keywords?: WatchlistKeyword[]
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to load')
      setKeywords(data.keywords ?? [])
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Failed to load watchlist')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/marketing/search-rankings/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: form.keyword,
          notes: form.notes.trim() || null,
        }),
      })
      const data = (await res.json()) as {
        backfill?: { inserted: number; skipped: number } | null
        backfillError?: string | null
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to add')

      setNotice(
        data.backfillError
          ? `Added, but pulling history from Google failed: ${data.backfillError}`
          : data.backfill
            ? `Added, with ${data.backfill.inserted} weeks of history pulled from Google.`
            : 'Added.',
      )
      setForm({ keyword: '', notes: '' })
      setShowForm(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to add keyword')
    } finally {
      setSaving(false)
    }
  }

  async function togglePause(entry: WatchlistKeyword) {
    setBusyId(entry.id)
    try {
      const res = await fetch(
        `/api/admin/marketing/search-rankings/keywords/${entry.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: !entry.active }),
        },
      )
      if (!res.ok) throw new Error('Failed to update')
      setKeywords((prev) =>
        prev.map((row) =>
          row.id === entry.id ? { ...row, active: !row.active } : row,
        ),
      )
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Failed to update keyword')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(
        `/api/admin/marketing/search-rankings/keywords/${id}`,
        { method: 'DELETE' },
      )
      if (!res.ok) throw new Error('Failed to remove')
      setKeywords((prev) => prev.filter((row) => row.id !== id))
      setConfirmDelete(null)
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Failed to remove keyword')
    } finally {
      setBusyId(null)
    }
  }

  const activeCount = keywords.filter((row) => row.active).length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {showPageChrome ? (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/20">
              <Search className="h-5 w-5 text-sky-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Search Rankings</h1>
              <p className="text-muted-foreground text-sm">
                {activeCount} {activeCount === 1 ? 'keyword' : 'keywords'}{' '}
                tracked in the Monday Google Search report
              </p>
            </div>
          </div>
        ) : (
          <div>
            <h2 className="text-lg font-semibold">Keywords we track</h2>
            <p className="text-muted-foreground text-sm">
              {activeCount} {activeCount === 1 ? 'keyword' : 'keywords'} named
              in Monday&apos;s Google Search Telegram
            </p>
          </div>
        )}
        <Button onClick={() => setShowForm((v) => !v)} className="gap-2">
          {showForm ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {showForm ? 'Cancel' : 'Track Keyword'}
        </Button>
      </div>

      {showPageChrome && (
        <Card className="text-muted-foreground p-4 text-sm">
          These are the keywords called out by name in the weekly Google Search
          report on Telegram. Adding one pulls its last 8 weeks from Google
          straight away, so its trend is real on the very next report instead of
          filling in over two months. Google only reports keywords that actually
          got views — a term you don&apos;t rank for at all will sit here saying
          &ldquo;no views yet&rdquo;.
        </Card>
      )}

      {notice && (
        <Card className="border-emerald-500/30 p-4 text-sm text-emerald-300">
          {notice}
        </Card>
      )}

      {showForm && (
        <Card className="border-sky-500/30 p-5">
          <h2 className="mb-4 font-semibold">Track a Keyword</h2>
          <form onSubmit={handleAdd} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="kw">Keyword *</Label>
              <Input
                id="kw"
                value={form.keyword}
                onChange={(e) =>
                  setForm((f) => ({ ...f, keyword: e.target.value }))
                }
                placeholder="upholstery cleaning colorado springs"
                required
              />
              <p className="text-muted-foreground text-xs">
                Type it the way a customer would search it.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="kw-notes">Note (optional)</Label>
              <Input
                id="kw-notes"
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
                placeholder="Why this one matters"
              />
            </div>

            {formError && (
              <p className="text-destructive text-sm sm:col-span-2">
                {formError}
              </p>
            )}

            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {saving ? 'Pulling history from Google…' : 'Track Keyword'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {pageError && (
        <Card className="border-destructive/40 text-destructive p-4 text-sm">
          {pageError}
        </Card>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      )}

      {!loading && keywords.length === 0 && (
        <Card className="text-muted-foreground p-8 text-center text-sm">
          No keywords tracked. The weekly report will skip the keyword section
          entirely until you add one.
        </Card>
      )}

      {!loading &&
        keywords.map((entry) => (
          <Card
            key={entry.id}
            className={`p-4 ${entry.active ? '' : 'opacity-50'}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{entry.keyword}</span>
                  <span className={`text-sm ${TONE_TEXT[entry.verdict.tone]}`}>
                    {entry.verdict.marker} {entry.verdict.headline}
                  </span>
                  {!entry.active && (
                    <span className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-xs">
                      paused
                    </span>
                  )}
                </div>

                {entry.verdict.detail && (
                  <p className="text-muted-foreground text-sm">
                    {entry.verdict.detail}
                  </p>
                )}

                <p className="text-muted-foreground text-xs">
                  {entry.weeksTracked}{' '}
                  {entry.weeksTracked === 1 ? 'week' : 'weeks'} of history
                  {entry.impressions > 0 && ` · ${entry.impressions} views`}
                  {entry.clicks > 0 && ` · ${entry.clicks} clicks`}
                  {entry.notes && ` · ${entry.notes}`}
                </p>

                {entry.page && (
                  <p className="text-muted-foreground truncate text-xs">
                    Ranking page: {entry.page.replace(/^https?:\/\/[^/]+/, '')}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3">
                <PositionTrend points={entry.trend} />

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyId === entry.id}
                  onClick={() => void togglePause(entry)}
                  title={
                    entry.active
                      ? 'Stop including this in the weekly report'
                      : 'Include this in the weekly report again'
                  }
                >
                  {entry.active ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </Button>

                {confirmDelete === entry.id ? (
                  <div className="flex gap-1">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busyId === entry.id}
                      onClick={() => void handleDelete(entry.id)}
                    >
                      {busyId === entry.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'Remove'
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDelete(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(entry.id)}
                    title="Remove from the watchlist"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
    </div>
  )
}
