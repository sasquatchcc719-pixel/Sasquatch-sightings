'use client'

import { useEffect, useState } from 'react'
import {
  ReportShell,
  SettingsPanel,
} from '@/components/admin/telegram/ReportShell'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'

type CoverageData = {
  lastSent: string | null
  digest: string
  buckets: Record<string, number>
  indexed: number
  checked: number
  dropped: string[]
  newlyIndexed: string[]
  notIndexed: Array<{
    path: string
    coverage: string | null
    crawled: string | null
  }>
  constants: {
    maxInspections: number
    staleSitemapDays: number
    sweepMaxInspections: number
    sweepMaxPings: number
  }
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

export function CoverageDash({ mode }: { mode: 'watch' | 'sweep' }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<CoverageData | null>(null)

  useEffect(() => {
    fetch('/api/admin/comms/telegram/coverage', { cache: 'no-store' })
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

  const watch = mode === 'watch'
  const buckets = Object.entries(data?.buckets ?? {}).sort(
    (a, b) => b[1] - a[1],
  )

  return (
    <ReportShell
      kicker="Telegram channel"
      title={watch ? 'GSC Weekly Watch' : 'Index sweep'}
      lede={
        watch
          ? 'Monday coverage of marketing and job pages. This is whether Google has the page, not where it ranks.'
          : 'Thursday nudge: pages that are not indexed get a crawl ping, capped so we do not spam Google.'
      }
      when={watch ? 'Mondays at 8:00am' : 'Thursdays at 10:00am'}
      lastSent={formatWhen(data?.lastSent ?? null)}
      message={
        watch
          ? data?.digest
          : `GSC Index Sweep\nChecked ${data?.checked ?? 0} pages: ${data?.indexed ?? 0} indexed · ${data?.notIndexed.length ?? 0} not indexed`
      }
      settings={
        <SettingsPanel
          title={watch ? 'What gets checked' : 'Ping budget'}
          hint={
            watch
              ? 'Targets come from the live sitemaps. These caps live in code today — shown so you can see the knobs before we wire them to save.'
              : 'Sweep walks the same sitemaps, marketing pages first. Caps are code constants until we promote them to settings.'
          }
        >
          {watch ? (
            <>
              <div>
                <Label className="text-white/60">Pages inspected per run</Label>
                <Input
                  readOnly
                  value={data?.constants.maxInspections ?? 80}
                  className="mt-1 border-white/15 bg-white/5 text-white"
                />
              </div>
              <div>
                <Label className="text-white/60">
                  Sitemap stale after (days)
                </Label>
                <Input
                  readOnly
                  value={data?.constants.staleSitemapDays ?? 7}
                  className="mt-1 border-white/15 bg-white/5 text-white"
                />
              </div>
              <p className="text-xs text-white/40">
                Source: www sitemap, then newest job URLs until the cap.
              </p>
            </>
          ) : (
            <>
              <div>
                <Label className="text-white/60">Inspections per sweep</Label>
                <Input
                  readOnly
                  value={data?.constants.sweepMaxInspections ?? 100}
                  className="mt-1 border-white/15 bg-white/5 text-white"
                />
              </div>
              <div>
                <Label className="text-white/60">Force-crawl pings</Label>
                <Input
                  readOnly
                  value={data?.constants.sweepMaxPings ?? 90}
                  className="mt-1 border-white/15 bg-white/5 text-white"
                />
              </div>
              <p className="text-xs text-white/40">
                Overflow waits for the next Thursday. Indexed pages are never
                pinged.
              </p>
            </>
          )}
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
            Indexed
          </p>
          <p
            className="mt-1 text-5xl text-emerald-300"
            style={{
              fontFamily: 'var(--font-telegram-display), Georgia, serif',
            }}
          >
            {data?.indexed ?? 0}
          </p>
          <p className="mt-1 text-sm text-white/45">
            of {data?.checked ?? 0} checked
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
          <p className="text-[11px] tracking-wide text-white/40 uppercase">
            Dropped since last run
          </p>
          <p
            className="mt-1 text-5xl text-amber-300"
            style={{
              fontFamily: 'var(--font-telegram-display), Georgia, serif',
            }}
          >
            {data?.dropped.length ?? 0}
          </p>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-black/30 p-5">
        <h2
          className="text-2xl text-white"
          style={{ fontFamily: 'var(--font-telegram-display), Georgia, serif' }}
        >
          How Google describes the set
        </h2>
        <ul className="mt-4 space-y-2">
          {buckets.map(([label, count]) => (
            <li key={label} className="flex items-center justify-between gap-3">
              <span className="text-sm text-white/70">{label}</span>
              <span className="font-mono text-sm text-white">{count}</span>
            </li>
          ))}
        </ul>
      </section>

      {data?.dropped.length ? (
        <section className="rounded-3xl border border-amber-400/20 bg-amber-400/5 p-5">
          <h2 className="text-lg text-amber-100">Dropped</h2>
          <ul className="mt-2 font-mono text-sm text-white/70">
            {data.dropped.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-3xl border border-white/10 bg-black/30 p-5">
        <h2
          className="text-2xl text-white"
          style={{ fontFamily: 'var(--font-telegram-display), Georgia, serif' }}
        >
          Not in the index
        </h2>
        <ul className="mt-4 divide-y divide-white/10">
          {data?.notIndexed.slice(0, 24).map((row) => (
            <li
              key={row.path}
              className="flex flex-wrap items-baseline justify-between gap-2 py-2"
            >
              <span className="font-mono text-sm text-white/80">
                {row.path}
              </span>
              <span className="text-xs text-white/40">{row.coverage}</span>
            </li>
          ))}
        </ul>
      </section>
    </ReportShell>
  )
}
