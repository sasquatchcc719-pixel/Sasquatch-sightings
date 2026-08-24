'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Send, Loader2 } from 'lucide-react'
import { KeywordWatchlist } from '@/components/admin/gsc/KeywordWatchlist'

type Point = {
  date: string
  clicks: number
  impressions: number
  ctr: number
  position: number | null
}

function formatShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Denver',
  })
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

function WeekBars({
  points,
  valueOf,
  accentClass,
  formatValue,
  invert = false,
}: {
  points: Point[]
  valueOf: (point: Point) => number | null
  accentClass: string
  formatValue: (value: number) => string
  /** When true, a smaller value draws a taller bar (rank: lower is better). */
  invert?: boolean
}) {
  const values = points
    .map(valueOf)
    .filter((value): value is number => value != null)
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = max - min || 1

  if (points.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No weekly snapshots yet.</p>
    )
  }

  return (
    <div className="flex h-40 items-end gap-2">
      {points.map((point, index) => {
        const value = valueOf(point)
        const isCurrent = index === points.length - 1
        const height =
          value == null
            ? 4
            : Math.max(
                8,
                Math.round((invert ? (max - value) / span : value / max) * 120),
              )
        return (
          <div
            key={point.date}
            className="flex min-w-0 flex-1 flex-col items-center justify-end"
            title={
              value == null
                ? `${formatShort(point.date)} — no data`
                : `${formatShort(point.date)} — ${formatValue(value)}`
            }
          >
            <span
              className={`mb-1 text-[11px] ${isCurrent ? 'text-sky-300' : 'text-muted-foreground'}`}
            >
              {value == null ? '—' : formatValue(value)}
            </span>
            <div
              className={`w-full max-w-8 rounded-sm ${
                value == null
                  ? 'bg-white/10'
                  : isCurrent
                    ? accentClass
                    : 'bg-white/20'
              }`}
              style={{ height }}
            />
            <span className="text-muted-foreground mt-1 text-[10px]">
              {formatShort(point.date)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

const OTHER_REPORTS = [
  {
    name: 'Search Console coverage',
    when: 'Mondays at 8:00am',
    what: 'Pages Google dropped or stopped indexing.',
  },
  {
    name: 'Marketing weekly rollup',
    when: 'Mondays at 9:30am',
    what: 'Spend, rank, demand, and jobs by town.',
  },
  {
    name: 'Inventory and maintenance',
    when: 'Every afternoon',
    what: 'Low chemicals, due service on a truck.',
  },
]

export default function TelegramPage() {
  const [www, setWww] = useState<Point[]>([])
  const [sightings, setSightings] = useState<Point[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/comms/telegram', { cache: 'no-store' })
      .then(async (res) => {
        const data = (await res.json()) as {
          www?: Point[]
          sightings?: Point[]
          error?: string
        }
        if (!res.ok) throw new Error(data.error ?? 'Failed to load')
        setWww(data.www ?? [])
        setSightings(data.sightings ?? [])
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load history')
      })
      .finally(() => setLoading(false))
  }, [])

  const latest = www.at(-1) ?? null
  const prior = www.at(-2) ?? null

  return (
    <div className="space-y-8 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/20">
          <Send className="h-5 w-5 text-sky-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Telegram</h1>
          <p className="text-muted-foreground text-sm">
            Rankings live here. Monday you get a short push with the headline —
            tap it to open this page. Edit the keyword list anytime.
          </p>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/40 text-destructive p-4 text-sm">
          {error}
        </Card>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      )}

      {!loading && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Main site, last 8 weeks</h2>
            <p className="text-muted-foreground text-sm">
              Same numbers as Monday&apos;s push. Lower rank is better.
            </p>
          </div>

          {latest && (
            <div className="grid gap-3 sm:grid-cols-4">
              <Card className="p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">
                  Visits from Google
                </p>
                <p className="mt-1 text-3xl font-semibold">
                  {formatCount(latest.clicks)}
                </p>
                {prior && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    {latest.clicks - prior.clicks === 0
                      ? 'Same as the week before'
                      : `${formatCount(Math.abs(latest.clicks - prior.clicks))} ${latest.clicks > prior.clicks ? 'more' : 'fewer'} than the week before`}
                  </p>
                )}
              </Card>
              <Card className="p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">
                  Times we showed up
                </p>
                <p className="mt-1 text-3xl font-semibold">
                  {formatCount(latest.impressions)}
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">
                  Click rate
                </p>
                <p className="mt-1 text-3xl font-semibold">
                  {(latest.ctr * 100).toFixed(1)}%
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">
                  Average rank
                </p>
                <p className="mt-1 text-3xl font-semibold">
                  {latest.position == null
                    ? '—'
                    : `#${latest.position.toFixed(1)}`}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Lower is better
                </p>
              </Card>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <p className="text-muted-foreground mb-3 text-xs tracking-wide uppercase">
                Visits from Google, by week
              </p>
              <WeekBars
                points={www.slice(-8)}
                valueOf={(point) => point.clicks}
                accentClass="bg-sky-400"
                formatValue={formatCount}
              />
            </Card>
            <Card className="p-4">
              <p className="text-muted-foreground mb-3 text-xs tracking-wide uppercase">
                Average rank, by week (lower is better)
              </p>
              <WeekBars
                points={www.slice(-8)}
                valueOf={(point) => point.position}
                accentClass="bg-emerald-400"
                formatValue={(value) => `#${value.toFixed(1)}`}
                invert
              />
            </Card>
          </div>

          {sightings.length > 0 && (
            <Card className="p-4">
              <p className="text-muted-foreground mb-3 text-xs tracking-wide uppercase">
                Sightings site — visits, by week
              </p>
              <WeekBars
                points={sightings.slice(-8)}
                valueOf={(point) => point.clicks}
                accentClass="bg-amber-400"
                formatValue={formatCount}
              />
            </Card>
          )}
        </section>
      )}

      <KeywordWatchlist showPageChrome={false} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">What else lands on Telegram</h2>
        <Card className="divide-y divide-white/10">
          {OTHER_REPORTS.map((report) => (
            <div key={report.name} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{report.name}</p>
                <p className="text-muted-foreground text-xs">{report.when}</p>
              </div>
              <p className="text-muted-foreground mt-0.5 text-sm">
                {report.what}
              </p>
            </div>
          ))}
        </Card>
      </section>
    </div>
  )
}
