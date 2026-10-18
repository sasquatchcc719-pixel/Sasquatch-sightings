import type { OrganicAudit } from '@/lib/radar-organic-evidence'
import type {
  RankHistoryPanel,
  RankHistorySeries,
} from '@/lib/reports/rank-history-card'

export const TOWN_COLORS = [
  '#38bdf8',
  '#34d399',
  '#fbbf24',
  '#c084fc',
  '#fb7185',
]
export function mountainDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}
export type HistoryKeyword = { id: string; keyword: string; location: string }
export type HistoryRank = {
  keyword_id: string
  finder_rank?: number | null
  created_at: string
  scan_run_id?: string | null
}
export function buildMapsRankPanel(
  keywords: HistoryKeyword[],
  ranks: HistoryRank[],
  now = new Date(),
): RankHistoryPanel {
  const today = mountainDay(now.toISOString())
  const start = new Date(`${today}T12:00:00Z`)
  start.setUTCDate(start.getUTCDate() - 29)
  const startDay = start.toISOString().slice(0, 10)
  const series: RankHistorySeries[] = keywords.map((kw, index) => {
    const daily = new Map<string, HistoryRank>()
    for (const row of [...ranks].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    )) {
      const date = mountainDay(row.created_at)
      if (
        row.keyword_id === kw.id &&
        row.created_at >= '2026-08-10' &&
        date >= startDay &&
        date <= today &&
        !daily.has(date)
      )
        daily.set(date, row)
    }
    const points = [...daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, row]) => ({
        date,
        rank: row.finder_rank ?? null,
        status:
          row.finder_rank != null ? ('ranked' as const) : ('outside' as const),
        depth: 20,
      }))
    const last = points.at(-1)
    return {
      town: kw.location.split(',')[0].trim(),
      color: TOWN_COLORS[index % TOWN_COLORS.length],
      points,
      latestLabel: last
        ? `${last.rank == null ? 'Outside top 20' : `#${last.rank}`} · ${last.date.slice(5)}`
        : 'No scan',
    }
  })
  return {
    title: 'GOOGLE MAPS RANK',
    subtitle: 'Daily town-center readings · #1 is best · last 30 days',
    maxRank: 20,
    series,
  }
}
export type GscDailyRow = {
  date: string
  query: string
  impressions: number
  clicks: number
  position: number
}
export function weekStart(day: string): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}
export function buildGoogleOrganicPanel(
  keywords: HistoryKeyword[],
  rows: GscDailyRow[],
): RankHistoryPanel {
  const series: RankHistorySeries[] = keywords.map((kw, index) => {
    const town = kw.location.split(',')[0].trim()
    const escaped = town.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(
      `^carpet clean(?:ing|ers)(?: in)? ${escaped}(?: co| colorado)?$`,
    )
    const weeks = new Map<string, { weighted: number; impressions: number }>()
    for (const row of rows) {
      if (
        !match.test(row.query.toLowerCase()) ||
        row.impressions <= 0 ||
        row.position <= 0
      )
        continue
      const week = weekStart(row.date)
      const current = weeks.get(week) ?? { weighted: 0, impressions: 0 }
      current.weighted += row.position * row.impressions
      current.impressions += row.impressions
      weeks.set(week, current)
    }
    const points = [...weeks.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, week]) => ({
        date,
        rank: Math.round((week.weighted / week.impressions) * 10) / 10,
        status: 'ranked' as const,
      }))
    const last = points.at(-1)
    return {
      town,
      color: TOWN_COLORS[index % TOWN_COLORS.length],
      points,
      latestLabel: last
        ? `Avg ${last.rank?.toFixed(1)} · ${weeks.get(last.date)!.impressions} views · ${last.date.slice(5)}`
        : 'No reported impressions',
    }
  })
  const max = Math.max(
    10,
    ...series.flatMap((s) => s.points.map((p) => p.rank ?? 0)),
  )
  return {
    title: 'GOOGLE ORGANIC AVERAGE POSITION',
    subtitle: '90 days · weekly, US desktop · searches: carpet cleaning + town',
    maxRank: Math.ceil(max / 10) * 10,
    series,
    windowDays: 90,
    intervalDays: 7,
  }
}
export function sameOrganicMethod(
  a: OrganicAudit | null | undefined,
  b: OrganicAudit | null | undefined,
): boolean {
  return Boolean(
    a?.version === 2 &&
    b?.version === 2 &&
    a.method === b.method &&
    a.query === b.query,
  )
}
