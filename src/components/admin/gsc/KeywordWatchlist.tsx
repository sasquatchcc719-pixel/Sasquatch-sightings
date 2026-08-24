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
  ChevronDown,
  Pause,
  Play,
} from 'lucide-react'

type Tone = 'good' | 'warn' | 'bad' | 'neutral'

interface TrendPoint {
  date: string
  position: number | null
  impressions: number
  clicks: number
  page?: string | null
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
    timeZone: 'America/Denver',
  })
}

function shortPage(page: string | null | undefined): string {
  if (!page) return '—'
  return page.replace(/^https?:\/\/[^/]+/, '') || '/'
}

function clickRate(clicks: number, impressions: number): string {
  if (impressions <= 0) return '—'
  return `${((clicks / impressions) * 100).toFixed(1)}%`
}

function WeekTable({ points }: { points: TrendPoint[] }) {
  const weeks = [...points].reverse()
  if (weeks.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No weekly snapshots yet.</p>
    )
  }

  const ranked = points
    .map((point) => point.position)
    .filter((value): value is number => value != null)
  const totalViews = points.reduce((sum, point) => sum + point.impressions, 0)
  const totalClicks = points.reduce((sum, point) => sum + point.clicks, 0)
  const pages = new Set(
    points.map((point) => shortPage(point.page)).filter((page) => page !== '—'),
  )

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        {ranked.length > 0 && (
          <>
            Best rank #{Math.round(Math.min(...ranked))} · worst #
            {Math.round(Math.max(...ranked))}
            {' · '}
          </>
        )}
        {totalViews} views across these weeks
        {totalClicks > 0 ? ` · ${totalClicks} clicks` : ' · no clicks'}
        {pages.size > 1 ? ` · ranked on ${pages.size} different pages` : ''}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="text-muted-foreground text-xs tracking-wide uppercase">
              <th className="pr-3 pb-2 font-medium">Week</th>
              <th className="pr-3 pb-2 font-medium">Rank</th>
              <th className="pr-3 pb-2 font-medium">Views</th>
              <th className="pr-3 pb-2 font-medium">Clicks</th>
              <th className="pr-3 pb-2 font-medium">Click rate</th>
              <th className="pb-2 font-medium">Ranking page</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((point, index) => (
              <tr
                key={`${point.date}-${index}`}
                className="border-t border-white/10"
              >
                <td className="py-2 pr-3 whitespace-nowrap">
                  {formatDate(point.date)}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {point.position == null
                    ? '—'
                    : `#${Math.round(point.position)}`}
                </td>
                <td className="py-2 pr-3 tabular-nums">{point.impressions}</td>
                <td className="py-2 pr-3 tabular-nums">{point.clicks}</td>
                <td className="py-2 pr-3 tabular-nums">
                  {clickRate(point.clicks, point.impressions)}
                </td>
                <td
                  className="text-muted-foreground max-w-[280px] truncate py-2"
                  title={point.page ?? undefined}
                >
                  {shortPage(point.page)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground text-xs">
        Search Console only reports a keyword in a week if someone actually saw
        us for it. A dash is no views, not rank zero.
      </p>
    </div>
  )
}

/**
 * Weekly rank chart. Bar height is inverted so a better (lower) rank draws a
 * taller bar. The number on top is the rank. Views sit under the date — that
 * is the other number Search Console gives us besides position and clicks.
 */
function RankHistory({ points }: { points: TrendPoint[] }) {
  const weeks = points.slice(-10)
  const ranked = weeks
    .map((point) => point.position)
    .filter((value): value is number => value != null)

  if (weeks.length === 0) {
    return <p className="text-muted-foreground text-xs">No history yet</p>
  }

  const best = ranked.length > 0 ? Math.min(...ranked) : 1
  const worst = ranked.length > 0 ? Math.max(...ranked) : 1
  const span = worst - best || 1

  return (
    <div>
      <p className="text-muted-foreground mb-2 text-[11px] tracking-wide uppercase">
        Rank by week · lower is better
      </p>
      <div className="flex h-36 items-end gap-1 sm:gap-2">
        {weeks.map((point, index) => {
          const isCurrent = index === weeks.length - 1
          const value = point.position
          const height =
            value == null
              ? 4
              : Math.max(10, Math.round((1 - (value - best) / span) * 96))
          const title =
            value == null
              ? `${formatDate(point.date)} — no views`
              : `${formatDate(point.date)} — #${Math.round(value)} · ${point.impressions} view${point.impressions === 1 ? '' : 's'}${point.clicks > 0 ? ` · ${point.clicks} click${point.clicks === 1 ? '' : 's'}` : ''}`
          return (
            <div
              key={`${point.date}-${index}`}
              className="flex min-w-0 flex-1 flex-col items-center justify-end"
              title={title}
            >
              <span
                className={`mb-1 text-[11px] tabular-nums ${isCurrent ? 'text-sky-300' : 'text-muted-foreground'}`}
              >
                {value == null ? '—' : `#${Math.round(value)}`}
              </span>
              <div
                className={`w-full max-w-10 rounded-sm ${
                  value == null
                    ? 'bg-white/10'
                    : isCurrent
                      ? 'bg-sky-400'
                      : 'bg-sky-500/55'
                }`}
                style={{ height }}
              />
              <span className="text-muted-foreground mt-1 text-[10px] leading-tight">
                {formatDate(point.date)}
              </span>
              <span className="text-muted-foreground/80 text-[10px] tabular-nums">
                {point.impressions}v
                {point.clicks > 0 ? ` · ${point.clicks}c` : ''}
              </span>
            </div>
          )
        })}
      </div>
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
  const [expandedId, setExpandedId] = useState<string | null>(null)

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
                tracked in the Monday Google Search push
              </p>
            </div>
          </div>
        ) : (
          <div>
            <h2 className="text-lg font-semibold">Keywords we track</h2>
            <p className="text-muted-foreground text-sm">
              {activeCount} {activeCount === 1 ? 'keyword' : 'keywords'} named
              in Monday&apos;s Google Search push
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
          push. Adding one pulls its last 8 weeks from Google straight away, so
          its trend is real on the very next report instead of filling in over
          two months. Google only reports keywords that actually got views — a
          term you don&apos;t rank for at all will sit here saying &ldquo;no
          views yet&rdquo;.
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
            className={`cursor-pointer p-4 ${entry.active ? '' : 'opacity-50'}`}
            onClick={() =>
              setExpandedId((current) =>
                current === entry.id ? null : entry.id,
              )
            }
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
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
                    Ranking page: {shortPage(entry.page)}
                  </p>
                )}
              </div>

              <div
                className="flex items-center gap-1"
                onClick={(event) => event.stopPropagation()}
              >
                {expandedId === entry.id ? (
                  <ChevronUp className="text-muted-foreground mr-1 h-4 w-4" />
                ) : (
                  <ChevronDown className="text-muted-foreground mr-1 h-4 w-4" />
                )}
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

            <div className="mt-4">
              <RankHistory points={entry.trend} />
            </div>

            {expandedId === entry.id && (
              <div
                className="mt-4 border-t border-white/10 pt-4"
                onClick={(event) => event.stopPropagation()}
              >
                <WeekTable points={entry.trend} />
              </div>
            )}
          </Card>
        ))}
    </div>
  )
}
