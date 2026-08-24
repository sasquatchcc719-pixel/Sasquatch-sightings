'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ReportShell,
  SettingsPanel,
} from '@/components/admin/telegram/ReportShell'
import { Loader2, Pause, Play, Plus, Trash2 } from 'lucide-react'

type Town = {
  keywordId: string
  keyword: string
  location: string
  town: string
  townKey: string
  mapsRank: number | null
  organicRank: number | null
  prevMapsRank: number | null
  scannedAt: string | null
  pin: { lat: number; lng: number } | null
  zoom: number
}

type Keyword = {
  id: string
  keyword: string
  location: string
  active: boolean
}

type Domain = {
  id: string
  domain: string
  display_name: string | null
  is_my_domain: boolean
}

const PIN_BOUNDS = {
  minLat: 38.78,
  maxLat: 39.42,
  minLng: -105.0,
  maxLng: -104.55,
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

function RankMark({ rank }: { rank: number | null }) {
  const label = rank == null ? '—' : `#${rank}`
  const tone =
    rank == null
      ? 'border-white/15 bg-white/5 text-white/40'
      : rank === 1
        ? 'border-amber-300/60 bg-amber-300 text-stone-950'
        : rank <= 3
          ? 'border-emerald-400/50 bg-emerald-400/20 text-emerald-200'
          : 'border-white/15 bg-white/5 text-white/80'
  return (
    <span
      className={`inline-flex min-w-12 items-center justify-center rounded-full border px-2 py-0.5 font-mono text-sm ${tone}`}
    >
      {label}
    </span>
  )
}

export function RadarDailyDash() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [digest, setDigest] = useState<string | null>(null)
  const [lastSent, setLastSent] = useState<string | null>(null)
  const [towns, setTowns] = useState<Town[]>([])
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [domains, setDomains] = useState<Domain[]>([])
  const [keyword, setKeyword] = useState('carpet cleaning')
  const [location, setLocation] = useState(
    'Colorado Springs, Colorado, United States',
  )
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/comms/telegram/radar', {
      cache: 'no-store',
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to load')
    setDigest(data.digest)
    setLastSent(data.lastSent)
    setTowns(data.towns ?? [])
    setKeywords(data.keywords ?? [])
    setDomains(data.domains ?? [])
  }, [])

  useEffect(() => {
    load()
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load'),
      )
      .finally(() => setLoading(false))
  }, [load])

  const pinTowns = useMemo(
    () => towns.filter((t) => t.pin && t.keyword === towns[0]?.keyword),
    [towns],
  )

  async function addTown() {
    setBusyId('add')
    setError(null)
    try {
      const res = await fetch('/api/admin/comms/telegram/radar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, location }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not add')
      setLocation('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add')
    } finally {
      setBusyId(null)
    }
  }

  async function patchKeyword(
    id: string,
    patch: { active?: boolean; location?: string; keyword?: string },
  ) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/radar/keywords/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not update')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update')
    } finally {
      setBusyId(null)
    }
  }

  async function removeKeyword(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/radar/keywords/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Could not remove')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove')
    } finally {
      setBusyId(null)
    }
  }

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
      title="Radar Daily"
      lede="One pin per town, searched from a fixed town-center point. This is not the grid. Add or pause towns here — the midnight message follows this list."
      when="Every night at midnight"
      lastSent={formatWhen(lastSent)}
      message={digest}
      settings={
        <SettingsPanel
          title="Towns & terms"
          hint="Each row is a town Google is asked from. The pin is the hardcoded town center Radar uses today."
        >
          <div className="space-y-2">
            <Label className="text-white/60">Search term</Label>
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="border-white/15 bg-white/5 text-white"
            />
            <Label className="text-white/60">Town, as Google sees it</Label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Monument, Colorado, United States"
              className="border-white/15 bg-white/5 text-white"
            />
            <Button
              type="button"
              onClick={() => void addTown()}
              disabled={busyId === 'add' || !keyword.trim() || !location.trim()}
              className="w-full bg-amber-400 text-stone-950 hover:bg-amber-300"
            >
              {busyId === 'add' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Track this town
            </Button>
          </div>

          <div className="divide-y divide-white/10 rounded-2xl border border-white/10">
            {keywords.map((row) => (
              <div key={row.id} className="flex items-start gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white">
                    {row.location.split(',')[0]}
                  </p>
                  <p className="truncate font-mono text-[11px] text-white/40">
                    {row.keyword}
                  </p>
                </div>
                <button
                  type="button"
                  title={row.active ? 'Pause' : 'Resume'}
                  className="rounded-md p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
                  onClick={() =>
                    void patchKeyword(row.id, { active: !row.active })
                  }
                >
                  {row.active ? (
                    <Pause className="h-3.5 w-3.5" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  title="Remove"
                  className="rounded-md p-1.5 text-white/40 hover:bg-red-500/20 hover:text-red-300"
                  onClick={() => void removeKeyword(row.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div>
            <p className="mb-2 text-[11px] tracking-wide text-white/40 uppercase">
              Competitors watched
            </p>
            <ul className="space-y-1.5 text-sm text-white/70">
              {domains.map((d) => (
                <li key={d.id} className="flex justify-between gap-2">
                  <span className="truncate">{d.display_name || d.domain}</span>
                  {d.is_my_domain ? (
                    <span className="text-[10px] tracking-wide text-amber-300 uppercase">
                      us
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-white/40">
              Add or remove competitors on Marketing → Radar. Pins themselves
              still live in code until the grid overhaul.
            </p>
          </div>
        </SettingsPanel>
      }
    >
      {error ? (
        <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="relative min-h-[22rem] overflow-hidden rounded-3xl border border-white/10 bg-[#0b1220]">
          <p className="absolute top-4 left-4 z-10 text-[11px] tracking-[0.2em] text-white/40 uppercase">
            Search pins · {pinTowns[0]?.keyword ?? 'carpet cleaning'}
          </p>
          <div
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
          />
          {pinTowns.map((town) => {
            if (!town.pin) return null
            const x =
              ((town.pin.lng - PIN_BOUNDS.minLng) /
                (PIN_BOUNDS.maxLng - PIN_BOUNDS.minLng)) *
              100
            const y =
              ((PIN_BOUNDS.maxLat - town.pin.lat) /
                (PIN_BOUNDS.maxLat - PIN_BOUNDS.minLat)) *
              100
            return (
              <div
                key={town.keywordId}
                className="absolute -translate-x-1/2 -translate-y-full"
                style={{ left: `${x}%`, top: `${y}%` }}
              >
                <div className="flex flex-col items-center">
                  <span className="rounded-full bg-black/70 px-2 py-0.5 text-[10px] tracking-wide text-white/80 uppercase">
                    {town.town}
                  </span>
                  <span
                    className={`mt-1 h-3 w-3 rounded-full border-2 ${
                      town.mapsRank === 1
                        ? 'border-amber-300 bg-amber-300'
                        : town.mapsRank && town.mapsRank <= 3
                          ? 'border-emerald-300 bg-emerald-400'
                          : 'border-white/70 bg-white/30'
                    }`}
                  />
                </div>
              </div>
            )
          })}
        </div>

        <div className="space-y-2">
          {towns.map((town) => (
            <article
              key={town.keywordId}
              className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <h3
                    className="text-lg text-white"
                    style={{
                      fontFamily:
                        'var(--font-telegram-display), Georgia, serif',
                    }}
                  >
                    {town.town}
                  </h3>
                  <p className="font-mono text-[11px] text-white/40">
                    {town.pin
                      ? `${town.pin.lat.toFixed(4)}, ${town.pin.lng.toFixed(4)} · zoom ${town.zoom}`
                      : 'No pin — add this town to TOWN_CENTROIDS'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <div className="text-right">
                    <p className="text-[10px] tracking-wide text-white/40 uppercase">
                      Maps
                    </p>
                    <RankMark rank={town.mapsRank} />
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] tracking-wide text-white/40 uppercase">
                      Organic
                    </p>
                    <RankMark rank={town.organicRank} />
                  </div>
                </div>
              </div>
              {town.prevMapsRank != null &&
              town.mapsRank != null &&
              town.prevMapsRank !== town.mapsRank ? (
                <p className="mt-2 text-xs text-white/50">
                  Maps was #{town.prevMapsRank} last scan
                </p>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </ReportShell>
  )
}
