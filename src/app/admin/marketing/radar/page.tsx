'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  ArrowUp,
  ArrowDown,
  Minus,
  MapPin,
  Target,
  Loader2,
  Plus,
  Trash2,
  Search,
  RefreshCw,
  FileText,
  X,
  Pencil,
  ExternalLink,
  Menu,
  ListOrdered,
  Building2,
  TrendingUp,
  Table2,
  Map as MapIcon,
} from 'lucide-react'
import { GridHeatMap } from '@/components/admin/radar/GridHeatMap'
import { LocalFalconMap } from '@/components/admin/radar/LocalFalconMap'
import { EventTimeline } from '@/components/admin/radar/EventTimeline'
import { ScanScheduleCard } from '@/components/admin/radar/ScanScheduleCard'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Brush,
} from 'recharts'

type Keyword = { id: string; keyword: string; location: string }
type Domain = {
  id: string
  domain: string
  display_name: string | null
  is_my_domain: boolean
}
type Ranking = {
  id: string
  keyword_id: string
  domain_id: string
  rank_position: number
  map_rank?: number | null
  created_at: string
}
type SerpSnapshotRow = {
  keyword_id: string
  position: number
  domain: string
  rating?: number | null
  reviews?: number | null
  address?: string | null
}

type DossierProfile = {
  threat_level: string | null
  business_model: string | null
  primary_strength: string | null
  core_weakness: string | null
  sasquatch_counter_attack: string | null
  threat_archetype: string | null
  updated_at?: string
}

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000
const CHART_RANGES: { label: string; days: number | null }[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '60d', days: 60 },
  { label: 'All', days: null },
]
// Which rank the history chart plots. Only one at a time — the two use
// different scales (top 20 vs top 50), so overlaying them would be unreadable.
type ChartMetric = 'map' | 'organic'
const CHART_METRICS: { value: ChartMetric; label: string }[] = [
  { value: 'map', label: 'Map pack' },
  { value: 'organic', label: 'Organic' },
]

