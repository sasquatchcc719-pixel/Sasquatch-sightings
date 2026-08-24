'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ReportShell,
  SettingsPanel,
} from '@/components/admin/telegram/ReportShell'
import { Loader2 } from 'lucide-react'

type CloseCall = {
  keyword: string
  page: string | null
  clicks: number
  impressions: number
  avg_position: number | string
}

export default function TelegramOpportunitiesPage() {
  const [loading, setLoading] = useState(true)
  const [digest, setDigest] = useState<string | null>(null)
  const [lastSent, setLastSent] = useState<string | null>(null)
  const [closeCalls, setCloseCalls] = useState<CloseCall[]>([])
  const [constants, setConstants] = useState({
    windowDays: 28,
    minPosition: 8,
    maxPosition: 20.5,
    minImpressions: 5,
    maxOpportunities: 6,
  })

  useEffect(() => {
    fetch('/api/admin/comms/telegram/opportunities', { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        setDigest(json.digest)
        setLastSent(json.lastSent)
        setCloseCalls(json.closeCalls ?? [])
        setConstants(json.constants)
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-white/40" />
      </div>
    )
  }

  return (
    <ReportShell
      kicker="Telegram channel"
      title="Close calls"
      lede="Keywords sitting on page 2 with enough searches to bother editing a page. Suggestions only — nothing is written to the site."
      when="1st of the month at 9:00am"
      lastSent={
        lastSent
          ? new Date(lastSent).toLocaleDateString('en-US', {
              timeZone: 'America/Denver',
              month: 'short',
              day: 'numeric',
            })
          : null
      }
      message={digest}
      settings={
        <SettingsPanel
          title="What counts as close"
          hint="These bands live in code today. Shown so you can see the experiment knobs before we make them save."
        >
          <div>
            <Label className="text-white/60">Lookback days</Label>
            <Input
              readOnly
              value={constants.windowDays}
              className="mt-1 border-white/15 bg-white/5 text-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-white/60">From rank</Label>
              <Input
                readOnly
                value={constants.minPosition}
                className="mt-1 border-white/15 bg-white/5 text-white"
              />
            </div>
            <div>
              <Label className="text-white/60">To rank</Label>
              <Input
                readOnly
                value={constants.maxPosition}
                className="mt-1 border-white/15 bg-white/5 text-white"
              />
            </div>
          </div>
          <div>
            <Label className="text-white/60">Minimum searches</Label>
            <Input
              readOnly
              value={constants.minImpressions}
              className="mt-1 border-white/15 bg-white/5 text-white"
            />
          </div>
          <div>
            <Label className="text-white/60">Max suggestions</Label>
            <Input
              readOnly
              value={constants.maxOpportunities}
              className="mt-1 border-white/15 bg-white/5 text-white"
            />
          </div>
        </SettingsPanel>
      }
    >
      <section className="space-y-3">
        {closeCalls.map((row) => (
          <article
            key={row.keyword}
            className="rounded-3xl border border-white/10 bg-black/30 p-5"
          >
            <p className="text-[11px] tracking-wide text-amber-300/80 uppercase">
              #{Number(row.avg_position).toFixed(1)} · {row.impressions}{' '}
              searches
            </p>
            <h2
              className="mt-1 text-2xl text-white"
              style={{
                fontFamily: 'var(--font-telegram-display), Georgia, serif',
              }}
            >
              {row.keyword}
            </h2>
            <p className="mt-1 font-mono text-sm text-white/45">
              {row.page?.replace(/^https?:\/\/[^/]+/, '') || '—'}
            </p>
            <p className="mt-2 text-sm text-white/60">{row.clicks} visits</p>
          </article>
        ))}
        {closeCalls.length === 0 ? (
          <p className="text-sm text-white/50">
            Nothing on the watchlist is in the page-2 band this week. The
            monthly job still asks Search Console for the full keyword set.
          </p>
        ) : null}
      </section>
    </ReportShell>
  )
}
