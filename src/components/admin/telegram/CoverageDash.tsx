'use client'

import { useEffect, useState } from 'react'
import {
  ReportShell,
  SettingsPanel,
} from '@/components/admin/telegram/ReportShell'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CheckCircle2, CircleHelp, Clock3, Loader2 } from 'lucide-react'

type CoverageData = {
  lastSent: string | null
  digest: string
  indexed: number
  waiting: number
  other: number
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
    indexCheckMaxInspections: number
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
  const checked = data?.checked ?? 0
  const indexed = data?.indexed ?? 0
  const indexRate = checked ? Math.round((indexed / checked) * 100) : 0

  return (
    <ReportShell
      kicker="Telegram channel"
      title={watch ? 'Monday index check' : 'Thursday index check'}
      lede={
        watch
          ? 'A simple snapshot of which pages Google can show in search results.'
          : 'A read-only status check. It monitors Google without requesting recrawls.'
      }
      when={watch ? 'Mondays at 8:00am' : 'Thursdays at 10:00am'}
      lastSent={formatWhen(data?.lastSent ?? null)}
      message={data?.digest}
      settings={
        <SettingsPanel
          title="What gets checked"
          hint="Pages come from the live sitemaps. Google is inspected, never nudged."
        >
          <div>
            <Label className="text-white/60">Pages inspected per run</Label>
            <Input
              readOnly
              value={
                watch
                  ? (data?.constants.maxInspections ?? 80)
                  : (data?.constants.indexCheckMaxInspections ?? 250)
              }
              className="mt-1 border-white/15 bg-white/5 text-white"
            />
          </div>
          <p className="text-xs leading-5 text-white/40">
            {watch
              ? 'Monday checks the main sitemap and newest job pages.'
              : 'Thursday checks marketing pages first, followed by job and sighting pages.'}
          </p>
        </SettingsPanel>
      }
    >
      {error ? (
        <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <section className="rounded-3xl border border-white/10 bg-black/30 p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] tracking-wide text-white/40 uppercase">
              Visible in Google
            </p>
            <p
              className="mt-1 text-5xl text-white"
              style={{
                fontFamily: 'var(--font-telegram-display), Georgia, serif',
              }}
            >
              {indexed}
              <span className="text-2xl text-white/35"> / {checked}</span>
            </p>
          </div>
          <p className="text-lg font-medium text-emerald-300">{indexRate}%</p>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-emerald-400"
            style={{ width: `${indexRate}%` }}
          />
        </div>
        <p className="mt-3 text-sm text-white/45">
          Indexed pages are eligible to appear in Google Search.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4">
          <CheckCircle2 className="h-5 w-5 text-emerald-300" />
          <p className="mt-3 text-3xl text-emerald-200">{indexed}</p>
          <p className="mt-1 text-sm text-white/60">Indexed</p>
          <p className="mt-1 text-xs text-white/35">Can appear in search</p>
        </div>
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4">
          <Clock3 className="h-5 w-5 text-amber-300" />
          <p className="mt-3 text-3xl text-amber-200">{data?.waiting ?? 0}</p>
          <p className="mt-1 text-sm text-white/60">Waiting on Google</p>
          <p className="mt-1 text-xs text-white/35">Known, but not selected</p>
        </div>
        <div className="rounded-2xl border border-sky-400/20 bg-sky-400/5 p-4">
          <CircleHelp className="h-5 w-5 text-sky-300" />
          <p className="mt-3 text-3xl text-sky-200">{data?.other ?? 0}</p>
          <p className="mt-1 text-sm text-white/60">Unknown or excluded</p>
          <p className="mt-1 text-xs text-white/35">
            Missing, redirected, or skipped
          </p>
        </div>
      </section>

      {data?.newlyIndexed.length || data?.dropped.length ? (
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-[11px] tracking-wide text-white/40 uppercase">
            Since the last check
          </p>
          <p className="mt-2 text-sm text-white/75">
            {data?.newlyIndexed.length ?? 0} newly indexed
            {data?.dropped.length
              ? ` · ${data.dropped.length} no longer indexed`
              : ''}
          </p>
        </section>
      ) : null}

      <details className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <summary className="cursor-pointer text-sm font-medium text-white/75">
          View pages not currently indexed ({data?.notIndexed.length ?? 0})
        </summary>
        <ul className="mt-4 divide-y divide-white/10">
          {data?.notIndexed.slice(0, 24).map((row) => (
            <li key={row.path} className="py-3">
              <p className="font-mono text-sm break-all text-white/80">
                {row.path}
              </p>
              <p className="mt-1 text-xs text-white/40">
                {row.coverage || 'Status unavailable'}
              </p>
            </li>
          ))}
        </ul>
      </details>
    </ReportShell>
  )
}
