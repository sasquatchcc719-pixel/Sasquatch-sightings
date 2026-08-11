'use client'

/**
 * DataForSEO geo-grid — our DIY coverage map.
 *
 * Each pin is one coordinate the keyword was searched from, coloured by our rank
 * there and labelled with the rank itself. A single town-level rank hides the
 * thing that actually matters in a proximity-driven pack: rank varies enormously
 * across a few miles, so this shows WHERE we win rather than an average.
 *
 * Paired with LocalFalconMap for an A/B read: we scrape the Maps SERP via
 * DataForSEO; Local Falcon reads Google's Places pipeline. Same keyword, different
 * pipes — disagreement is the signal.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Search, MapIcon, AlertTriangle } from 'lucide-react'
// Import from the geo module, NOT '@/lib/radar-grid' — that one pulls in
// DataForSEO and the Supabase server client, which drags `next/headers` into the
// browser bundle and fails the build.
import {
  estimateGridCost,
  rankColor,
  rankTextColor,
  GRID_KEYWORD_PRESETS,
  SERVICE_AREA_DEFAULT_SPACING_MILES,
  SERVICE_AREA_SPACING_OPTIONS_MILES,
} from '@/lib/radar-grid-geo'

type TopPlace = {
  position: number
  title: string | null
  reviews: number | null
  place_id: string | null
}

type GridPoint = {
  row_idx: number
  col_idx: number
  lat: number
  lng: number
  my_rank: number | null
  top_places: TopPlace[] | null
}

type GridScan = {
  id: string
  keyword: string
  label: string | null
  preset: string | null
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null
  center_lat: number
  center_lng: number
  grid_size: number | null
  spacing_miles: number
  points_total: number
  points_scanned: number
  points_ranked: number
  avg_rank: number | null
  visibility_pct: number | null
  status: string
  error: string | null
  created_at: string
  completed_at: string | null
}

/** Rough pay-as-you-go cost so the Run buttons aren't a surprise. */
const COST_PER_POINT = 0.002

