'use client'

import { useEffect, useState, Suspense } from 'react'
import { Card } from '@/components/ui/card'
import { Send, Loader2 } from 'lucide-react'
import { KeywordWatchlist } from '@/components/admin/gsc/KeywordWatchlist'
import { LeftoverReportsHub } from '@/components/admin/telegram/LeftoverReportsHub'

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

export default function TelegramPage() {
  const [www, setWww] = useState<Point[]>([])
  const [sightings, setSightings] = useState<Point[]>([])
  const [cardUrl, setCardUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/comms/telegram', { cache: 'no-store' })
      .then(async (res) => {
        const data = (await res.json()) as {
          www?: Point[]
          sightings?: Point[]
          latestCardUrl?: string | null
          error?: string
        }
        if (!res.ok) throw new Error(data.error ?? 'Failed to load')
        setWww(data.www ?? [])
        setSightings(data.sightings ?? [])
        setCardUrl(data.latestCardUrl ?? null)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load history')
      })
      .finally(() => setLoading(false))
  }, [])

  const latest = www.at(-1) ?? null
  const prior = www.at(-2) ?? null

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/20">
          <Send className="h-5 w-5 text-sky-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Rankings</h1>
          <p className="text-muted-foreground text-sm">
            Monday you get a push with this card — not Telegram. Other channels
            are the strip above. Edit the keyword list anytime.
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

          {cardUrl && (
            <Card className="overflow-hidden p-0">
              <p className="text-muted-foreground px-4 pt-3 text-xs tracking-wide uppercase">
                Last summary card
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cardUrl}
                alt="Last Google Search summary card"
                className="mt-2 w-full max-w-xl"
                onError={(event) => {
                  event.currentTarget.parentElement?.classList.add('hidden')
                }}
              />
            </Card>
          )}
        </section>
      )}

      <Suspense fallback={null}>
        <LeftoverReportsHub />
      </Suspense>

      <KeywordWatchlist showPageChrome={false} />
    </div>
  )
}
