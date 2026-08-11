'use client'

/**
 * Local Falcon geo-grid coverage.
 *
 * Deliberately a second opinion, not a replacement for our own grid: Local
 * Falcon reads Google's official Places API, our scanner reads the scraped Maps
 * SERP. Different pipelines measuring slightly different things, so where they
 * disagree is worth looking at rather than averaging away.
 *
 * Scans are triggered inside Local Falcon (that's where the credits live). This
 * only mirrors the results in, which costs nothing.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw, AlertTriangle, ExternalLink } from 'lucide-react'
import { rankColor, rankTextColor } from '@/lib/radar-grid-geo'

type Competitor = {
  rank: number | null
  name: string | null
  reviews: number | null
  rating: number | null
}

type Point = {
  idx: number
  lat: number
  lng: number
  found: boolean
  rank: number | null
  competitors: Competitor[] | null
}

type Scan = {
  id: string
  report_key: string
  keyword: string
  platform: string
  scanned_at: string
  grid_size: number | null
  radius: number | null
  measurement: string | null
  center_lat: number | null
  center_lng: number | null
  arp: number | null
  atrp: number | null
  solv: number | null
  found_in: number | null
  points_total: number | null
  unique_competitors: number | null
  public_url: string | null
}

const n = (v: number | null | undefined, digits = 2) =>
  v == null ? '—' : Number(v).toFixed(digits)

export function LocalFalconMap() {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])

  const [scans, setScans] = useState<Scan[]>([])
  const [scan, setScan] = useState<Scan | null>(null)
  const [points, setPoints] = useState<Point[]>([])
  const [selected, setSelected] = useState<Point | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (scanId?: string) => {
    setLoading(true)
    setError(null)
    try {
      const url = scanId
        ? `/api/admin/marketing/local-falcon?scanId=${scanId}`
        : '/api/admin/marketing/local-falcon'
      const res = await fetch(url)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      setScans(json.scans ?? [])
      setScan(json.scan ?? null)
      setPoints(json.points ?? [])
      setSelected(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const sync = async () => {
    setSyncing(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/marketing/local-falcon', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Sync failed')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  // Build the map once, then repaint markers whenever the scan changes.
  useEffect(() => {
    if (!container.current || mapRef.current) return
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    if (!token) {
      setError('NEXT_PUBLIC_MAPBOX_TOKEN is not set')
      return
    }
    mapboxgl.accessToken = token
    mapRef.current = new mapboxgl.Map({
      container: container.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-104.87, 39.09],
      zoom: 9,
    })
    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !points.length) return

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    const bounds = new mapboxgl.LngLatBounds()
    for (const p of points) {
      const el = document.createElement('div')
      el.style.cssText = [
        'width:30px', 'height:30px', 'border-radius:50%',
        `background:${rankColor(p.rank)}`,
        `color:${rankTextColor(p.rank)}`,
        'display:flex', 'align-items:center', 'justify-content:center',
        'font:600 12px/1 ui-sans-serif,system-ui',
        'border:2px solid rgba(255,255,255,.55)', 'cursor:pointer',
        'box-shadow:0 1px 4px rgba(0,0,0,.5)',
      ].join(';')
      // A miss is shown as a dash, never 0 or 21 — an invented number would be
      // read as a real position.
      el.textContent = p.rank == null ? '–' : String(p.rank)
      el.addEventListener('click', () => setSelected(p))

      markersRef.current.push(
        new mapboxgl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map),
      )
      bounds.extend([p.lng, p.lat])
    }
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, duration: 400 })
  }, [points])

  const coverage =
    scan?.found_in != null && scan?.points_total
      ? Math.round((scan.found_in / scan.points_total) * 100)
      : null

  return (
    <Card className="border-white/10 bg-white/5 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-white">Local Falcon</h3>
        <div className="ml-auto flex items-center gap-2">
          {scans.length > 1 && (
            <select
              value={scan?.id ?? ''}
              onChange={(e) => load(e.target.value)}
              className="rounded-md border border-white/15 bg-slate-900 px-2 py-1 text-xs text-white"
            >
              {scans.map((s) => (
                <option key={s.id} value={s.id}>
                  {new Date(s.scanned_at).toLocaleDateString()} · {s.keyword} ·{' '}
                  {s.grid_size}×{s.grid_size}
                </option>
              ))}
            </select>
          )}
          <Button size="sm" variant="outline" onClick={sync} disabled={syncing}>
            {syncing ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Pull new scans
          </Button>
        </div>
      </div>

      <p className="mb-3 max-w-3xl text-xs leading-relaxed text-white/55">
        Third-party grid through Local Falcon — they hit Google&apos;s Places API
        and build a square lattice (grid size × radius) on their side. Credits
        live in their app, so scans are triggered there (or by the schedule
        card); this view only mirrors results in. Usually denser than our
        DataForSEO polygon lattice — use it as a second opinion, not a
        replacement.
      </p>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {scan && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="Coverage" value={coverage == null ? '—' : `${coverage}%`}
              sub={`${scan.found_in ?? 0}/${scan.points_total ?? 0} points`} />
            <Stat label="ATRP" value={n(scan.atrp)} sub="misses counted" />
            <Stat label="ARP" value={n(scan.arp)} sub="where we ranked" />
            <Stat label="SoLV" value={scan.solv == null ? '—' : `${n(scan.solv)}%`} sub="share of voice" />
            <Stat label="Competitors" value={String(scan.unique_competitors ?? '—')} sub="seen in grid" />
          </div>
          <p className="mb-3 font-mono text-[11px] text-white/40">
            &ldquo;{scan.keyword}&rdquo; · {scan.grid_size}×{scan.grid_size} ·{' '}
            {n(scan.radius, 1)}{scan.measurement} radius ·{' '}
            {new Date(scan.scanned_at).toLocaleString()}
            {scan.public_url && (
              <>
                {' · '}
                <a href={scan.public_url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-blue-400 hover:underline">
                  Local Falcon report <ExternalLink className="h-3 w-3" />
                </a>
              </>
            )}
          </p>
        </>
      )}

      <div ref={container} className="h-[420px] w-full overflow-hidden rounded-lg" />

      {loading && (
        <p className="mt-2 flex items-center gap-2 text-sm text-white/60">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      )}
      {!loading && !scans.length && (
        <p className="mt-2 text-sm text-white/60">
          No scans yet. Run one inside Local Falcon, then press{' '}
          <span className="font-medium">Pull new scans</span>.
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-3 border-t border-white/10 pt-2 font-mono text-[11px] text-white/50">
        <Legend color="#16a34a" label="1–3 · in the pack" />
        <Legend color="#ca8a04" label="4–10" />
        <Legend color="#dc2626" label="11–20" />
        <Legend color="#4b5563" label="– · not in top 20" />
      </div>

      {selected && (
        <div className="mt-3 rounded-lg border border-white/10 bg-slate-900/60 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-xs text-white/60">
              {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)} · we rank{' '}
              {selected.rank ?? 'nowhere'}
            </span>
            <button type="button" onClick={() => setSelected(null)}
              className="text-xs text-white/40 hover:text-white">close</button>
          </div>
          <ol className="space-y-0.5">
            {(selected.competitors ?? []).map((c, i) => (
              <li key={i} className="flex gap-2 text-xs text-white/70">
                <span className="w-5 font-mono text-white/40">{c.rank}</span>
                <span className="flex-1 truncate">{c.name}</span>
                <span className="font-mono text-white/40">
                  {c.rating ?? '—'} ({c.reviews ?? 0})
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>
      <div className="text-lg font-bold tabular-nums text-white">{value}</div>
      {sub && <div className="font-mono text-[10px] text-white/40">{sub}</div>}
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}
