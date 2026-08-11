'use client'

/**
 * Local Falcon workspace — full API surface in Sightings.
 *
 * Tabs: Scan (run + map), Trends, Competitors, Campaigns, Guard, Reviews, Account.
 * Sibling to DataForSEO grid for a real tool A/B, not a thin mirror.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Loader2,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  Crosshair,
  Search,
} from 'lucide-react'
import {
  rankColor,
  rankTextColor,
  DEFAULT_GRID,
  GRID_KEYWORD_PRESETS,
  LOCAL_FALCON_GRID_SIZES,
} from '@/lib/radar-grid-geo'

type Tab =
  | 'scan'
  | 'trends'
  | 'competitors'
  | 'campaigns'
  | 'guard'
  | 'reviews'
  | 'account'

type Competitor = {
  rank: number | null
  name: string | null
  reviews: number | null
  rating: number | null
  place_id?: string | null
  address?: string | null
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
  saiv: number | null
  osolv: number | null
  found_in: number | null
  points_total: number | null
  unique_competitors: number | null
  public_url: string | null
  insights: Record<string, unknown> | null
  location: Record<string, unknown> | null
  ai_analysis: Record<string, unknown> | null
  heatmap_url: string | null
  image_url: string | null
}

type LFLocation = {
  place_id: string
  name?: string
  address?: string
  lat?: string | number
  lng?: string | number
}

const PLATFORMS = [
  'google',
  'apple',
  'chatgpt',
  'gemini',
  'grok',
  'gaio',
  'aimode',
] as const

const n = (v: number | null | undefined, digits = 2) =>
  v == null ? '—' : Number(v).toFixed(digits)

const TABS: { id: Tab; label: string }[] = [
  { id: 'scan', label: 'Scan' },
  { id: 'trends', label: 'Trends' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'guard', label: 'Guard' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'account', label: 'Account' },
]

export function LocalFalconMap() {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const centerMarkerRef = useRef<mapboxgl.Marker | null>(null)

  const [tab, setTab] = useState<Tab>('scan')
  const [scans, setScans] = useState<Scan[]>([])
  const [scan, setScan] = useState<Scan | null>(null)
  const [points, setPoints] = useState<Point[]>([])
  const [selected, setSelected] = useState<Point | null>(null)
  const [locations, setLocations] = useState<LFLocation[]>([])
  const [accountLite, setAccountLite] = useState<{
    credits?: unknown
    email?: string
    synced_at?: string
  } | null>(null)
  const [trends, setTrends] = useState<Array<Record<string, unknown>>>([])
  const [competitors, setCompetitors] = useState<
    Array<Record<string, unknown>>
  >([])
  const [campaigns, setCampaigns] = useState<Array<Record<string, unknown>>>([])
  const [guardLocations, setGuardLocations] = useState<
    Array<Record<string, unknown>>
  >([])
  const [guardReports, setGuardReports] = useState<
    Array<Record<string, unknown>>
  >([])
  const [reviews, setReviews] = useState<Array<Record<string, unknown>>>([])
  const [accountFull, setAccountFull] = useState<Record<
    string,
    unknown
  > | null>(null)

  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [placeCenter, setPlaceCenter] = useState(false)

  const [keyword, setKeyword] = useState('carpet cleaning')
  const [gridSize, setGridSize] = useState(9)
  const [radius, setRadius] = useState(8)
  const [platform, setPlatform] = useState<string>('google')
  const [aiAnalysis, setAiAnalysis] = useState(true)
  const [placeId, setPlaceId] = useState('')
  const [centerLat, setCenterLat] = useState(DEFAULT_GRID.centerLat)
  const [centerLng, setCenterLng] = useState(DEFAULT_GRID.centerLng)

  const credits = gridSize * gridSize

  const loadScans = useCallback(async (scanId?: string) => {
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
      setAccountLite(json.account ?? null)
      setSelected(null)
      if (json.scan?.keyword) setKeyword(json.scan.keyword)
      if (json.scan?.grid_size) setGridSize(json.scan.grid_size)
      if (json.scan?.radius != null) setRadius(Number(json.scan.radius))
      if (json.scan?.platform) setPlatform(json.scan.platform)
      if (json.scan?.center_lat != null) setCenterLat(json.scan.center_lat)
      if (json.scan?.center_lng != null) setCenterLng(json.scan.center_lng)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadView = useCallback(async (view: Tab) => {
    if (view === 'scan') return
    setError(null)
    try {
      const res = await fetch(
        `/api/admin/marketing/local-falcon?view=${view === 'account' ? 'account' : view}`,
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      if (view === 'trends') setTrends(json.trends ?? [])
      if (view === 'competitors') setCompetitors(json.competitors ?? [])
      if (view === 'campaigns') setCampaigns(json.campaigns ?? [])
      if (view === 'guard') {
        setGuardLocations(json.guardLocations ?? [])
        setGuardReports(json.guardReports ?? [])
      }
      if (view === 'reviews') setReviews(json.reviews ?? [])
      if (view === 'account') setAccountFull(json.account ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    }
  }, [])

  const loadLocations = useCallback(async () => {
    try {
      const res = await fetch(
        '/api/admin/marketing/local-falcon?view=locations',
      )
      const json = await res.json()
      if (!res.ok) return
      const locs = (json.locations ?? []) as LFLocation[]
      setLocations(locs)
      if (!placeId && locs[0]?.place_id) {
        setPlaceId(locs[0].place_id)
        if (locs[0].lat != null) setCenterLat(Number(locs[0].lat))
        if (locs[0].lng != null) setCenterLng(Number(locs[0].lng))
      }
    } catch {
      /* ignore */
    }
  }, [placeId])

  useEffect(() => {
    void loadScans()
    void loadLocations()
  }, [loadScans, loadLocations])

  useEffect(() => {
    void loadView(tab)
  }, [tab, loadView])

  const postAction = async (
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const res = await fetch('/api/admin/marketing/local-falcon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Action failed')
    return json
  }

  const sync = async () => {
    setSyncing(true)
    setError(null)
    try {
      await postAction({ action: 'sync', upgradeExisting: true })
      await loadScans(scan?.id)
      await loadView(tab)
      await loadLocations()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const runNow = async () => {
    if (
      !confirm(
        `Run Local Falcon ${gridSize}×${gridSize} for "${keyword}" on ${platform}? This spends ${credits} credits.`,
      )
    ) {
      return
    }
    setRunning(true)
    setError(null)
    try {
      const json = await postAction({
        action: 'run-scan',
        confirm: true,
        place_id: placeId,
        keyword,
        grid_size: gridSize,
        radius,
        lat: centerLat,
        lng: centerLng,
        platform,
        ai_analysis: aiAnalysis && platform === 'google',
        measurement: 'mi',
      })
      if (json.needsConfirm) {
        setError(String(json.message || 'Confirm required'))
        return
      }
      await loadScans()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Run failed')
    } finally {
      setRunning(false)
    }
  }

  // Map
  useEffect(() => {
    if (!container.current || mapRef.current || tab !== 'scan') return
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    if (!token) {
      setError('NEXT_PUBLIC_MAPBOX_TOKEN is not set')
      return
    }
    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container: container.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [DEFAULT_GRID.centerLng, DEFAULT_GRID.centerLat],
      zoom: 9.5,
    })
    map.addControl(new mapboxgl.NavigationControl(), 'top-right')
    mapRef.current = map
    map.on('load', () => setMapReady(true))
    return () => {
      centerMarkerRef.current?.remove()
      centerMarkerRef.current = null
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [tab])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || tab !== 'scan') return
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
  }, [placeCenter, mapReady, tab])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || tab !== 'scan') return
    if (!centerMarkerRef.current) {
      const el = document.createElement('div')
      el.title = 'Scan center — drag to move'
      el.style.cssText =
        'width:18px;height:18px;border-radius:9999px;background:#38bdf8;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.6);cursor:grab'
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
      centerMarkerRef.current.setLngLat([centerLng, centerLat])
    }
  }, [centerLat, centerLng, mapReady, tab])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || tab !== 'scan') return
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []
    if (!points.length) return
    const bounds = new mapboxgl.LngLatBounds()
    for (const p of points) {
      const el = document.createElement('button')
      el.type = 'button'
      el.style.cssText = [
        'width:30px',
        'height:30px',
        'border-radius:50%',
        `background:${rankColor(p.rank)}`,
        `color:${rankTextColor(p.rank)}`,
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'font:600 12px/1 ui-sans-serif,system-ui',
        'border:2px solid rgba(255,255,255,.55)',
        'cursor:pointer',
        'box-shadow:0 1px 4px rgba(0,0,0,.5)',
      ].join(';')
      el.textContent = p.rank == null ? '–' : String(p.rank)
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        setSelected(p)
      })
      markersRef.current.push(
        new mapboxgl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map),
      )
      bounds.extend([p.lng, p.lat])
    }
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, duration: 400 })
  }, [points, mapReady, tab])

  const coverage =
    scan?.found_in != null && scan?.points_total
      ? Math.round((scan.found_in / scan.points_total) * 100)
      : null

  const trendChart = useMemo(() => {
    const t = trends[0]
    if (!t) return []
    const series = Array.isArray(t.series) ? t.series : []
    return series.map((row) => {
      const r = row as Record<string, unknown>
      return {
        date: String(r.date ?? r.looker_date ?? ''),
        arp: Number(r.arp) || null,
        atrp: Number(r.atrp) || null,
        solv: Number(r.solv ?? r.saiv) || null,
      }
    })
  }, [trends])

  const aiSummary =
    scan?.ai_analysis && typeof scan.ai_analysis.summary === 'string'
      ? String(scan.ai_analysis.summary).replace(/<[^>]+>/g, ' ')
      : null

  return (
    <Card className="border-white/10 bg-white/5 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-white">Local Falcon</h3>
        <span className="text-[11px] text-white/40">
          full API workspace · A/B vs DataForSEO
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={sync} disabled={syncing}>
            {syncing ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Sync all
          </Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1 border-b border-white/10 pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
              tab === t.id
                ? 'bg-sky-500/25 text-sky-100'
                : 'bg-white/5 text-white/60 hover:bg-white/10'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {tab === 'scan' && (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-white/10 bg-slate-900/50 px-3 py-3">
            <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-[10px] uppercase tracking-wider text-white/40">
              Location
              <select
                value={placeId}
                onChange={(e) => {
                  const id = e.target.value
                  setPlaceId(id)
                  const loc = locations.find((l) => l.place_id === id)
                  if (loc?.lat != null) setCenterLat(Number(loc.lat))
                  if (loc?.lng != null) setCenterLng(Number(loc.lng))
                }}
                className="rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 text-xs normal-case text-white"
              >
                {locations.length === 0 && (
                  <option value="">Sync to load locations</option>
                )}
                {locations.map((l) => (
                  <option key={l.place_id} value={l.place_id}>
                    {l.name || l.place_id}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-[10px] uppercase tracking-wider text-white/40">
              Keyword
              <input
                list="lf-keywords"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 text-xs normal-case text-white"
              />
              <datalist id="lf-keywords">
                {GRID_KEYWORD_PRESETS.map((kw) => (
                  <option key={kw} value={kw} />
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-white/40">
              Grid
              <select
                value={gridSize}
                onChange={(e) => setGridSize(Number(e.target.value))}
                className="rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 text-xs normal-case text-white"
              >
                {LOCAL_FALCON_GRID_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}×{s} · {s * s} credits
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-20 flex-col gap-1 text-[10px] uppercase tracking-wider text-white/40">
              Radius
              <Input
                type="number"
                min={0.1}
                max={100}
                step={0.1}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="h-8"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-white/40">
              Platform
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 text-xs normal-case text-white"
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 pb-1 text-xs text-white/70">
              <input
                type="checkbox"
                checked={aiAnalysis}
                onChange={(e) => setAiAnalysis(e.target.checked)}
                className="accent-sky-500"
                disabled={platform !== 'google'}
              />
              AI analysis
            </label>
            <Button
              size="sm"
              variant={placeCenter ? 'default' : 'outline'}
              onClick={() => setPlaceCenter((v) => !v)}
            >
              <Crosshair className="mr-1.5 h-3.5 w-3.5" />
              {placeCenter ? 'Click map…' : 'Place center'}
            </Button>
            <Button
              size="sm"
              onClick={runNow}
              disabled={running || !placeId || !keyword.trim()}
            >
              {running ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="mr-1.5 h-3.5 w-3.5" />
              )}
              Run now · {credits}
            </Button>
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-2">
            {scans.length > 0 && (
              <select
                value={scan?.id ?? ''}
                onChange={(e) => loadScans(e.target.value)}
                className="rounded-md border border-white/15 bg-slate-900 px-2 py-1 text-xs text-white"
              >
                {scans.map((s) => (
                  <option key={s.id} value={s.id}>
                    {new Date(s.scanned_at).toLocaleDateString()} · {s.keyword} ·{' '}
                    {s.platform} · {s.grid_size}×{s.grid_size}
                  </option>
                ))}
              </select>
            )}
          </div>

          {scan && (
            <>
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-6">
                <Stat
                  label="Coverage"
                  value={coverage == null ? '—' : `${coverage}%`}
                  sub={`${scan.found_in ?? 0}/${scan.points_total ?? 0}`}
                />
                <Stat label="ATRP" value={n(scan.atrp)} sub="misses counted" />
                <Stat label="ARP" value={n(scan.arp)} sub="where ranked" />
                <Stat
                  label={scan.platform === 'google' ? 'SoLV' : 'SAIV'}
                  value={
                    scan.platform === 'google'
                      ? scan.solv == null
                        ? '—'
                        : `${n(scan.solv)}%`
                      : scan.saiv == null
                        ? '—'
                        : `${n(scan.saiv)}%`
                  }
                />
                <Stat
                  label="oSoLV"
                  value={scan.osolv == null ? '—' : `${n(scan.osolv)}%`}
                  sub="vs top"
                />
                <Stat
                  label="Competitors"
                  value={String(scan.unique_competitors ?? '—')}
                />
              </div>
              <p className="mb-3 font-mono text-[11px] text-white/40">
                &ldquo;{scan.keyword}&rdquo; · {scan.platform} ·{' '}
                {scan.grid_size}×{scan.grid_size} · {n(scan.radius, 1)}
                {scan.measurement} ·{' '}
                {new Date(scan.scanned_at).toLocaleString()}
                {scan.public_url && (
                  <>
                    {' · '}
                    <a
                      href={scan.public_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sky-400 hover:underline"
                    >
                      Falcon report <ExternalLink className="h-3 w-3" />
                    </a>
                  </>
                )}
              </p>
              {aiSummary && (
                <div className="mb-3 rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs text-sky-50/90">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-sky-200/60">
                    AI analysis
                  </div>
                  {aiSummary}
                </div>
              )}
            </>
          )}

          <div
            ref={container}
            className="h-[420px] w-full overflow-hidden rounded-lg"
          />
          {loading && (
            <p className="mt-2 flex items-center gap-2 text-sm text-white/60">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-3 border-t border-white/10 pt-2 font-mono text-[11px] text-white/50">
            <Legend color="#38bdf8" label="center" />
            <Legend color="#16a34a" label="1–3" />
            <Legend color="#ca8a04" label="4–10" />
            <Legend color="#dc2626" label="11–20" />
            <Legend color="#4b5563" label="– not in top 20" />
          </div>

          {selected && (
            <div className="mt-3 rounded-lg border border-white/10 bg-slate-900/60 p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-xs text-white/60">
                  {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)} · we rank{' '}
                  {selected.rank ?? 'nowhere'}
                </span>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-xs text-white/40 hover:text-white"
                >
                  close
                </button>
              </div>
              <ol className="max-h-48 space-y-0.5 overflow-y-auto">
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
        </>
      )}

      {tab === 'trends' && (
        <div className="space-y-3">
          <p className="text-xs text-white/50">
            Falcon auto-builds trend reports after 2+ identical non-campaign
            scans. ARP / ATRP / SoLV·SAIV over time.
          </p>
          {!trends.length && (
            <p className="text-sm text-white/50">
              No trend reports yet — Sync all, or keep weekly scans consistent.
            </p>
          )}
          {trends[0] && (
            <>
              <p className="font-mono text-[11px] text-white/40">
                {(trends[0].keyword as string) || '—'} ·{' '}
                {(trends[0].platform as string) || '—'} ·{' '}
                {String(trends[0].report_key)}
              </p>
              {trendChart.length > 0 && (
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendChart}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(255,255,255,0.1)"
                      />
                      <XAxis dataKey="date" stroke="#94a3b8" fontSize={10} />
                      <YAxis
                        stroke="#94a3b8"
                        fontSize={10}
                        reversed
                        domain={[1, 'auto']}
                      />
                      <Tooltip
                        contentStyle={{
                          background: '#0f172a',
                          border: '1px solid #334155',
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="arp"
                        stroke="#38bdf8"
                        dot={false}
                        name="ARP"
                      />
                      <Line
                        type="monotone"
                        dataKey="atrp"
                        stroke="#fbbf24"
                        dot={false}
                        name="ATRP"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              <ul className="space-y-1 text-xs text-white/60">
                {trends.map((t) => (
                  <li key={String(t.report_key)}>
                    {String(t.keyword)} · {String(t.platform)} ·{' '}
                    {String(t.report_key)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === 'competitors' && (
        <div className="space-y-2">
          <p className="text-xs text-white/50">
            Competitor reports Falcon generates with every scan — leaderboard
            payloads cached locally.
          </p>
          {!competitors.length && (
            <p className="text-sm text-white/50">
              None cached yet. Sync all after a scan.
            </p>
          )}
          {competitors.map((c) => (
            <div
              key={String(c.id || c.report_key)}
              className="rounded-lg border border-white/10 bg-slate-900/40 px-3 py-2 text-xs text-white/70"
            >
              <div className="font-medium text-white">
                {String(c.keyword || '—')} · {String(c.platform || '—')}
              </div>
              <div className="font-mono text-[10px] text-white/40">
                {String(c.report_key)} ·{' '}
                {c.scanned_at
                  ? new Date(String(c.scanned_at)).toLocaleString()
                  : '—'}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'campaigns' && (
        <CampaignsPanel
          campaigns={campaigns}
          locations={locations}
          onAction={async (payload) => {
            setError(null)
            try {
              await postAction(payload)
              await loadView('campaigns')
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Campaign action failed')
            }
          }}
        />
      )}

      {tab === 'guard' && (
        <GuardPanel
          locations={guardLocations}
          reports={guardReports}
          savedLocations={locations}
          onAction={async (payload) => {
            setError(null)
            try {
              await postAction(payload)
              await loadView('guard')
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Guard action failed')
            }
          }}
        />
      )}

      {tab === 'reviews' && (
        <div className="space-y-2">
          <p className="text-xs text-white/50">
            Reviews Analysis is a Falcon premium ($19/location). We surface every
            report the account already has.
          </p>
          {!reviews.length && (
            <p className="text-sm text-white/50">No reviews reports in account.</p>
          )}
          {reviews.map((r) => (
            <div
              key={String(r.report_key)}
              className="rounded-lg border border-white/10 bg-slate-900/40 px-3 py-2 text-xs text-white/70"
            >
              <div className="font-medium text-white">
                {String(r.name || r.report_key)}
              </div>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-white/40">
                {JSON.stringify(r.payload ?? r, null, 2).slice(0, 2000)}
              </pre>
            </div>
          ))}
        </div>
      )}

      {tab === 'account' && (
        <div className="space-y-2 text-sm text-white/70">
          <p>
            Email:{' '}
            <span className="text-white">
              {String(
                accountFull?.email ?? accountLite?.email ?? '—',
              )}
            </span>
          </p>
          <p>
            Last sync:{' '}
            {accountFull?.synced_at || accountLite?.synced_at
              ? new Date(
                  String(accountFull?.synced_at ?? accountLite?.synced_at),
                ).toLocaleString()
              : '—'}
          </p>
          <pre className="max-h-64 overflow-auto rounded-lg border border-white/10 bg-slate-950 p-3 font-mono text-[10px] text-white/50">
            {JSON.stringify(
              accountFull?.credits ??
                accountLite?.credits ??
                accountFull?.payload ??
                {},
              null,
              2,
            )}
          </pre>
        </div>
      )}
    </Card>
  )
}

function CampaignsPanel({
  campaigns,
  locations,
  onAction,
}: {
  campaigns: Array<Record<string, unknown>>
  locations: LFLocation[]
  onAction: (p: Record<string, unknown>) => Promise<void>
}) {
  const [name, setName] = useState('Sightings weekly')
  const [keyword, setKeyword] = useState('carpet cleaning')
  const [placeId, setPlaceId] = useState(locations[0]?.place_id ?? '')
  const [gridSize, setGridSize] = useState(9)
  const [radius, setRadius] = useState(8)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!placeId && locations[0]?.place_id) setPlaceId(locations[0].place_id)
  }, [locations, placeId])

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/50">
        Falcon-native campaigns (multi-keyword / scheduled). Separate from our
        Sightings weekly A/B scheduler above.
      </p>
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-white/10 bg-slate-900/40 px-3 py-3">
        <label className="flex flex-col gap-1 text-[10px] uppercase text-white/40">
          Name
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 w-40"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] uppercase text-white/40">
          Keywords
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="h-8 w-48"
            placeholder="comma-separated"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] uppercase text-white/40">
          Place
          <select
            value={placeId}
            onChange={(e) => setPlaceId(e.target.value)}
            className="rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 text-xs text-white"
          >
            {locations.map((l) => (
              <option key={l.place_id} value={l.place_id}>
                {l.name || l.place_id}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] uppercase text-white/40">
          Grid
          <select
            value={gridSize}
            onChange={(e) => setGridSize(Number(e.target.value))}
            className="rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 text-xs text-white"
          >
            {LOCAL_FALCON_GRID_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}×{s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex w-20 flex-col gap-1 text-[10px] uppercase text-white/40">
          Radius
          <Input
            type="number"
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="h-8"
          />
        </label>
        <Button
          size="sm"
          disabled={busy || !placeId || !name.trim()}
          onClick={async () => {
            if (!confirm('Create Falcon campaign?')) return
            setBusy(true)
            try {
              const tomorrow = new Date()
              tomorrow.setDate(tomorrow.getDate() + 1)
              const start = `${String(tomorrow.getMonth() + 1).padStart(2, '0')}/${String(tomorrow.getDate()).padStart(2, '0')}/${tomorrow.getFullYear()}`
              await onAction({
                action: 'campaign-create',
                name,
                keyword,
                place_id: placeId,
                grid_size: gridSize,
                radius,
                frequency: 'weekly',
                start_date: start,
                start_time: '9:00 AM',
                measurement: 'mi',
                ai_analysis: true,
              })
            } finally {
              setBusy(false)
            }
          }}
        >
          Create weekly
        </Button>
      </div>
      {!campaigns.length && (
        <p className="text-sm text-white/50">No campaigns cached — Sync all.</p>
      )}
      {campaigns.map((c) => (
        <div
          key={String(c.campaign_key)}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-slate-900/40 px-3 py-2 text-xs text-white/70"
        >
          <div className="min-w-0 flex-1">
            <div className="font-medium text-white">
              {String(c.name || c.campaign_key)}
            </div>
            <div className="font-mono text-[10px] text-white/40">
              {String(c.status)} · {String(c.frequency)} · ARP {n(c.arp as number)}{' '}
              · next {String(c.next_run || '—')}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onAction({
                action: 'campaign-run',
                campaign_key: c.campaign_key,
                confirm: true,
              })
            }
          >
            Run
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onAction({
                action: 'campaign-pause',
                campaign_key: c.campaign_key,
              })
            }
          >
            Pause
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onAction({
                action: 'campaign-resume',
                campaign_key: c.campaign_key,
              })
            }
          >
            Resume
          </Button>
        </div>
      ))}
    </div>
  )
}

function GuardPanel({
  locations,
  reports,
  savedLocations,
  onAction,
}: {
  locations: Array<Record<string, unknown>>
  reports: Array<Record<string, unknown>>
  savedLocations: LFLocation[]
  onAction: (p: Record<string, unknown>) => Promise<void>
}) {
  const [placeId, setPlaceId] = useState(savedLocations[0]?.place_id ?? '')
  return (
    <div className="space-y-3">
      <p className="text-xs text-white/50">
        Falcon Guard watches GBP fields for changes. Add/pause/resume/remove
        from here.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <select
          value={placeId}
          onChange={(e) => setPlaceId(e.target.value)}
          className="rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 text-xs text-white"
        >
          {savedLocations.map((l) => (
            <option key={l.place_id} value={l.place_id}>
              {l.name || l.place_id}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          onClick={() => onAction({ action: 'guard-add', place_id: placeId })}
        >
          Add to Guard
        </Button>
      </div>
      {!locations.length && (
        <p className="text-sm text-white/50">No Guard locations — Sync all.</p>
      )}
      {locations.map((l) => (
        <div
          key={String(l.place_id)}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-slate-900/40 px-3 py-2 text-xs text-white/70"
        >
          <div className="flex-1">
            <div className="font-medium text-white">
              {String(
                (l.location as { name?: string } | null)?.name || l.place_id,
              )}
            </div>
            <div className="font-mono text-[10px] text-white/40">
              {String(l.status)} · last {String(l.date_last || '—')}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onAction({ action: 'guard-pause', place_id: l.place_id })
            }
          >
            Pause
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onAction({ action: 'guard-resume', place_id: l.place_id })
            }
          >
            Resume
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onAction({ action: 'guard-delete', place_id: l.place_id })
            }
          >
            Remove
          </Button>
        </div>
      ))}
      {reports[0] && (
        <pre className="max-h-48 overflow-auto rounded-lg border border-white/10 bg-slate-950 p-2 font-mono text-[10px] text-white/40">
          {JSON.stringify(reports[0].payload ?? reports[0], null, 2).slice(
            0,
            2500,
          )}
        </pre>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-white/40">
        {label}
      </div>
      <div className="text-lg font-bold tabular-nums text-white">{value}</div>
      {sub && (
        <div className="font-mono text-[10px] text-white/40">{sub}</div>
      )}
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-3 w-3 rounded-full"
        style={{ background: color }}
      />
      {label}
    </span>
  )
}