export function GridHeatMap() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])

  const [scans, setScans] = useState<GridScan[]>([])
  const [scan, setScan] = useState<GridScan | null>(null)
  const [points, setPoints] = useState<GridPoint[]>([])
  const [selected, setSelected] = useState<GridPoint | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [areaSpacing, setAreaSpacing] = useState(SERVICE_AREA_DEFAULT_SPACING_MILES)
  const [keyword, setKeyword] = useState<string>(GRID_KEYWORD_PRESETS[0])

  const areaCost = estimateGridCost('service-area', areaSpacing)
  const areaDollars = (areaCost * COST_PER_POINT).toFixed(2)
  const triLakesCost = estimateGridCost('tri-lakes', areaSpacing)
  const keywordOptions = GRID_KEYWORD_PRESETS.includes(
    keyword as (typeof GRID_KEYWORD_PRESETS)[number],
  )
    ? GRID_KEYWORD_PRESETS
    : ([keyword, ...GRID_KEYWORD_PRESETS] as string[])

  const load = useCallback(async (scanId?: string) => {
    setLoading(true)
    setError(null)
    try {
      const url = scanId
        ? `/api/admin/radar/grid?scanId=${encodeURIComponent(scanId)}`
        : '/api/admin/radar/grid'
      const res = await fetch(url)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load grid')
      setScans(json.scans ?? [])
      const nextScan = (json.scan as GridScan | null) ?? null
      setScan(nextScan)
      setPoints(json.points ?? [])
      setSelected(null)
      // Keep controls honest with whatever scan you're looking at, so "Run"
      // doesn't silently jump keyword or density away from the map you're on.
      if (nextScan?.spacing_miles) setAreaSpacing(nextScan.spacing_miles)
      if (nextScan?.keyword) setKeyword(nextScan.keyword)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load grid')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const runScan = useCallback(
    async (preset: 'tri-lakes' | 'service-area', spacingMiles?: number) => {
      setRunning(true)
      setError(null)
      try {
        const res = await fetch('/api/admin/radar/grid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            preset,
            spacingMiles,
            keyword: keyword.trim() || undefined,
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Scan failed')
        await load(json.scanId)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Scan failed')
      } finally {
        setRunning(false)
      }
    },
    [load, keyword],
  )

  // Create the map once.
  useEffect(() => {
    if (mapRef.current || !mapContainer.current || !scan) return
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    if (!token) {
      setError('Mapbox token not configured (NEXT_PUBLIC_MAPBOX_TOKEN)')
      return
    }
    mapboxgl.accessToken = token
    mapRef.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [scan.center_lng, scan.center_lat],
      zoom: 10.5,
    })
    mapRef.current.addControl(new mapboxgl.NavigationControl(), 'top-right')
    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [scan])

  // Redraw pins whenever the selected scan's points change.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !points.length) return

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    // A 141-point service-area scan needs smaller pins than a 25-point one or
    // the map turns into a solid mass of circles.
    const size = points.length > 100 ? 24 : points.length > 50 ? 28 : 34
    const fontSize = size >= 34 ? 13 : size >= 28 ? 11 : 10

    for (const p of points) {
      const el = document.createElement('button')
      el.type = 'button'
      el.setAttribute(
        'aria-label',
        `Rank ${p.my_rank ?? 'not in top 20'} at point ${p.row_idx + 1},${p.col_idx + 1}`,
      )
      el.style.cssText = [
        `width:${size}px`,
        `height:${size}px`,
        'border-radius:9999px',
        `background:${rankColor(p.my_rank)}`,
        `color:${rankTextColor(p.my_rank)}`,
        'border:2px solid rgba(255,255,255,.85)',
        'box-shadow:0 2px 6px rgba(0,0,0,.5)',
        `font:700 ${fontSize}px ui-sans-serif,system-ui,sans-serif`,
        'font-variant-numeric:tabular-nums',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'cursor:pointer',
      ].join(';')
      el.textContent = p.my_rank != null ? String(p.my_rank) : '–'
      el.addEventListener('click', () => setSelected(p))

      markersRef.current.push(
        new mapboxgl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map),
      )
    }

    const bounds = new mapboxgl.LngLatBounds()
    points.forEach((p) => bounds.extend([p.lng, p.lat]))
    map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 400 })
  }, [points])

  const visibility = scan?.visibility_pct ?? 0
  const arp = scan?.avg_rank

  return (
    <Card className="border-white/10 bg-white/5 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MapIcon className="h-5 w-5 text-emerald-400" />
          <div>
            <h2 className="text-lg font-semibold text-white">DataForSEO grid</h2>
            <p className="text-xs text-white/50">
              {scan
                ? `"${scan.keyword}" · ${scan.label ?? scan.preset} · ${scan.points_total} pts @ ${scan.spacing_miles} mi · ${new Date(scan.created_at).toLocaleDateString()}`
                : 'No scans yet'}
            </p>
          </div>
        </div>

        {scans.length > 1 && (
          <select
            value={scan?.id ?? ''}
            onChange={(e) => load(e.target.value)}
            className="rounded-md border border-white/15 bg-slate-900 px-2 py-1.5 text-xs text-white"
          >
            {scans.map((s) => (
              <option key={s.id} value={s.id}>
                {new Date(s.created_at).toLocaleDateString()} ·{' '}
                {s.preset === 'service-area' ? 'Area' : 'Tri-Lakes'} · ARP{' '}
                {s.avg_rank ?? '—'}
              </option>
            ))}
          </select>
        )}
      </div>

      <p className="mb-3 max-w-3xl text-xs leading-relaxed text-white/55">
        Our own lattice via DataForSEO Maps SERP (replaced SerpApi). Pick the
        keyword and spacing below, then run. Different pipeline than Local Falcon
        (scraped Maps vs Places API) — for a fair A/B, use the same keyword on both.
        Each point is ~${COST_PER_POINT.toFixed(3)}.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-white/10 bg-slate-900/50 px-3 py-3">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[10px] uppercase tracking-wider text-white/40">
          Keyword
          <input
            list="dataforseo-grid-keywords"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 text-xs normal-case tracking-normal text-white"
            title="Google Maps search term for every grid point"
            placeholder="carpet cleaning"
          />
          <datalist id="dataforseo-grid-keywords">
            {keywordOptions.map((kw) => (
              <option key={kw} value={kw} />
            ))}
          </datalist>
        </label>

        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-white/40">
          Spacing
          <select
            value={areaSpacing}
            onChange={(e) => setAreaSpacing(Number(e.target.value))}
            className="rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 text-xs normal-case tracking-normal text-white"
            title="Miles between grid points — one DataForSEO search each"
          >
            {(SERVICE_AREA_SPACING_OPTIONS_MILES.includes(
              areaSpacing as (typeof SERVICE_AREA_SPACING_OPTIONS_MILES)[number],
            )
              ? SERVICE_AREA_SPACING_OPTIONS_MILES
              : ([areaSpacing, ...SERVICE_AREA_SPACING_OPTIONS_MILES] as number[])
            ).map((mi) => {
              const pts = estimateGridCost('service-area', mi)
              return (
                <option key={mi} value={mi}>
                  {mi} mi · {pts} pts · ~${(pts * COST_PER_POINT).toFixed(2)}
                </option>
              )
            })}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => runScan('tri-lakes', areaSpacing)}
            disabled={running || !keyword.trim()}
            title={`5×5 around Monument · "${keyword}" @ ${areaSpacing} mi — ${triLakesCost} searches`}
          >
            {running ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="mr-1.5 h-3.5 w-3.5" />
            )}
            Run Tri-Lakes
            <span className="ml-1.5 text-white/40">{triLakesCost}</span>
          </Button>
          <Button
            size="sm"
            onClick={() => runScan('service-area', areaSpacing)}
            disabled={running || !keyword.trim()}
            title={`Full service area · "${keyword}" @ ${areaSpacing} mi · ~$${areaDollars}`}
          >
            {running ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="mr-1.5 h-3.5 w-3.5" />
            )}
            Run service area
            <span className="ml-1.5 opacity-70">
              {areaCost} · ~${areaDollars}
            </span>
          </Button>
        </div>

        <p className="w-full text-[11px] text-white/40">
          Tri-Lakes is always a 5×5 (25 pts) centered on Monument; spacing only
          stretches or tightens that square. Service area fills the Castle Rock →
          Colorado Springs polygon. Scheduled weekly runs use the keyword on the
          Scan schedule card above — keep them in sync for A/B.
        </p>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Top-3 visibility" value={`${visibility}%`} />
        <Stat label="Avg rank" value={arp != null ? String(arp) : '—'} hint="where we appear" />
        <Stat
          label="Appeared at"
          value={scan ? `${scan.points_ranked}/${scan.points_scanned}` : '—'}
          hint="grid points"
        />
        <Stat
          label="Best / worst"
          value={
            points.length
              ? (() => {
                  const r = points
                    .map((p) => p.my_rank)
                    .filter((x): x is number => x != null)
                  return r.length ? `#${Math.min(...r)} / #${Math.max(...r)}` : '—'
                })()
              : '—'
          }
        />
      </div>

      <div className="relative overflow-hidden rounded-lg border border-white/10">
        <div ref={mapContainer} className="h-[460px] w-full bg-slate-900" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/70">
            <Loader2 className="h-6 w-6 animate-spin text-white/70" />
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-white/60">
        <Legend color="#16a34a" label="1–3 · in the pack" />
        <Legend color="#ca8a04" label="4–10" />
        <Legend color="#dc2626" label="11–20" />
        <Legend color="#4b5563" label="not in top 20" />
      </div>

      {selected && (
        <div className="mt-4 rounded-lg border border-white/10 bg-slate-900/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-white">
              Point {selected.row_idx + 1},{selected.col_idx + 1} — we rank{' '}
              {selected.my_rank != null ? `#${selected.my_rank}` : 'nowhere'}
            </span>
            <span className="font-mono text-[11px] text-white/40">
              {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}
            </span>
          </div>
          <ol className="space-y-1">
            {(selected.top_places ?? []).map((tp) => (
              <li
                key={`${tp.position}-${tp.place_id ?? tp.title}`}
                className="flex items-center justify-between text-xs text-white/70"
              >
                <span>
                  <span className="mr-2 font-mono text-white/40">#{tp.position}</span>
                  {tp.title ?? 'Unknown'}
                </span>
                <span className="font-mono text-white/40">
                  {tp.reviews != null ? `${tp.reviews} reviews` : ''}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  )
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>
      <div className="text-xl font-bold tabular-nums text-white">{value}</div>
      {hint && <div className="text-[10px] text-white/35">{hint}</div>}
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-3 w-3 rounded-full border border-white/40"
        style={{ background: color }}
      />
      {label}
    </span>
  )
}
