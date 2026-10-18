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
  /** Count of Maps results persisted for this exact scan run, never organic depth. */
  maps_checked_results?: number | null
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
          row.finder_rank != null
            ? ('ranked' as const)
            : (row.maps_checked_results ?? 0) >= 20
              ? ('outside' as const)
              : ('unknown' as const),
        depth: row.maps_checked_results ?? undefined,
      }))
    const last = points.at(-1)
    return {
      town: kw.location.split(',')[0].trim(),
      color: TOWN_COLORS[index % TOWN_COLORS.length],
      points,
      latestLabel: last
        ? `${last.rank != null ? `#${last.rank}` : last.status === 'outside' ? 'Outside top 20' : last.depth ? `Not returned in ${last.depth} checked Maps results` : 'Maps depth unavailable'} · ${last.date.slice(5)}`
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
  now = new Date(),
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
    const impressions = [...weeks.values()].reduce(
      (sum, week) => sum + week.impressions,
      0,
    )
    return {
      town,
      color: TOWN_COLORS[index % TOWN_COLORS.length],
      points,
      latestLabel: last
        ? `Avg ${last.rank?.toFixed(1)} · week of ${last.date.slice(5)}`
        : 'No reported impressions',
      coverageLabel: `${impressions} impression${impressions === 1 ? '' : 's'} · ${weeks.size} measured week${weeks.size === 1 ? '' : 's'}`,
    }
  })
  const max = Math.max(
    10,
    ...series.flatMap((s) => s.points.map((p) => p.rank ?? 0)),
  )
  return {
    title: 'GOOGLE ORGANIC AVERAGE POSITION',
    subtitle: '90 days · weekly, US desktop · town-named queries',
    maxRank: Math.ceil(max / 10) * 10,
    series,
    windowDays: 90,
    intervalDays: 7,
    // Weekly points identify their Monday bucket, including the first partial week.
    startDate: weekStart(
      new Date(now.getTime() - 89 * 86_400_000).toISOString().slice(0, 10),
    ),
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
