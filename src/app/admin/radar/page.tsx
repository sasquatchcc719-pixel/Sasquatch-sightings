'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/supabase/client'
import { Card } from '@/components/ui/card'
import { ArrowUp, ArrowDown, Minus, Target, Loader2 } from 'lucide-react'
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
  created_at: string
}

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export default function RadarPage() {
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [domains, setDomains] = useState<Domain[]>([])
  const [rankings, setRankings] = useState<Ranking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cutoffForChart] = useState(() => new Date(Date.now() - THIRTY_DAYS_MS))

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const sixtyDaysAgo = new Date(Date.now() - SIXTY_DAYS_MS)
      const [kwRes, domRes, rankRes] = await Promise.all([
        supabase
          .from('radar_keywords')
          .select('id, keyword, location')
          .eq('active', true),
        supabase
          .from('radar_domains')
          .select('id, domain, display_name, is_my_domain'),
        supabase
          .from('radar_rankings')
          .select('id, keyword_id, domain_id, rank_position, created_at')
          .gte('created_at', sixtyDaysAgo.toISOString())
          .order('created_at', { ascending: false }),
      ])
      if (kwRes.error) setError(kwRes.error.message)
      else setKeywords(kwRes.data ?? [])
      if (domRes.error) setError(domRes.error.message)
      else setDomains(domRes.data ?? [])
      if (rankRes.error) setError(rankRes.error.message)
      else setRankings(rankRes.data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  const latestMap = new Map<string, number>()
  const previousMap = new Map<string, number>()
  for (const r of rankings) {
    const key = `${r.keyword_id}:${r.domain_id}`
    if (!latestMap.has(key)) latestMap.set(key, r.rank_position)
    else if (!previousMap.has(key)) previousMap.set(key, r.rank_position)
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

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center gap-2 text-white">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span>Loading Radar...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-red-200">
        Error: {error}. Run the radar migration SQL and add keywords/domains.
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

      {chartData.length > 0 && top3KeywordIds.length > 0 && (
        <Card className="border-white/20 bg-black/40 p-4 backdrop-blur-sm">
          <h2 className="mb-4 text-lg font-semibold text-white">
            sasquatchcarpet.com – Rank history (last 30 days, top 3 keywords)
          </h2>
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

      <Card className="overflow-hidden border-white/20 bg-black/40 backdrop-blur-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/20 text-white/80">
                <th className="p-3 font-semibold">Keyword</th>
                {domains.map((d) => (
                  <th key={d.id} className="p-3 font-semibold">
                    {d.display_name || d.domain}
                    {d.is_my_domain && (
                      <span className="ml-1 text-green-400">(you)</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keywords.map((kw) => (
                <tr
                  key={kw.id}
                  className="border-b border-white/10 text-white/90"
                >
                  <td className="p-3">{kw.keyword}</td>
                  {domains.map((d) => {
                    const key = `${kw.id}:${d.id}`
                    const latest = latestMap.get(key)
                    const previous = previousMap.get(key)
                    const movement =
                      latest != null && previous != null
                        ? previous - latest
                        : null
                    return (
                      <td key={d.id} className="p-3">
                        {latest != null ? (
                          <span className="flex items-center gap-1">
                            #{latest}
                            {movement !== null &&
                              movement !== 0 &&
                              (movement > 0 ? (
                                <ArrowUp
                                  className="h-4 w-4 text-green-500"
                                  aria-label="Improved"
                                />
                              ) : (
                                <ArrowDown
                                  className="h-4 w-4 text-red-500"
                                  aria-label="Dropped"
                                />
                              ))}
                            {movement === 0 && (
                              <Minus
                                className="h-4 w-4 text-white/50"
                                aria-label="No change"
                              />
                            )}
                          </span>
                        ) : (
                          <span className="text-white/50">–</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {(keywords.length === 0 || domains.length === 0) && (
        <p className="text-white/70">
          Add keywords and domains in Supabase (radar_keywords, radar_domains),
          then run the track-serps cron or call{' '}
          <code className="rounded bg-white/10 px-1">
            /api/cron/track-serps
          </code>{' '}
          with CRON_SECRET.
        </p>
      )}
    </div>
  )
}
