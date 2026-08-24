'use client'

import { useEffect, useState } from 'react'
import {
  ReportShell,
  SettingsPanel,
} from '@/components/admin/telegram/ReportShell'
import { Loader2 } from 'lucide-react'

type Review = {
  review_id: string
  author: string | null
  rating: number | string | null
  snippet: string | null
  first_seen_at: string
  missing_since: string | null
}

type Pull = {
  pulled_at: string
  aggregate_count: number | null
  returned_count: number
  count_mismatch: boolean
  newly_missing: number
}

type Count = {
  captured_on: string
  total_on_google: number | null
  stored_reviews: number
}

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

export function ReviewsDash() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<{
    cid: string
    lastSent: string | null
    liveCount: number | null
    returnedCount: number | null
    rating: number | null
    mismatch: boolean
    missing: Review[]
    reviews: Review[]
    pulls: Pull[]
    counts: Count[]
    message: string | null
  } | null>(null)

  useEffect(() => {
    fetch('/api/admin/comms/telegram/reviews', { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Failed to load')
        setData(json)
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load'),
      )
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-white/40" />
      </div>
    )
  }

  const maxCount = Math.max(
    ...(data?.counts.map((c) => c.total_on_google ?? 0) ?? [1]),
    1,
  )

  return (
    <ReportShell
      kicker="Telegram channel"
      title="Google reviews"
      lede="The watchdog only texts when a review vanishes or Google's public count disagrees with the list. New reviews ping separately with Radar Daily."
      when="Every morning at 6:10am"
      lastSent={formatWhen(data?.lastSent ?? null)}
      message={data?.message}
      settings={
        <SettingsPanel
          title="Watch settings"
          hint="The listing is pinned to Sasquatch's Google CID. Changing it is an environment variable, not a click — on purpose, so this never silently watches the wrong shop."
        >
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-[11px] tracking-wide text-white/40 uppercase">
              Google CID
            </p>
            <p className="mt-1 font-mono text-sm break-all text-white">
              {data?.cid}
            </p>
          </div>
          <p className="text-sm text-white/55">
            Alerts fire on a change, not a standing problem. A mismatch that
            lasts three days will not ping three times.
          </p>
        </SettingsPanel>
      }
    >
      {error ? (
        <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Showing on Google', value: data?.liveCount ?? '—' },
          { label: 'Returned in the list', value: data?.returnedCount ?? '—' },
          {
            label: 'Star average',
            value: data?.rating == null ? '—' : Number(data.rating).toFixed(2),
          },
        ].map((tile) => (
          <div
            key={tile.label}
            className="rounded-2xl border border-white/10 bg-black/30 p-4"
          >
            <p className="text-[11px] tracking-wide text-white/40 uppercase">
              {tile.label}
            </p>
            <p
              className="mt-1 text-4xl text-white"
              style={{
                fontFamily: 'var(--font-telegram-display), Georgia, serif',
              }}
            >
              {tile.value}
            </p>
          </div>
        ))}
      </section>

      {data?.mismatch ? (
        <p className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          Google&apos;s displayed count does not match the reviews it returned.
          That is ticket evidence, not a missing review.
        </p>
      ) : null}

      {data?.counts.length ? (
        <section className="rounded-3xl border border-white/10 bg-black/30 p-5">
          <p className="mb-3 text-[11px] tracking-[0.2em] text-white/40 uppercase">
            Public review count
          </p>
          <div className="flex h-28 items-end gap-1">
            {data.counts.map((point) => (
              <div
                key={point.captured_on}
                className="flex flex-1 flex-col items-center justify-end"
                title={`${point.captured_on}: ${point.total_on_google ?? '—'}`}
              >
                <div
                  className="w-full max-w-6 rounded-sm bg-amber-300/80"
                  style={{
                    height: Math.max(
                      6,
                      Math.round(
                        ((point.total_on_google ?? 0) / maxCount) * 96,
                      ),
                    ),
                  }}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {data?.missing.length ? (
        <section className="rounded-3xl border border-red-400/20 bg-red-500/5 p-5">
          <h2
            className="text-2xl text-red-100"
            style={{
              fontFamily: 'var(--font-telegram-display), Georgia, serif',
            }}
          >
            Missing from Google
          </h2>
          <ul className="mt-3 space-y-3">
            {data.missing.map((review) => (
              <li key={review.review_id} className="text-sm text-white/75">
                <span className="text-white">
                  {review.author || 'Anonymous'}
                </span>
                {review.snippet ? ` — "${review.snippet.slice(0, 140)}"` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-3xl border border-white/10 bg-black/30 p-5">
        <h2
          className="text-2xl text-white"
          style={{ fontFamily: 'var(--font-telegram-display), Georgia, serif' }}
        >
          Newest still live
        </h2>
        <ul className="mt-4 divide-y divide-white/10">
          {data?.reviews.map((review) => (
            <li key={review.review_id} className="py-3">
              <p className="text-sm text-white">
                {review.rating}★ · {review.author || 'Anonymous'}
              </p>
              <p className="mt-1 text-sm leading-6 text-white/60">
                {review.snippet}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </ReportShell>
  )
}
