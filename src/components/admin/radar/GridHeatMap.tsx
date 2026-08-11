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
import { Loader2, Search, MapIcon, AlertTriangle, Crosshair } from 'lucide-react'
// Import from the geo module, NOT '@/lib/radar-grid' — that one pulls in
// DataForSEO and the Supabase server client, which drags `next/headers` into the
// browser bundle and fails the build.
import {
  estimateGridCost,
  rankColor,
  rankTextColor,
  DEFAULT_GRID,
  GRID_KEYWORD_PRESETS,
  SERVICE_AREA_BUFFER_OPTIONS_MILES,
  SERVICE_AREA_DEFAULT_SPACING_MILES,
  SERVICE_AREA_SPACING_OPTIONS_MILES,
  SQUARE_GRID_SIZES,
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
  const centerMarkerRef = useRef<mapboxgl.Marker | null>(null)

  const [scans, setScans] = useState<GridScan[]>([])
  const [scan, setScan] = useState<GridScan | null>(null)
  const [points, setPoints] = useState<GridPoint[]>([])
  const [selected, setSelected] = useState<GridPoint | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [areaSpacing, setAreaSpacing] = useState(SERVICE_AREA_DEFAULT_SPACING_MILES)
  const [keyword, setKeyword] = useState<string>(GRID_KEYWORD_PRESETS[0])
  const [bufferMiles, setBufferMiles] = useState(0)
  const [gridSize, setGridSize] = useState(DEFAULT_GRID.size)
  const [centerLat, setCenterLat] = useState(DEFAULT_GRID.centerLat)
  const [centerLng, setCenterLng] = useState(DEFAULT_GRID.centerLng)
  const [placeCenter, setPlaceCenter] = useState(false)
  const [mapReady, setMapReady] = useState(false)

  const areaCost = estimateGridCost('service-area', areaSpacing, { bufferMiles })
  const areaDollars = (areaCost * COST_PER_POINT).toFixed(2)
  const triLakesCost = estimateGridCost('tri-lakes', areaSpacing, { size: gridSize })
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
      if (nextScan?.preset !== 'service-area') {
        if (nextScan?.center_lat != null) setCenterLat(nextScan.center_lat)
        if (nextScan?.center_lng != null) setCenterLng(nextScan.center_lng)
        if (nextScan?.grid_size) setGridSize(nextScan.grid_size)
      }
      const label = nextScan?.label ?? ''
      const bufMatch = /(?:\+|plus)\s*(\d+(?:\.\d+)?)\s*mi\s*edge/i.exec(label)
      if (bufMatch) setBufferMiles(Number(bufMatch[1]))
      else if (nextScan?.preset === 'service-area') setBufferMiles(0)
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
    async (preset: 'tri-lakes' | 'service-area') => {
      setRunning(true)
      setError(null)
      setPlaceCenter(false)
      try {
        const res = await fetch('/api/admin/radar/grid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            preset,
            spacingMiles: areaSpacing,
            keyword: keyword.trim() || undefined,
            bufferMiles: preset === 'service-area' ? bufferMiles : undefined,
            centerLat: preset === 'tri-lakes' ? centerLat : undefined,
            centerLng: preset === 'tri-lakes' ? centerLng : undefined,
            gridSize: preset === 'tri-lakes' ? gridSize : undefined,
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
    [load, keyword, areaSpacing, bufferMiles, centerLat, centerLng, gridSize],
  )

  // Create the map once the container mounts — don't wait for a prior scan so
  // you can drop a center pin before the first run.
  useEffect(() => {
    if (mapRef.current || !mapContainer.current) return
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    if (!token) {
      setError('Mapbox token not configured (NEXT_PUBLIC_MAPBOX_TOKEN)')
      return
    }
    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [DEFAULT_GRID.centerLng, DEFAULT_GRID.centerLat],
      zoom: 10.5,
    })
    map.addControl(new mapboxgl.NavigationControl(), 'top-right')
    mapRef.current = map
    map.on('load', () => setMapReady(true))
    return () => {
      centerMarkerRef.current?.remove()
      centerMarkerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  // Click map to set square-grid center (toggle on).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const onClick = (e: mapboxgl.MapMouseEvent) => {
      if (!placeCenter) return
      setCenterLat(Math.round(e.lngLat.lat * 10000) / 10000)
      setCenterLng(Math.round(e.lngLat.lng * 10000) / 10000)
      setPlaceCenter(false)
    }
    map.getCanvas().style.cursor = placeCenter ? 'crosshair' : ''
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
      map.getCanvas().style.cursor = ''
    }
  }, [placeCenter, mapReady])

  // Draggable center pin for Tri-Lakes / custom squares.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    if (!centerMarkerRef.current) {
      const el = document.createElement('div')
      el.title = 'Square-grid center — drag or use Place center'
      el.style.cssText = [
        'width:18px',
        'height:18px',
        'border-radius:9999px',
        'background:#38bdf8',
        'border:3px solid #fff',
        'box-shadow:0 2px 8px rgba(0,0,0,.6)',
        'cursor:grab',
      ].join(';')
      const marker = new mapboxgl.Marker({ element: el, draggable: true })
        .setLngLat([centerLng, centerLat])
        .addTo(map)
      marker.on('dragend', () => {
        const ll = marker.getLngLat()
        setCenterLat(Math.round(ll.lat * 10000) / 10000)
        setCenterLng(Math.round(ll.lng * 10000) / 10000)
      })
      centerMarkerRef.current = marker
    } else {
      const cur = centerMarkerRef.current.getLngLat()
      if (
        Math.abs(cur.lat - centerLat) > 0.00005 ||
        Math.abs(cur.lng - centerLng) > 0.00005
      ) {
        centerMarkerRef.current.setLngLat([centerLng, centerLat])
      }
    }
  }, [centerLat, centerLng, mapReady])

  // Redraw rank pins whenever the selected scan's points change.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    if (!points.length) return

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
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        setSelected(p)
      })

      markersRef.current.push(
        new mapboxgl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map),
      )
    }

    const bounds = new mapboxgl.LngLatBounds()
    points.forEach((p) => bounds.extend([p.lng, p.lat]))
    map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 400 })
  }, [points, mapReady])

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
                : 'No scans yet — set center / buffer, then run'}
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
                {s.preset === 'service-area' ? 'Area' : 'Square'} · ARP{' '}
                {s.avg_rank ?? '—'}
              </option>
            ))}
          </select>
        )}
      </div>

      <p className="mb-3 max-w-3xl text-xs leading-relaxed text-white/55">
        Drag the blue pin (or Place center) for square runs. Edge buffer rings
        points outside the service polygon so you can see where rank dies past
        the towns you serve. Same keyword on Local Falcon for a fair A/B. Each
        point is ~${COST_PER_POINT.toFixed(3)}.
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
              const pts = estimateGridCost('service-area', mi, { bufferMiles })
              return (
                <option key={mi} value={mi}>
                  {mi} mi · ~{pts} area pts
                </option>
              )
            })}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-white/40">
          Edge buffer
          <select
            value={bufferMiles}
            onChange={(e) => setBufferMiles(Number(e.target.value))}
            className="rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 text-xs normal-case tracking-normal text-white"
            title="Extra miles outside the service polygon (service-area runs only)"
          >
            {SERVICE_AREA_BUFFER_OPTIONS_MILES.map((mi) => {
              const pts = estimateGridCost('service-area', areaSpacing, {
                bufferMiles: mi,
              })
              return (
                <option key={mi} value={mi}>
                  {mi === 0 ? '0 mi · clip tight' : `${mi} mi outside`} · {pts} pts · ~
                  ${(pts * COST_PER_POINT).toFixed(2)}
                </option>
              )
            })}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-white/40">
          Square size
          <select
            value={gridSize}
            onChange={(e) => setGridSize(Number(e.target.value))}
            className="rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 text-xs normal-case tracking-normal text-white"
            title="N×N for Tri-Lakes / custom center runs"
          >
            {SQUARE_GRID_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}×{n} · {n * n} pts
              </option>
            ))}
          </select>
        </label>

        <label className="flex w-[6.5rem] flex-col gap-1 text-[10px] uppercase tracking-wider text-white/40">
          Center lat
          <input
            type="number"
            step={0.0001}
            value={centerLat}
            onChange={(e) => setCenterLat(Number(e.target.value))}
            className="rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 font-mono text-xs normal-case tracking-normal text-white"
          />
        </label>
        <label className="flex w-[6.5rem] flex-col gap-1 text-[10px] uppercase tracking-wider text-white/40">
          Center lng
          <input
            type="number"
            step={0.0001}
            value={centerLng}
            onChange={(e) => setCenterLng(Number(e.target.value))}
            className="rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 font-mono text-xs normal-case tracking-normal text-white"
          />
        </label>

        <Button
          size="sm"
          variant={placeCenter ? 'default' : 'outline'}
          onClick={() => setPlaceCenter((v) => !v)}
          title="Click the map to set the square-grid center"
        >
          <Crosshair className="mr-1.5 h-3.5 w-3.5" />
          {placeCenter ? 'Click map…' : 'Place center'}
        </Button>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => runScan('tri-lakes')}
            disabled={running || !keyword.trim()}
            title={`${gridSize}×${gridSize} @ ${centerLat.toFixed(4)}, ${centerLng.toFixed(4)} · "${keyword}" @ ${areaSpacing} mi`}
          >
            {running ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="mr-1.5 h-3.5 w-3.5" />
            )}
            Run square
            <span className="ml-1.5 text-white/40">{triLakesCost}</span>
          </Button>
          <Button
            size="sm"
            onClick={() => runScan('service-area')}
            disabled={running || !keyword.trim()}
            title={`Service area${bufferMiles ? ` + ${bufferMiles} mi edge` : ''} · "${keyword}" @ ${areaSpacing} mi · ~$${areaDollars}`}
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
          Square uses the blue pin + size/spacing. Service area fills the Castle
          Rock → Springs polygon; edge buffer adds a ring outside so you can find
          where green turns grey. Scheduled runs: Scan schedule card above.
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
        {placeCenter && (
          <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-sky-500/90 px-2 py-1 text-xs font-medium text-white">
            Click map to set square center
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-white/60">
        <Legend color="#38bdf8" label="square center" />
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