export default function RadarPage() {
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [domains, setDomains] = useState<Domain[]>([])
  const [rankings, setRankings] = useState<Ranking[]>([])
  const [snapshots, setSnapshots] = useState<SerpSnapshotRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Chart time window. null = all the history we have (capped by the 60-day
  // data fetch). The Brush under the chart zooms/scrolls within this window.
  const [rangeDays, setRangeDays] = useState<number | null>(null)
  const [chartMetric, setChartMetric] = useState<ChartMetric>('map')
  const cutoffForChart =
    rangeDays == null
      ? new Date(0)
      : new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000)

  // Form state
  const [newKeyword, setNewKeyword] = useState('')
  const [newKeywordLocation, setNewKeywordLocation] = useState(
    'Colorado Springs, Colorado, United States',
  )
  const [newDomain, setNewDomain] = useState('')
  const [newDomainDisplayName, setNewDomainDisplayName] = useState('')
  const [newDomainIsMine, setNewDomainIsMine] = useState(false)
  const [discoverKeyword, setDiscoverKeyword] = useState('')
  const [discoverLocation, setDiscoverLocation] = useState(
    'Colorado Springs, Colorado, United States',
  )
  const [discoverResults, setDiscoverResults] = useState<
    { domain: string; position: number }[]
  >([])
  const [discoverSelected, setDiscoverSelected] = useState<Set<string>>(
    new Set(),
  )
  const [discoverLoading, setDiscoverLoading] = useState(false)
  const [addKeywordLoading, setAddKeywordLoading] = useState(false)
  const [addDomainLoading, setAddDomainLoading] = useState(false)
  const [refreshLoading, setRefreshLoading] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  /** Sort: 'domain' | 'best-organic' | 'best-map' | 'keywordId__organic' | 'keywordId__map' */
  const [rankSortBy, setRankSortBy] = useState<string>('best-organic')
  /** Filter table columns by keyword location; '' = show all */
  const [locationFilter, setLocationFilter] = useState<string>('')
  /** Dossier side panel */
  const [dossierDomainId, setDossierDomainId] = useState<string | null>(null)
  const [dossierData, setDossierData] = useState<{
    domain: Domain
    profile: DossierProfile | null
  } | null>(null)
  const [dossierLoading, setDossierLoading] = useState(false)
  const [dossierEditMode, setDossierEditMode] = useState(false)
  const [dossierForm, setDossierForm] = useState<DossierProfile | null>(null)
  const [dossierSaving, setDossierSaving] = useState(false)
  const [generateDossiersLoading, setGenerateDossiersLoading] = useState(false)
  const [generateDossiersResult, setGenerateDossiersResult] = useState<{
    generated: number
    failed: number
    errors?: string[]
  } | null>(null)
  /** Hamburger nav: which section is visible */
  const [activeSection, setActiveSection] = useState<
    'data' | 'domains' | 'history' | 'table' | 'grid'
  >('data')
  const [menuOpen, setMenuOpen] = useState(false)
  const [profiles, setProfiles] = useState<
    {
      domain_id: string
      threat_level: string | null
      business_model: string | null
    }[]
  >([])

  const threatLevelByDomainId = new Map<string, string | null>()
  const businessModelByDomainId = new Map<string, string | null>()
  for (const p of profiles) {
    threatLevelByDomainId.set(p.domain_id, p.threat_level)
    businessModelByDomainId.set(p.domain_id, p.business_model)
  }

  const loadData = useCallback(async () => {
    const supabase = createClient()
    const sixtyDaysAgo = new Date(Date.now() - SIXTY_DAYS_MS)
    const [kwRes, domRes, rankRes, snapRes, profilesRes] = await Promise.all([
      supabase
        .from('radar_keywords')
        .select('id, keyword, location')
        .eq('active', true),
      supabase
        .from('radar_domains')
        .select('id, domain, display_name, is_my_domain'),
      supabase
        .from('radar_rankings')
        .select(
          'id, keyword_id, domain_id, rank_position, map_rank, created_at',
        )
        .gte('created_at', sixtyDaysAgo.toISOString())
        .order('created_at', { ascending: false }),
      supabase
        .from('radar_serp_snapshots')
        .select('keyword_id, position, domain, rating, reviews, address')
        .order('keyword_id')
        .order('position', { ascending: true }),
      supabase
        .from('radar_domain_profiles')
        .select('domain_id, threat_level, business_model'),
    ])
    if (kwRes.error) setError(kwRes.error.message)
    else setKeywords(kwRes.data ?? [])
    if (domRes.error) setError(domRes.error.message)
    else setDomains(domRes.data ?? [])
    if (rankRes.error) setError(rankRes.error.message)
    else setRankings(rankRes.data ?? [])
    if (snapRes.error) {
      if (snapRes.error.code !== '42P01') setError(snapRes.error.message)
    } else setSnapshots((snapRes.data as SerpSnapshotRow[]) ?? [])
    if (profilesRes.error) {
      if (profilesRes.error.code !== '42P01')
        setError(profilesRes.error.message)
    } else
      setProfiles(
        (profilesRes.data ?? []) as {
          domain_id: string
          threat_level: string | null
          business_model: string | null
        }[],
      )
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    loadData().finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [loadData])

  const handleAddKeyword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newKeyword.trim() || !newKeywordLocation.trim()) return
    setAddKeywordLoading(true)
    try {
      const res = await fetch('/api/admin/radar/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: newKeyword.trim(),
          location: newKeywordLocation.trim(),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || res.statusText)
      }
      setNewKeyword('')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add keyword')
    } finally {
      setAddKeywordLoading(false)
    }
  }

  const handleDeleteKeyword = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/radar/keywords/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Delete failed')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newDomain.trim()) return
    setAddDomainLoading(true)
    try {
      const res = await fetch('/api/admin/radar/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: newDomain.trim(),
          display_name: newDomainDisplayName.trim() || null,
          is_my_domain: newDomainIsMine,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || res.statusText)
      }
      setNewDomain('')
      setNewDomainDisplayName('')
      setNewDomainIsMine(false)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add domain')
    } finally {
      setAddDomainLoading(false)
    }
  }

  const handleDeleteDomain = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/radar/domains/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Delete failed')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const handleDiscover = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!discoverKeyword.trim() || !discoverLocation.trim()) return
    setDiscoverLoading(true)
    setDiscoverResults([])
    setDiscoverSelected(new Set())
    try {
      const res = await fetch('/api/admin/radar/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: discoverKeyword.trim(),
          location: discoverLocation.trim(),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || res.statusText)
      }
      const { results: list } = (await res.json()) as {
        results: { domain: string; position: number }[]
      }
      setDiscoverResults(list ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Discover failed')
    } finally {
      setDiscoverLoading(false)
    }
  }

  const toggleDiscoverSelected = (domain: string) => {
    setDiscoverSelected((prev) => {
      const next = new Set(prev)
      if (next.has(domain)) next.delete(domain)
      else next.add(domain)
      return next
    })
  }

  const handleRefreshRankings = async () => {
    setRefreshLoading(true)
    setRefreshMessage(null)
    setError(null)
    try {
      const res = await fetch('/api/admin/radar/refresh', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Refresh failed')
        return
      }
      const msg = `Done: ${data.keywords_processed} keywords processed, ${data.rankings_inserted} rankings saved.`
      setRefreshMessage(msg)
      if (data.rankings_inserted === 0 && data.error_detail) {
        setError(data.error_detail)
      }
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setRefreshLoading(false)
    }
  }

  const openDossier = useCallback(async (domainId: string) => {
    setDossierDomainId(domainId)
    setDossierData(null)
    setDossierEditMode(false)
    setDossierForm(null)
    setDossierLoading(true)
    try {
      const res = await fetch(`/api/admin/radar/domains/${domainId}`)
      if (!res.ok) {
        if (res.status === 404) setDossierDomainId(null)
        return
      }
      const data = (await res.json()) as {
        domain: Domain
        profile: DossierProfile | null
      }
      setDossierData(data)
      setDossierForm(
        data.profile
          ? { ...data.profile }
          : {
              threat_level: null,
              business_model: null,
              primary_strength: null,
              core_weakness: null,
              sasquatch_counter_attack: null,
              threat_archetype: null,
            },
      )
    } catch {
      setDossierDomainId(null)
    } finally {
      setDossierLoading(false)
    }
  }, [])

  const closeDossier = useCallback(() => {
    setDossierDomainId(null)
    setDossierData(null)
    setDossierEditMode(false)
    setDossierForm(null)
    setGenerateDossiersResult(null)
  }, [])

  const saveDossier = useCallback(async () => {
    if (!dossierDomainId || !dossierForm) return
    setDossierSaving(true)
    try {
      const res = await fetch(
        `/api/admin/radar/domains/${dossierDomainId}/profile`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dossierForm),
        },
      )
      if (!res.ok) throw new Error('Save failed')
      const profile = (await res.json()) as DossierProfile
      setDossierData((prev) => (prev ? { ...prev, profile } : null))
      setDossierForm(profile)
      setDossierEditMode(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save dossier')
    } finally {
      setDossierSaving(false)
    }
  }, [dossierDomainId, dossierForm])

  const handleGenerateAllDossiers = useCallback(async () => {
    setGenerateDossiersLoading(true)
    setGenerateDossiersResult(null)
    setError(null)
    try {
      const res = await fetch('/api/admin/radar/dossiers/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = (await res.json()) as {
        generated?: number
        failed?: number
        errors?: string[]
        error?: string
      }
      if (!res.ok) {
        setError(data.error ?? 'Generate failed')
        return
      }
      setGenerateDossiersResult({
        generated: data.generated ?? 0,
        failed: data.failed ?? 0,
        errors: data.errors,
      })
      if (dossierDomainId && dossierData) {
        const fresh = await fetch(
          `/api/admin/radar/domains/${dossierDomainId}`,
        ).then((r) => r.json())
        setDossierData(fresh)
        setDossierForm(fresh.profile ? { ...fresh.profile } : dossierForm)
      }
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generate dossiers failed')
    } finally {
      setGenerateDossiersLoading(false)
    }
  }, [dossierDomainId, dossierData, loadData])

  const handleAddSelectedDomains = async () => {
    if (discoverSelected.size === 0) return
    setAddDomainLoading(true)
    try {
      for (const domain of discoverSelected) {
        const res = await fetch('/api/admin/radar/domains', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            domain,
            display_name: null,
            is_my_domain: false,
          }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || `Failed to add ${domain}`)
        }
      }
      setDiscoverSelected(new Set())
      setDiscoverResults([])
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add selected failed')
    } finally {
      setAddDomainLoading(false)
    }
  }

  const latestMap = new Map<string, number>()
  const latestMapPack = new Map<string, number>()
  const previousMap = new Map<string, number>()
  for (const r of rankings) {
    const key = `${r.keyword_id}:${r.domain_id}`
    if (!latestMap.has(key)) {
      latestMap.set(key, r.rank_position)
      if (r.map_rank != null) latestMapPack.set(key, r.map_rank)
    } else if (!previousMap.has(key)) {
      previousMap.set(key, r.rank_position)
    }
  }

  // Rank history for our own domains. Two views, toggled in the UI:
  //
  //  - "map"     — our spot in Google's Maps local finder (top ~20). This is
  //                what drives local calls, so it's the default. Out-of-top-20
  //                shows as a sentinel just below #20 so a drop is visible
  //                rather than a confusing gap.
  //  - "organic" — the blue-link position. Usually useless for head terms like
  //                "carpet cleaning" (directories and national chains own them,
  //                so we sit at the 50 floor), but it's the only signal left
  //                while the GBP is gone, and smaller towns do break through.
  //
  // 50 is the scanner's "not found in the top 50" sentinel, not a real rank —
  // see rank_position in lib/radar-scan.ts.
  const OUT_OF_PACK = 21
  const ORGANIC_FLOOR = 50
  const myDomainIds = new Set(
    domains.filter((d) => d.is_my_domain).map((d) => d.id),
  )
  const myChartRows = rankings.filter(
    (r) =>
      myDomainIds.has(r.domain_id) && new Date(r.created_at) >= cutoffForChart,
  )
  const townLabel = (loc: string) => loc.split(',')[0].trim()
  const SERIES_COLORS = ['#22c55e', '#3b82f6', '#a855f7', '#f59e0b', '#ec4899']

  // Real position for the given metric, or null when we didn't place at all.
  const placedAt = (r: Ranking, metric: ChartMetric) =>
    metric === 'map'
      ? (r.map_rank ?? null)
      : r.rank_position < ORGANIC_FLOOR
        ? r.rank_position
        : null

  const buildRankChart = (metric: ChartMetric) => {
    const outValue = metric === 'map' ? OUT_OF_PACK : ORGANIC_FLOOR
    // Only chart towns we've placed in at least once in the window — towns we
    // never rank in would just be a flat "Out" line cluttering the chart.
    const keywordIds = [
      ...new Set(
        myChartRows
          .filter((r) => placedAt(r, metric) != null)
          .map((r) => r.keyword_id),
      ),
    ]
    const series = keywordIds.map((id, i) => {
      const k = keywords.find((kk) => kk.id === id)
      return {
        id,
        label: k ? townLabel(k.location) : String(id),
        color: SERIES_COLORS[i % SERIES_COLORS.length],
      }
    })
    const byDate = new Map<string, Record<string, number | string>>()
    for (const r of myChartRows) {
      const s = series.find((ss) => ss.id === r.keyword_id)
      if (!s) continue
      const date = r.created_at.slice(0, 10)
      if (!byDate.has(date)) byDate.set(date, { date })
      const row = byDate.get(date)!
      const value = placedAt(r, metric) ?? outValue
      const prev = row[s.label]
      // Best (lowest) placement that day — we own more than one domain, and a
      // day can hold more than one scan.
      if (typeof prev !== 'number' || value < prev) row[s.label] = value
    }
    const data = Array.from(byDate.values()).sort((a, b) =>
      (a.date as string) < (b.date as string) ? -1 : 1,
    )
    return { series, data, outValue }
  }

  const mapChart = buildRankChart('map')
  const organicChart = buildRankChart('organic')
  const activeChart = chartMetric === 'map' ? mapChart : organicChart
  const chartHasAnyData =
    mapChart.data.length > 0 || organicChart.data.length > 0
  const formatRank = (v: number) =>
    chartMetric === 'map'
      ? v >= OUT_OF_PACK
        ? 'Out'
        : `#${v}`
      : v >= ORGANIC_FLOOR
        ? '50+'
        : `#${v}`

  const hasData = keywords.length > 0 && domains.length > 0

  const locations = [
    ...new Set(keywords.map((k) => k.location)),
  ].sort() as string[]
  const filteredKeywords = locationFilter
    ? keywords.filter((k) => k.location === locationFilter)
    : keywords

  const snapshotByKeyword = new Map<
    string,
    {
      position: number
      domain: string
      rating?: number | null
      reviews?: number | null
      address?: string | null
    }[]
  >()
  for (const row of snapshots) {
    const list = snapshotByKeyword.get(row.keyword_id) ?? []
    list.push({
      position: row.position,
      domain: row.domain,
      rating: row.rating,
      reviews: row.reviews,
      address: row.address,
    })
    snapshotByKeyword.set(row.keyword_id, list)
  }

  // Sorted domains: by company name, best organic, best map, or one keyword's organic/map (no combo)
  const sortedDomains = [...domains].sort((a, b) => {
    if (rankSortBy === 'domain') {
      return (a.display_name || a.domain).localeCompare(
        b.display_name || b.domain,
      )
    }
    if (rankSortBy === 'best-organic') {
      const bestA = Math.min(
        ...filteredKeywords.map((k) => latestMap.get(`${k.id}:${a.id}`) ?? 100),
      )
      const bestB = Math.min(
        ...filteredKeywords.map((k) => latestMap.get(`${k.id}:${b.id}`) ?? 100),
      )
      return bestA - bestB
    }
    if (rankSortBy === 'best-map') {
      const bestA = Math.min(
        ...filteredKeywords.map(
          (k) => latestMapPack.get(`${k.id}:${a.id}`) ?? 99,
        ),
      )
      const bestB = Math.min(
        ...filteredKeywords.map(
          (k) => latestMapPack.get(`${k.id}:${b.id}`) ?? 99,
        ),
      )
      return bestA - bestB
    }
    if (rankSortBy.endsWith('__organic')) {
      const kwId = rankSortBy.slice(0, -9)
      const rankA = latestMap.get(`${kwId}:${a.id}`) ?? 100
      const rankB = latestMap.get(`${kwId}:${b.id}`) ?? 100
      return rankA - rankB
    }
    if (rankSortBy.endsWith('__map')) {
      const kwId = rankSortBy.slice(0, -6)
      const rankA = latestMapPack.get(`${kwId}:${a.id}`) ?? 99
      const rankB = latestMapPack.get(`${kwId}:${b.id}`) ?? 99
      return rankA - rankB
    }
    return 0
  })

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center gap-2 text-white">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span>Loading Radar...</span>
      </div>
    )
  }

  const sectionLabels = {
    data: 'Data entry',
    domains: 'Domains',
    history: 'Ranking history',
    table: 'Rankings table',
    grid: 'Rank grids',
  }

  function BusinessModelBadge({ domainId }: { domainId: string }) {
    const model = businessModelByDomainId.get(domainId) ?? null
    const label = model?.trim() || '—'
    return (
      <span
        className="inline-flex max-w-[140px] shrink-0 truncate rounded bg-white/10 px-1.5 py-0.5 text-xs font-medium text-white/80"
        title={model ? `Business model: ${model}` : 'No dossier yet'}
      >
        {label}
      </span>
    )
  }

  return (
    <div className="space-y-6">
      {/* Top bar: hamburger + title */}
      <div className="flex items-center gap-3 border-b border-white/20 pb-3">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
        >
          <Menu className="h-6 w-6" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-white sm:text-2xl">
            Radar
          </h1>
          <p className="truncate text-sm text-white/60">
            {sectionLabels[activeSection]}
          </p>
        </div>
        <Target className="h-7 w-7 shrink-0 text-green-400" />
      </div>

      {/* Slide-out nav */}
      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-30 bg-black/50"
            onClick={() => setMenuOpen(false)}
          />
          <nav
            className="fixed top-0 left-0 z-40 flex h-full w-72 flex-col border-r border-white/20 bg-black/95 shadow-xl backdrop-blur"
            aria-label="Radar sections"
          >
            <div className="flex items-center justify-between border-b border-white/20 p-4">
              <span className="font-semibold text-white">Sections</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="rounded p-1 text-white/80 hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <ul className="flex flex-col p-2">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('data')
                    setMenuOpen(false)
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
                    activeSection === 'data'
                      ? 'bg-green-600/30 text-green-300'
                      : 'text-white/90 hover:bg-white/10'
                  }`}
                >
                  <ListOrdered className="h-5 w-5 shrink-0" />
                  Data entry
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('domains')
                    setMenuOpen(false)
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
                    activeSection === 'domains'
                      ? 'bg-green-600/30 text-green-300'
                      : 'text-white/90 hover:bg-white/10'
                  }`}
                >
                  <Building2 className="h-5 w-5 shrink-0" />
                  Domains
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('history')
                    setMenuOpen(false)
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
                    activeSection === 'history'
                      ? 'bg-green-600/30 text-green-300'
                      : 'text-white/90 hover:bg-white/10'
                  }`}
                >
                  <TrendingUp className="h-5 w-5 shrink-0" />
                  Ranking history
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('grid')
                    setMenuOpen(false)
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
                    activeSection === 'grid'
                      ? 'bg-green-600/30 text-green-300'
                      : 'text-white/90 hover:bg-white/10'
                  }`}
                >
                  <MapIcon className="h-5 w-5 shrink-0" />
                  Rank grids
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('table')
                    setMenuOpen(false)
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
                    activeSection === 'table'
                      ? 'bg-green-600/30 text-green-300'
                      : 'text-white/90 hover:bg-white/10'
                  }`}
                >
                  <Table2 className="h-5 w-5 shrink-0" />
                  Rankings table
                </button>
              </li>
            </ul>
          </nav>
        </>
      )}

      {/* Section: Rank grids (Local Falcon vs DataForSEO A/B) */}
      {activeSection === 'grid' && (
        <div className="space-y-4">
          <ScanScheduleCard />
          <LocalFalconMap />
          <GridHeatMap />
        </div>
      )}

      {/* Section: Data entry */}
      {activeSection === 'data' && (
        <div className="space-y-8">
          {/* How to use */}
          <Card className="border-green-500/30 bg-black/40 p-4 backdrop-blur-sm">
            <h2 className="mb-2 text-lg font-semibold text-white">
              How to use Radar
            </h2>
            <p className="mb-3 rounded bg-amber-500/20 px-2 py-1.5 text-sm text-amber-200">
              <strong>Required setup:</strong> In Vercel (Project → Settings →
              Environment Variables), add{' '}
              <code className="rounded bg-black/30 px-1">SERPAPI_API_KEY</code>{' '}
              with your SerpApi key from serpapi.com. Without it, rankings will
              stay empty and refresh will report an error.
            </p>
            <ol className="list-inside list-decimal space-y-1.5 text-sm text-white/80">
              <li>
                <strong className="text-white">Add keywords</strong> – Type the
                search phrases you care about (e.g. “carpet cleaning colorado
                springs”) and the location. Click Add keyword.
              </li>
              <li>
                <strong className="text-white">Add domains to track</strong> –
                Either use “Discover competitors” (search Google and pick which
                domains to add) or “Add domain manually” if you already know a
                competitor’s domain. Mark your own site with “This is my
                domain.”
              </li>
              <li>
                <strong className="text-white">Get rankings</strong> – Click
                “Refresh rankings” in Step 3 to run a scan now (checks Google
                for each keyword and saves positions). Or wait for the daily
                cron. The table and chart will then show positions and movement.
              </li>
            </ol>
          </Card>

          {error && (
            <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </div>
          )}

          {/* Add keyword */}
          <Card className="border-white/20 bg-black/40 p-4 backdrop-blur-sm">
            <h2 className="mb-1 text-lg font-semibold text-white">
              Step 1 – Add keyword to track
            </h2>
            <p className="mb-3 text-sm text-white/70">
              Type the exact phrase you want to track (as someone would search
              on Google) and the location for local results. Click “Add
              keyword.” The cron job will periodically check where your domains
              rank for these phrases.
            </p>
            <form
              onSubmit={handleAddKeyword}
              className="flex flex-wrap items-end gap-3"
            >
              <div className="min-w-[200px] flex-1 space-y-1">
                <Label htmlFor="radar-keyword" className="text-white/80">
                  Keyword
                </Label>
                <Input
                  id="radar-keyword"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  placeholder="e.g. commercial carpet cleaning colorado springs"
                  className="border-white/20 bg-white/5 text-white placeholder:text-white/40"
                />
              </div>
              <div className="min-w-[200px] flex-1 space-y-1">
                <Label htmlFor="radar-location" className="text-white/80">
                  Location
                </Label>
                <Input
                  id="radar-location"
                  value={newKeywordLocation}
                  onChange={(e) => setNewKeywordLocation(e.target.value)}
                  placeholder="Colorado Springs, Colorado, United States"
                  className="border-white/20 bg-white/5 text-white placeholder:text-white/40"
                />
              </div>
              <Button
                type="submit"
                disabled={addKeywordLoading || !newKeyword.trim()}
                className="bg-green-600 hover:bg-green-700"
              >
                {addKeywordLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="mr-1 h-4 w-4" />
                    Add keyword
                  </>
                )}
              </Button>
            </form>
          </Card>

          {/* Keywords list */}
          <Card className="border-white/20 bg-black/40 p-4 backdrop-blur-sm">
            <h2 className="mb-1 text-lg font-semibold text-white">
              Your keywords ({keywords.length})
            </h2>
            <p className="mb-3 text-sm text-white/60">
              All keywords you’ve added. Use the trash icon to remove one.
            </p>
            {keywords.length === 0 ? (
              <p className="text-sm text-white/60">
                No keywords yet. Use the form above (Step 1) to add one.
              </p>
            ) : (
              <ul className="space-y-2">
                {keywords.map((k) => (
                  <li
                    key={k.id}
                    className="flex items-center justify-between rounded bg-white/5 px-3 py-2 text-white/90"
                  >
                    <span>
                      <strong>{k.keyword}</strong>
                      <span className="ml-2 text-white/60">({k.location})</span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-red-400 hover:bg-red-500/20 hover:text-red-300"
                      onClick={() => handleDeleteKeyword(k.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Discover competitors */}
          <Card className="border-white/20 bg-black/40 p-4 backdrop-blur-sm">
            <h2 className="mb-1 text-lg font-semibold text-white">
              Step 2a – Discover competitors from Google
            </h2>
            <p className="mb-3 text-sm text-white/70">
              <strong>Directions:</strong> Enter a keyword and location, then
              click “Discover domains.” We run a Google search and list the
              domains that appear in the results. Check the boxes next to the
              domains you want to track (e.g. competitors), then click “Add
              selected.” You can run this for different keywords to find more
              competitors. Domains already in your list are disabled.
            </p>
            <form
              onSubmit={handleDiscover}
              className="mb-4 flex flex-wrap items-end gap-3"
            >
              <div className="min-w-[200px] flex-1 space-y-1">
                <Label htmlFor="discover-keyword" className="text-white/80">
                  Keyword
                </Label>
                <Input
                  id="discover-keyword"
                  value={discoverKeyword}
                  onChange={(e) => setDiscoverKeyword(e.target.value)}
                  placeholder="e.g. carpet cleaning monument"
                  className="border-white/20 bg-white/5 text-white placeholder:text-white/40"
                />
              </div>
              <div className="min-w-[200px] flex-1 space-y-1">
                <Label htmlFor="discover-location" className="text-white/80">
                  Location
                </Label>
                <Input
                  id="discover-location"
                  value={discoverLocation}
                  onChange={(e) => setDiscoverLocation(e.target.value)}
                  placeholder="Colorado Springs, Colorado, United States"
                  className="border-white/20 bg-white/5 text-white placeholder:text-white/40"
                />
              </div>
              <Button
                type="submit"
                disabled={discoverLoading || !discoverKeyword.trim()}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {discoverLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Search className="mr-1 h-4 w-4" />
                    Discover domains
                  </>
                )}
              </Button>
            </form>
            {discoverResults.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-white/70">
                  Who’s ranking #1–10 for this search. Check domains to add to
                  your list, then click “Add selected.”
                </p>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded bg-white/5 p-2">
                  {discoverResults.map((r) => {
                    const alreadyAdded = domains.some(
                      (x) =>
                        x.domain.toLowerCase().replace(/^www\./, '') ===
                        r.domain.toLowerCase().replace(/^www\./, ''),
                    )
                    return (
                      <label
                        key={`${r.position}-${r.domain}`}
                        className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm ${
                          alreadyAdded ? 'text-white/50' : 'text-white/90'
                        }`}
                      >
                        <Checkbox
                          checked={discoverSelected.has(r.domain)}
                          onCheckedChange={() =>
                            toggleDiscoverSelected(r.domain)
                          }
                          disabled={alreadyAdded}
                        />
                        <span className="w-6 shrink-0 font-medium">
                          #{r.position}
                        </span>
                        <span>{r.domain}</span>
                        {alreadyAdded && (
                          <span className="text-xs text-white/50">
                            (already added)
                          </span>
                        )}
                      </label>
                    )
                  })}
                </div>
                <Button
                  type="button"
                  disabled={discoverSelected.size === 0 || addDomainLoading}
                  onClick={handleAddSelectedDomains}
                  className="mt-2 bg-green-600 hover:bg-green-700"
                >
                  {addDomainLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    `Add selected (${discoverSelected.size})`
                  )}
                </Button>
              </div>
            )}
          </Card>

          {/* Add domain (manual) */}
          <Card className="border-white/20 bg-black/40 p-4 backdrop-blur-sm">
            <h2 className="mb-1 text-lg font-semibold text-white">
              Step 2b – Add domain manually
            </h2>
            <p className="mb-3 text-sm text-white/70">
              <strong>Directions:</strong> If you already know a competitor’s
              domain (e.g. premiercarpetcleaning.com), enter it here. Optionally
              add a display name for the table. Check “This is my domain” for
              sasquatchcarpet.com so we can highlight your row in the rankings.
            </p>
            <form
              onSubmit={handleAddDomain}
              className="flex flex-wrap items-end gap-3"
            >
              <div className="min-w-[180px] flex-1 space-y-1">
                <Label htmlFor="radar-domain" className="text-white/80">
                  Domain
                </Label>
                <Input
                  id="radar-domain"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  placeholder="example.com"
                  className="border-white/20 bg-white/5 text-white placeholder:text-white/40"
                />
              </div>
              <div className="min-w-[140px] flex-1 space-y-1">
                <Label htmlFor="radar-display-name" className="text-white/80">
                  Display name (optional)
                </Label>
                <Input
                  id="radar-display-name"
                  value={newDomainDisplayName}
                  onChange={(e) => setNewDomainDisplayName(e.target.value)}
                  placeholder="Competitor A"
                  className="border-white/20 bg-white/5 text-white placeholder:text-white/40"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-white/80">
                <Checkbox
                  checked={newDomainIsMine}
                  onCheckedChange={(v) => setNewDomainIsMine(Boolean(v))}
                />
                This is my domain
              </label>
              <Button
                type="submit"
                disabled={addDomainLoading || !newDomain.trim()}
                className="bg-green-600 hover:bg-green-700"
              >
                {addDomainLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="mr-1 h-4 w-4" />
                    Add domain
                  </>
                )}
              </Button>
            </form>
          </Card>
        </div>
      )}

      {/* Section: Domains */}
      {activeSection === 'domains' && (
        <div className="space-y-6">
          {/* Domains list */}
          <Card className="border-white/20 bg-black/40 p-4 backdrop-blur-sm">
            <h2 className="mb-1 text-lg font-semibold text-white">
              Your domains ({domains.length})
            </h2>
            <p className="mb-3 text-sm text-white/60">
              All domains you’re tracking (yours and competitors). Use the trash
              icon to remove one.
            </p>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={generateDossiersLoading || domains.length === 0}
                onClick={handleGenerateAllDossiers}
                className="border-white/30 text-white/90 hover:bg-white/10"
              >
                {generateDossiersLoading ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    Generating dossiers…
                  </>
                ) : (
                  <>
                    <FileText className="mr-1.5 h-4 w-4" />
                    Generate all dossiers
                  </>
                )}
              </Button>
              {generateDossiersResult && (
                <span className="flex flex-col gap-1 text-sm text-white/70">
                  <span>
                    Generated {generateDossiersResult.generated}, failed{' '}
                    {generateDossiersResult.failed}
                    {generateDossiersResult.errors?.length ? (
                      <span className="ml-1 text-amber-400">
                        ({generateDossiersResult.errors.length} errors)
                      </span>
                    ) : null}
                  </span>
                  {generateDossiersResult.errors?.length ? (
                    <details className="text-xs text-white/60">
                      <summary className="cursor-pointer text-amber-400/90 hover:underline">
                        Show error details
                      </summary>
                      <ul className="mt-1 max-h-32 list-inside list-disc overflow-y-auto">
                        {generateDossiersResult.errors
                          .slice(0, 10)
                          .map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
                        {generateDossiersResult.errors.length > 10 && (
                          <li>
                            … and {generateDossiersResult.errors.length - 10}{' '}
                            more
                          </li>
                        )}
                      </ul>
                    </details>
                  ) : null}
                </span>
              )}
            </div>
            {domains.length === 0 ? (
              <p className="text-sm text-white/60">
                No domains yet. Use “Discover competitors” (Step 2a) or “Add
                domain manually” (Step 2b) above.
              </p>
            ) : (
              <ul className="space-y-2">
                {domains.map((d) => {
                  const threat = threatLevelByDomainId.get(d.id) ?? null
                  const borderClass =
                    threat === 'High'
                      ? 'border-l-4 border-l-red-500'
                      : threat === 'Medium'
                        ? 'border-l-4 border-l-blue-500'
                        : threat === 'Low'
                          ? 'border-l-4 border-l-green-500'
                          : threat === 'Paper Tiger'
                            ? 'border-l-4 border-l-amber-500'
                            : ''
                  return (
                    <li
                      key={d.id}
                      className={`flex items-center justify-between rounded bg-white/5 px-3 py-2 text-white/90 ${borderClass}`}
                    >
                      <button
                        type="button"
                        onClick={() => openDossier(d.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline"
                        title="Open competitor dossier"
                      >
                        <FileText className="h-4 w-4 shrink-0 text-white/50" />
                        <span className="min-w-0 flex-1">
                          {d.display_name || d.domain}
                          {d.is_my_domain && (
                            <span className="ml-2 text-green-400">(you)</span>
                          )}
                          {d.display_name && (
                            <span className="ml-2 text-white/50">
                              {d.domain}
                            </span>
                          )}
                        </span>
                        <BusinessModelBadge domainId={d.id} />
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-red-400 hover:bg-red-500/20 hover:text-red-300"
                        onClick={() => handleDeleteDomain(d.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* Section: Ranking history */}
      {activeSection === 'history' && (
        <div className="space-y-8">
          <EventTimeline />

          {/* Rankings chart */}
          {hasData && chartHasAnyData && (
            <Card className="border-white/20 bg-black/40 p-4 backdrop-blur-sm">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-white">
                  {chartMetric === 'map' ? 'Map-pack rank' : 'Organic rank'} –
                  Your domain
                </h2>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex gap-1">
                    {CHART_METRICS.map((m) => (
                      <button
                        key={m.value}
                        onClick={() => setChartMetric(m.value)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                          chartMetric === m.value
                            ? 'bg-emerald-500/25 text-emerald-200'
                            : 'bg-white/5 text-white/60 hover:bg-white/10'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    {CHART_RANGES.map((r) => (
                      <button
                        key={r.label}
                        onClick={() => setRangeDays(r.days)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                          rangeDays === r.days
                            ? 'bg-white/20 text-white'
                            : 'bg-white/5 text-white/60 hover:bg-white/10'
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <p className="mb-4 text-sm text-white/60">
                {chartMetric === 'map' ? (
                  <>
                    Your spot in Google’s Maps local finder per town — #1 at the
                    top, “Out” = not in the top 20. The top 3 is the coveted
                    3-pack that drives local calls; everything below shows how
                    close you are to breaking in. Switch to Organic above for
                    the blue-link results, which keep working even when the map
                    pack doesn’t.
                  </>
                ) : (
                  <>
                    Your spot in Google’s regular blue-link results per town —
                    #1 at the top, “50+” = not found in the top 50. Head terms
                    like “carpet cleaning” are dominated by directories and
                    national chains, so smaller towns are where you break
                    through. This is the view that still shows movement while
                    the map pack is down.
                  </>
                )}{' '}
                One line per town you’ve appeared in. Pick a range above, or
                drag the slider under the chart to zoom and scroll. Tracking
                started 2026-06-06, so history fills in daily from there.
              </p>
              {activeChart.data.length > 0 && activeChart.series.length > 0 ? (
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={activeChart.data}
                      margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(255,255,255,0.1)"
                      />
                      <XAxis
                        dataKey="date"
                        stroke="rgba(255,255,255,0.6)"
                        fontSize={12}
                      />
                      <YAxis
                        reversed
                        domain={[1, activeChart.outValue]}
                        ticks={
                          chartMetric === 'map'
                            ? [1, 3, 5, 10, 15, 20, OUT_OF_PACK]
                            : [1, 3, 5, 10, 20, 30, 40, ORGANIC_FLOOR]
                        }
                        tickFormatter={formatRank}
                        stroke="rgba(255,255,255,0.6)"
                        fontSize={12}
                      />
                      <Tooltip
                        contentStyle={{
                          background: '#1a1a1a',
                          border: '1px solid rgba(255,255,255,0.2)',
                        }}
                        labelStyle={{ color: '#e5e5e5' }}
                        formatter={(v) =>
                          typeof v === 'number' ? formatRank(v) : v
                        }
                      />
                      <Legend />
                      {activeChart.series.map((s) => (
                        <Line
                          key={s.id}
                          type="monotone"
                          dataKey={s.label}
                          name={s.label}
                          stroke={s.color}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                      ))}
                      {activeChart.data.length > 2 && (
                        <Brush
                          dataKey="date"
                          height={22}
                          travellerWidth={8}
                          stroke="rgba(255,255,255,0.35)"
                          fill="rgba(255,255,255,0.04)"
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex h-[300px] w-full items-center justify-center rounded-md border border-white/10 bg-white/[0.02] px-6 text-center text-sm text-white/50">
                  No {chartMetric === 'map' ? 'map-pack' : 'organic'} placements
                  in this range — you haven’t cracked the top{' '}
                  {chartMetric === 'map' ? '20' : '50'} in any tracked town.
                  Try a wider range, or switch views above.
                </div>
              )}
            </Card>
          )}

          {/* Who's actually ranking #1–10 (from SerpApi, not just our list) */}
          {keywords.length > 0 && snapshotByKeyword.size > 0 && (
            <Card className="border-white/20 bg-black/40 p-4 backdrop-blur-sm">
              <h2 className="mb-1 text-lg font-semibold text-white">
                Who’s ranking #1–10 (from latest scan)
              </h2>
              <p className="mb-4 text-sm text-white/60">
                Actual Google order from the last refresh. When Google shows a
                local pack we also pull star rating, review count, and address
                (town/area). Add any domain to &quot;Your domains&quot; to track
                in the table below.
              </p>
              <div className="space-y-4">
                {keywords.map((kw) => {
                  const list = snapshotByKeyword.get(kw.id) ?? []
                  const top10 = list.slice(0, 10)
                  if (top10.length === 0) return null
                  return (
                    <div key={kw.id}>
                      <h3 className="mb-1.5 text-sm font-medium text-white/90">
                        {kw.keyword}
                        <span className="ml-1.5 font-normal text-white/50">
                          ({kw.location})
                        </span>
                      </h3>
                      <ol className="list-inside list-decimal space-y-0.5 text-sm text-white/80">
                        {top10.map((s, i) => (
                          <li key={`${kw.id}-${i}-${s.domain}`}>
                            {s.domain}
                            {s.rating != null && (
                              <span className="ml-2 text-amber-400">
                                ★ {s.rating}
                                {s.reviews != null && s.reviews > 0 && (
                                  <span className="text-white/60">
                                    {' '}
                                    ({s.reviews} reviews)
                                  </span>
                                )}
                              </span>
                            )}
                            {s.address && (
                              <span className="block pl-6 text-xs text-white/50">
                                {s.address}
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Section: Rankings table */}
      {activeSection === 'table' && (
        <div className="space-y-6">
          {/* Rankings table - only when we have data */}
          {hasData ? (
            <Card className="overflow-hidden border-white/20 bg-black/40 backdrop-blur-sm">
              <div className="border-b border-white/20 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">
                      Step 3 – Rankings table (companies × keywords)
                    </h2>
                    <p className="mt-1 text-sm text-white/60">
                      Each row is a company; each column is a keyword (location
                      shown under keyword). Use Location to show only one area;
                      use Sort by to order rows. Green up = improved; red down =
                      dropped.
                    </p>
                    {refreshMessage && (
                      <p className="mt-2 text-sm text-green-400">
                        {refreshMessage}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    onClick={handleRefreshRankings}
                    disabled={
                      refreshLoading ||
                      keywords.length === 0 ||
                      domains.length === 0
                    }
                    className="shrink-0 bg-green-600 hover:bg-green-700"
                  >
                    {refreshLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <RefreshCw className="mr-1.5 h-4 w-4" />
                        Refresh rankings
                      </>
                    )}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 border-b border-white/10 px-3 py-2">
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="radar-location"
                    className="text-sm text-white/70"
                  >
                    Location:
                  </label>
                  <select
                    id="radar-location"
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                    className="rounded border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white focus:border-green-500 focus:outline-none"
                  >
                    <option value="">All locations</option>
                    {locations.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1.5 text-sm text-white/70">
                  <span className="mr-1">Sort:</span>
                  <button
                    type="button"
                    onClick={() => setRankSortBy('domain')}
                    className={`rounded px-2.5 py-1 transition ${
                      rankSortBy === 'domain'
                        ? 'bg-white/20 text-white'
                        : 'bg-white/10 text-white/80 hover:bg-white/15'
                    }`}
                  >
                    Company A–Z
                  </button>
                  <button
                    type="button"
                    onClick={() => setRankSortBy('best-organic')}
                    className={`rounded px-2.5 py-1 transition ${
                      rankSortBy === 'best-organic'
                        ? 'bg-white/20 text-white'
                        : 'bg-white/10 text-white/80 hover:bg-white/15'
                    }`}
                  >
                    Best organic
                  </button>
                  <button
                    type="button"
                    onClick={() => setRankSortBy('best-map')}
                    className={`rounded px-2.5 py-1 transition ${
                      rankSortBy === 'best-map'
                        ? 'bg-white/20 text-white'
                        : 'bg-white/10 text-white/80 hover:bg-white/15'
                    }`}
                  >
                    Best map
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/20 text-white/80">
                      <th className="p-2 font-semibold sm:p-3">Company</th>
                      {filteredKeywords.map((kw) => (
                        <th
                          key={kw.id}
                          colSpan={2}
                          className="max-w-[180px] border-l border-white/10 p-0 sm:max-w-none"
                          title={`${kw.keyword} — ${kw.location}`}
                        >
                          <div className="border-b border-white/10 p-2 sm:p-3">
                            <span className="block truncate font-semibold">
                              {kw.keyword}
                            </span>
                            <span className="block truncate text-xs font-normal text-white/60">
                              {kw.location}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 text-center text-xs font-medium">
                            <button
                              type="button"
                              onClick={() => setRankSortBy(`${kw.id}__map`)}
                              className={`flex items-center justify-center gap-1 border-r border-white/10 py-1.5 transition ${
                                rankSortBy === `${kw.id}__map`
                                  ? 'bg-white/20 text-white'
                                  : 'text-white/70 hover:bg-white/10 hover:text-white/80'
                              }`}
                              title={`Sort by ${kw.keyword} map rank`}
                            >
                              <MapPin
                                className="h-3.5 w-3.5 shrink-0"
                                aria-hidden
                              />
                              Map
                            </button>
                            <button
                              type="button"
                              onClick={() => setRankSortBy(`${kw.id}__organic`)}
                              className={`py-1.5 transition ${
                                rankSortBy === `${kw.id}__organic`
                                  ? 'bg-white/20 text-white'
                                  : 'text-white/70 hover:bg-white/10 hover:text-white/80'
                              }`}
                              title={`Sort by ${kw.keyword} organic rank`}
                            >
                              Organic
                            </button>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDomains.map((d) => {
                      const threat = threatLevelByDomainId.get(d.id) ?? null
                      const borderClass =
                        threat === 'High'
                          ? 'border-l-4 border-l-red-500'
                          : threat === 'Medium'
                            ? 'border-l-4 border-l-blue-500'
                            : threat === 'Low'
                              ? 'border-l-4 border-l-green-500'
                              : threat === 'Paper Tiger'
                                ? 'border-l-4 border-l-amber-500'
                                : ''
                      return (
                        <tr
                          key={d.id}
                          className={`border-b border-white/10 text-white/90 ${borderClass}`}
                        >
                          <td className="sticky left-0 z-10 min-w-[140px] bg-black/40 p-2 font-medium sm:min-w-[180px] sm:p-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openDossier(d.id)}
                                className="flex items-center gap-1.5 text-left hover:underline"
                                title="Open competitor dossier"
                              >
                                <FileText className="h-4 w-4 shrink-0 text-white/50" />
                                {d.display_name || d.domain}
                                {d.is_my_domain && (
                                  <span className="ml-1 text-green-400">
                                    (you)
                                  </span>
                                )}
                              </button>
                              <BusinessModelBadge domainId={d.id} />
                            </div>
                          </td>
                          {filteredKeywords.flatMap((kw) => {
                            const key = `${kw.id}:${d.id}`
                            const organic = latestMap.get(key)
                            const mapRank = latestMapPack.get(key)
                            const previous = previousMap.get(key)
                            const movement =
                              organic != null && previous != null
                                ? previous - organic
                                : null
                            return [
                              <td
                                key={`${kw.id}-map`}
                                className="border-r border-l border-white/10 p-2 text-center sm:p-3"
                              >
                                {mapRank != null ? (
                                  <span className="inline-flex items-center gap-1 text-white/90">
                                    <MapPin
                                      className="h-3.5 w-3.5 shrink-0 text-white/60"
                                      aria-hidden
                                    />
                                    #{mapRank}
                                  </span>
                                ) : (
                                  <span className="text-white/50">–</span>
                                )}
                              </td>,
                              <td
                                key={`${kw.id}-organic`}
                                className="p-2 sm:p-3"
                              >
                                {organic != null ? (
                                  <span className="flex items-center gap-1">
                                    #{organic}
                                    {movement !== null &&
                                      movement !== 0 &&
                                      (movement > 0 ? (
                                        <ArrowUp
                                          className="h-4 w-4 shrink-0 text-green-500"
                                          aria-label="Improved"
                                        />
                                      ) : (
                                        <ArrowDown
                                          className="h-4 w-4 shrink-0 text-red-500"
                                          aria-label="Dropped"
                                        />
                                      ))}
                                    {movement === 0 && (
                                      <Minus
                                        className="h-4 w-4 shrink-0 text-white/50"
                                        aria-label="No change"
                                      />
                                    )}
                                  </span>
                                ) : (
                                  <span className="text-white/50">–</span>
                                )}
                              </td>,
                            ]
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-white/10 p-3 text-xs text-white/50">
                To refresh rankings: wait for the daily cron, or call GET
                /api/cron/track-serps with header Authorization: Bearer
                [CRON_SECRET]. Movement arrows compare to the previous scan.
              </p>
            </Card>
          ) : (
            <Card className="border-white/20 bg-black/40 p-4 backdrop-blur-sm">
              <h2 className="mb-2 text-lg font-semibold text-white">
                Step 3 – Rankings will appear here
              </h2>
              <p className="mb-3 text-white/70">
                Add at least one keyword (Step 1) and one domain (Step 2a or 2b)
                above. Then click “Refresh rankings” to run a scan now, or wait
                for the daily cron. After a scan runs, this section will show a
                table of positions and a chart for your domain.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-white/30 text-white/90"
                  onClick={() => setActiveSection('data')}
                >
                  Go to Data entry
                </Button>
                <Button
                  type="button"
                  onClick={handleRefreshRankings}
                  disabled={
                    refreshLoading ||
                    keywords.length === 0 ||
                    domains.length === 0
                  }
                  className="bg-green-600 hover:bg-green-700"
                >
                  {refreshLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <RefreshCw className="mr-1.5 h-4 w-4" />
                      Refresh rankings
                    </>
                  )}
                </Button>
              </div>
              {refreshMessage && (
                <p className="mt-2 text-sm text-green-400">{refreshMessage}</p>
              )}
            </Card>
          )}
        </div>
      )}

      {/* Dossier side panel */}
      {dossierDomainId && (
        <>
          <button
            type="button"
            aria-label="Close dossier"
            className="fixed inset-0 z-40 bg-black/60"
            onClick={closeDossier}
          />
          <div className="fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-l border-white/20 bg-black/95 shadow-xl backdrop-blur sm:max-w-lg">
            {dossierLoading ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-white">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span>Loading dossier…</span>
              </div>
            ) : dossierData ? (
              <>
                <div className="flex items-center justify-between border-b border-white/20 p-4">
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-semibold text-white">
                      {dossierData.domain.display_name ||
                        dossierData.domain.domain}
                    </h3>
                    <a
                      href={`https://${dossierData.domain.domain.replace(/^https?:\/\//, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 truncate text-sm text-green-400 hover:underline"
                    >
                      {dossierData.domain.domain}
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    </a>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-white/80 hover:bg-white/10 hover:text-white"
                    onClick={closeDossier}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
                <div className="flex-1 space-y-4 overflow-y-auto p-4">
                  {dossierForm && (
                    <>
                      <div>
                        <Label className="text-white/70">Threat level</Label>
                        {dossierEditMode ? (
                          <select
                            value={dossierForm.threat_level ?? ''}
                            onChange={(e) =>
                              setDossierForm((p) =>
                                p
                                  ? {
                                      ...p,
                                      threat_level: e.target.value || null,
                                    }
                                  : null,
                              )
                            }
                            className="mt-1 w-full rounded border border-white/20 bg-white/5 px-3 py-2 text-white"
                          >
                            <option value="">—</option>
                            <option value="High">High</option>
                            <option value="Medium">Medium</option>
                            <option value="Low">Low</option>
                            <option value="Paper Tiger">Paper Tiger</option>
                          </select>
                        ) : (
                          <p className="mt-1 text-white">
                            {dossierForm.threat_level ?? '—'}
                          </p>
                        )}
                      </div>
                      <div>
                        <Label className="text-white/70">Business model</Label>
                        {dossierEditMode ? (
                          <Input
                            value={dossierForm.business_model ?? ''}
                            onChange={(e) =>
                              setDossierForm((p) =>
                                p
                                  ? {
                                      ...p,
                                      business_model: e.target.value || null,
                                    }
                                  : null,
                              )
                            }
                            className="mt-1 border-white/20 bg-white/5 text-white"
                          />
                        ) : (
                          <p className="mt-1 text-white">
                            {dossierForm.business_model ?? '—'}
                          </p>
                        )}
                      </div>
                      <div>
                        <Label className="text-white/70">
                          Primary strength
                        </Label>
                        {dossierEditMode ? (
                          <textarea
                            value={dossierForm.primary_strength ?? ''}
                            onChange={(e) =>
                              setDossierForm((p) =>
                                p
                                  ? {
                                      ...p,
                                      primary_strength: e.target.value || null,
                                    }
                                  : null,
                              )
                            }
                            rows={3}
                            className="mt-1 w-full rounded border border-white/20 bg-white/5 px-3 py-2 text-white"
                          />
                        ) : (
                          <p className="mt-1 whitespace-pre-wrap text-white">
                            {dossierForm.primary_strength ?? '—'}
                          </p>
                        )}
                      </div>
                      <div>
                        <Label className="text-white/70">Core weakness</Label>
                        {dossierEditMode ? (
                          <textarea
                            value={dossierForm.core_weakness ?? ''}
                            onChange={(e) =>
                              setDossierForm((p) =>
                                p
                                  ? {
                                      ...p,
                                      core_weakness: e.target.value || null,
                                    }
                                  : null,
                              )
                            }
                            rows={3}
                            className="mt-1 w-full rounded border border-white/20 bg-white/5 px-3 py-2 text-white"
                          />
                        ) : (
                          <p className="mt-1 whitespace-pre-wrap text-white">
                            {dossierForm.core_weakness ?? '—'}
                          </p>
                        )}
                      </div>
                      <div>
                        <Label className="text-white/70">
                          Sasquatch counter-attack
                        </Label>
                        {dossierEditMode ? (
                          <textarea
                            value={dossierForm.sasquatch_counter_attack ?? ''}
                            onChange={(e) =>
                              setDossierForm((p) =>
                                p
                                  ? {
                                      ...p,
                                      sasquatch_counter_attack:
                                        e.target.value || null,
                                    }
                                  : null,
                              )
                            }
                            rows={3}
                            className="mt-1 w-full rounded border border-white/20 bg-white/5 px-3 py-2 text-white"
                          />
                        ) : (
                          <p className="mt-1 whitespace-pre-wrap text-white">
                            {dossierForm.sasquatch_counter_attack ?? '—'}
                          </p>
                        )}
                      </div>
                      <div>
                        <Label className="text-white/70">
                          Threat archetype
                        </Label>
                        {dossierEditMode ? (
                          <select
                            value={dossierForm.threat_archetype ?? ''}
                            onChange={(e) =>
                              setDossierForm((p) =>
                                p
                                  ? {
                                      ...p,
                                      threat_archetype: e.target.value || null,
                                    }
                                  : null,
                              )
                            }
                            className="mt-1 w-full rounded border border-white/20 bg-white/5 px-3 py-2 text-white"
                          >
                            <option value="">—</option>
                            <option value="Franchise Cartel">
                              Franchise Cartel
                            </option>
                            <option value="Legacy Heavyweight">
                              Legacy Heavyweight
                            </option>
                            <option value="Jack of All Trades">
                              Jack of All Trades
                            </option>
                            <option value="Niche Sniper">Niche Sniper</option>
                          </select>
                        ) : (
                          <p className="mt-1 text-white">
                            {dossierForm.threat_archetype ?? '—'}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
                <div className="flex gap-2 border-t border-white/20 p-4">
                  {dossierEditMode ? (
                    <>
                      <Button
                        type="button"
                        disabled={dossierSaving}
                        onClick={saveDossier}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        {dossierSaving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          'Save'
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="border-white/30 text-white/80"
                        onClick={() => {
                          setDossierEditMode(false)
                          setDossierForm(
                            dossierData.profile
                              ? { ...dossierData.profile }
                              : {
                                  threat_level: null,
                                  business_model: null,
                                  primary_strength: null,
                                  core_weakness: null,
                                  sasquatch_counter_attack: null,
                                  threat_archetype: null,
                                },
                          )
                        }}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-white/30 text-white/80"
                      onClick={() => setDossierEditMode(true)}
                    >
                      <Pencil className="mr-1.5 h-4 w-4" />
                      Edit
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-4 text-white/70">
                Failed to load dossier.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
