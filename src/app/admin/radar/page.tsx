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
} from 'lucide-react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
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

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export default function RadarPage() {
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [domains, setDomains] = useState<Domain[]>([])
  const [rankings, setRankings] = useState<Ranking[]>([])
  const [snapshots, setSnapshots] = useState<SerpSnapshotRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cutoffForChart] = useState(() => new Date(Date.now() - THIRTY_DAYS_MS))

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
  /** Sort table: 'best' = best rank first, 'domain' = A–Z, or keyword id for that keyword's rank */
  const [rankSortBy, setRankSortBy] = useState<string>('best')
  /** Filter table columns by keyword location; '' = show all */
  const [locationFilter, setLocationFilter] = useState<string>('')

  const loadData = useCallback(async () => {
    const supabase = createClient()
    const sixtyDaysAgo = new Date(Date.now() - SIXTY_DAYS_MS)
    const [kwRes, domRes, rankRes, snapRes] = await Promise.all([
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

  const myDomain = domains.find((d) => d.is_my_domain)
  const top3KeywordIds = myDomain
    ? keywords
        .map((k) => ({
          id: k.id,
          rank: latestMap.get(`${k.id}:${myDomain.id}`) ?? 100,
        }))
        .sort((a, b) => a.rank - b.rank)
        .slice(0, 3)
        .map((x) => x.id)
    : []

  const chartRankings = rankings.filter(
    (r) =>
      r.domain_id === myDomain?.id &&
      top3KeywordIds.includes(r.keyword_id) &&
      new Date(r.created_at) >= cutoffForChart,
  )
  const byDate = new Map<string, Record<string, number | string>>()
  for (const r of chartRankings) {
    const date = r.created_at.slice(0, 10)
    const kw =
      keywords.find((k) => k.id === r.keyword_id)?.keyword ?? r.keyword_id
    if (!byDate.has(date)) byDate.set(date, { date })
    const row = byDate.get(date)!
    if (row[kw] == null) row[kw] = r.rank_position
  }
  const chartData = Array.from(byDate.entries())
    .map(([, v]) => v)
    .sort((a, b) => (a.date < b.date ? -1 : 1))

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

  // Sorted domains for table: best rank first, or by keyword, or A–Z
  const sortedDomains = [...domains].sort((a, b) => {
    if (rankSortBy === 'domain') {
      return (a.display_name || a.domain).localeCompare(
        b.display_name || b.domain,
      )
    }
    if (rankSortBy === 'best') {
      const bestA = Math.min(
        ...keywords.map((k) => {
          const key = `${k.id}:${a.id}`
          const organic = latestMap.get(key) ?? 100
          const map = latestMapPack.get(key)
          return map != null ? Math.min(organic, map) : organic
        }),
      )
      const bestB = Math.min(
        ...keywords.map((k) => {
          const key = `${k.id}:${b.id}`
          const organic = latestMap.get(key) ?? 100
          const map = latestMapPack.get(key)
          return map != null ? Math.min(organic, map) : organic
        }),
      )
      return bestA - bestB
    }
    const keyA = `${rankSortBy}:${a.id}`
    const keyB = `${rankSortBy}:${b.id}`
    const organicA = latestMap.get(keyA) ?? 100
    const organicB = latestMap.get(keyB) ?? 100
    const mapA = latestMapPack.get(keyA)
    const mapB = latestMapPack.get(keyB)
    const rankA = mapA != null ? Math.min(organicA, mapA) : organicA
    const rankB = mapB != null ? Math.min(organicB, mapB) : organicB
    return rankA - rankB
  })

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center gap-2 text-white">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span>Loading Radar...</span>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        <Target className="h-8 w-8 text-green-400" />
        <h1 className="text-2xl font-bold text-white">
          Radar – Competitor SERP Tracking
        </h1>
      </div>

      {/* How to use */}
      <Card className="border-green-500/30 bg-black/40 p-4 backdrop-blur-sm">
        <h2 className="mb-2 text-lg font-semibold text-white">
          How to use Radar
        </h2>
        <p className="mb-3 rounded bg-amber-500/20 px-2 py-1.5 text-sm text-amber-200">
          <strong>Required setup:</strong> In Vercel (Project → Settings →
          Environment Variables), add{' '}
          <code className="rounded bg-black/30 px-1">SERPAPI_API_KEY</code> with
          your SerpApi key from serpapi.com. Without it, rankings will stay
          empty and refresh will report an error.
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
            competitor’s domain. Mark your own site with “This is my domain.”
          </li>
          <li>
            <strong className="text-white">Get rankings</strong> – Click
            “Refresh rankings” in Step 3 to run a scan now (checks Google for
            each keyword and saves positions). Or wait for the daily cron. The
            table and chart will then show positions and movement.
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
          Type the exact phrase you want to track (as someone would search on
          Google) and the location for local results. Click “Add keyword.” The
          cron job will periodically check where your domains rank for these
          phrases.
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
          <strong>Directions:</strong> Enter a keyword and location, then click
          “Discover domains.” We run a Google search and list the domains that
          appear in the results. Check the boxes next to the domains you want to
          track (e.g. competitors), then click “Add selected.” You can run this
          for different keywords to find more competitors. Domains already in
          your list are disabled.
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
              Who’s ranking #1–10 for this search. Check domains to add to your
              list, then click “Add selected.”
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
                      onCheckedChange={() => toggleDiscoverSelected(r.domain)}
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
          <strong>Directions:</strong> If you already know a competitor’s domain
          (e.g. premiercarpetcleaning.com), enter it here. Optionally add a
          display name for the table. Check “This is my domain” for
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

      {/* Domains list */}
      <Card className="border-white/20 bg-black/40 p-4 backdrop-blur-sm">
        <h2 className="mb-1 text-lg font-semibold text-white">
          Your domains ({domains.length})
        </h2>
        <p className="mb-3 text-sm text-white/60">
          All domains you’re tracking (yours and competitors). Use the trash
          icon to remove one.
        </p>
        {domains.length === 0 ? (
          <p className="text-sm text-white/60">
            No domains yet. Use “Discover competitors” (Step 2a) or “Add domain
            manually” (Step 2b) above.
          </p>
        ) : (
          <ul className="space-y-2">
            {domains.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between rounded bg-white/5 px-3 py-2 text-white/90"
              >
                <span>
                  {d.display_name || d.domain}
                  {d.is_my_domain && (
                    <span className="ml-2 text-green-400">(you)</span>
                  )}
                  {d.display_name && (
                    <span className="ml-2 text-white/50">{d.domain}</span>
                  )}
                </span>
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
            ))}
          </ul>
        )}
      </Card>

      {/* Rankings chart */}
      {hasData && chartData.length > 0 && top3KeywordIds.length > 0 && (
        <Card className="border-white/20 bg-black/40 p-4 backdrop-blur-sm">
          <h2 className="mb-1 text-lg font-semibold text-white">
            Rank history – Your domain (last 30 days)
          </h2>
          <p className="mb-4 text-sm text-white/60">
            Line chart for your site’s position over time for your top 3
            keywords. Lower position number = higher on Google. Data appears
            after the cron runs at least once.
          </p>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
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
                  domain={[1, 100]}
                  stroke="rgba(255,255,255,0.6)"
                  fontSize={12}
                />
                <Tooltip
                  contentStyle={{
                    background: '#1a1a1a',
                    border: '1px solid rgba(255,255,255,0.2)',
                  }}
                  labelStyle={{ color: '#e5e5e5' }}
                />
                <Legend />
                {top3KeywordIds.map((kid, i) => {
                  const kw = keywords.find((k) => k.id === kid)?.keyword ?? kid
                  const colors = ['#22c55e', '#3b82f6', '#a855f7']
                  return (
                    <Line
                      key={kid}
                      type="monotone"
                      dataKey={kw}
                      stroke={colors[i % 3]}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  )
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Who's actually ranking #1–10 (from SerpApi, not just our list) */}
      {keywords.length > 0 && snapshotByKeyword.size > 0 && (
        <Card className="border-white/20 bg-black/40 p-4 backdrop-blur-sm">
          <h2 className="mb-1 text-lg font-semibold text-white">
            Who’s ranking #1–10 (from latest scan)
          </h2>
          <p className="mb-4 text-sm text-white/60">
            Actual Google order from the last refresh. When Google shows a local
            pack we also pull star rating, review count, and address
            (town/area). Add any domain to &quot;Your domains&quot; to track in
            the table below.
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
                  shown under keyword). Use Location to show only one area; use
                  Sort by to order rows. Green up = improved; red down =
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
              <label htmlFor="radar-location" className="text-sm text-white/70">
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
            <div className="flex items-center gap-2">
              <label htmlFor="radar-sort" className="text-sm text-white/70">
                Sort by:
              </label>
              <select
                id="radar-sort"
                value={rankSortBy}
                onChange={(e) => setRankSortBy(e.target.value)}
                className="rounded border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white focus:border-green-500 focus:outline-none"
              >
                <option value="best">Best rank (who’s #1 first)</option>
                <option value="domain">Company name (A–Z)</option>
                {keywords.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.keyword} ({k.location})
                  </option>
                ))}
              </select>
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
                      <div className="grid grid-cols-2 text-center text-xs font-medium text-white/70">
                        <span className="flex items-center justify-center gap-1 border-r border-white/10 py-1.5">
                          <MapPin
                            className="h-3.5 w-3.5 shrink-0"
                            aria-hidden
                          />
                          Map
                        </span>
                        <span className="py-1.5">Organic</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedDomains.map((d) => (
                  <tr
                    key={d.id}
                    className="border-b border-white/10 text-white/90"
                  >
                    <td className="sticky left-0 z-10 min-w-[140px] bg-black/40 p-2 font-medium sm:min-w-[180px] sm:p-3">
                      {d.display_name || d.domain}
                      {d.is_my_domain && (
                        <span className="ml-1 text-green-400">(you)</span>
                      )}
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
                        <td key={`${kw.id}-organic`} className="p-2 sm:p-3">
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
                ))}
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
            above. Then click “Refresh rankings” to run a scan now, or wait for
            the daily cron. After a scan runs, this section will show a table of
            positions and a chart for your domain.
          </p>
          <Button
            type="button"
            onClick={handleRefreshRankings}
            disabled={
              refreshLoading || keywords.length === 0 || domains.length === 0
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
          {refreshMessage && (
            <p className="mt-2 text-sm text-green-400">{refreshMessage}</p>
          )}
        </Card>
      )}
    </div>
  )
}
