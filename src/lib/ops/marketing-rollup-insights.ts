import type { MarketingWeeklyRollupRow } from '@/lib/ops/marketing-rollup'
import { ACTIVE_SERVICE_TOWN_SLUGS, townLabel } from '@/lib/geo/towns'

const BUSINESS_WIDE = 'business-wide'

export const ACTIVE_SERVICE_TOWNS = ACTIVE_SERVICE_TOWN_SLUGS.map((slug) => ({
  slug,
  name: townLabel(slug),
}))

const ACTIVE_SERVICE_TOWN_SET = new Set<string>(
  ACTIVE_SERVICE_TOWNS.map((town) => town.slug),
)

export type RollupSummary = {
  spend: number
  residentialJobs: number
  residentialRevenue: number
  commercialJobs: number
  commercialRevenue: number
  searchAppearances: number
  googleVisits: number
  quoteSessions: number
  reviewDelta: number | null
  gscDataThrough: string | null
}

export type BusinessInsight = {
  tone: 'positive' | 'attention' | 'context'
  title: string
  evidence: string
  meaning: string
  nextStep: string
}

export function isActiveServiceTown(slug: string): boolean {
  return ACTIVE_SERVICE_TOWN_SET.has(slug)
}

export function completedWeekStarts(
  rows: MarketingWeeklyRollupRow[],
  today: string,
): string[] {
  return [
    ...new Set(
      rows.filter((row) => row.week_end < today).map((row) => row.week_start),
    ),
  ].sort((a, b) => b.localeCompare(a))
}

export function scopedWeekRows(
  rows: MarketingWeeklyRollupRow[],
  weekStart: string | undefined,
  town: string,
): MarketingWeeklyRollupRow[] {
  if (!weekStart) return []
  return rows.filter(
    (row) =>
      row.week_start === weekStart &&
      (town === 'all'
        ? row.town_slug === BUSINESS_WIDE || isActiveServiceTown(row.town_slug)
        : row.town_slug === town),
  )
}

export function summarizeRollup(
  rows: MarketingWeeklyRollupRow[],
): RollupSummary {
  let reviewDelta: number | null = null
  let gscDataThrough: string | null = null
  const summary: RollupSummary = {
    spend: 0,
    residentialJobs: 0,
    residentialRevenue: 0,
    commercialJobs: 0,
    commercialRevenue: 0,
    searchAppearances: 0,
    googleVisits: 0,
    quoteSessions: 0,
    reviewDelta,
    gscDataThrough,
  }

  for (const row of rows) {
    summary.spend += row.spend
    summary.residentialJobs += row.residential_jobs
    summary.residentialRevenue += row.residential_revenue
    summary.commercialJobs += row.commercial_jobs
    summary.commercialRevenue += row.commercial_revenue
    summary.searchAppearances += row.gsc_impressions
    summary.googleVisits += row.gsc_clicks
    summary.quoteSessions += row.quote_sessions
    if (row.review_delta !== null)
      reviewDelta = (reviewDelta ?? 0) + row.review_delta
    if (
      row.gsc_data_through &&
      (!gscDataThrough || row.gsc_data_through > gscDataThrough)
    ) {
      gscDataThrough = row.gsc_data_through
    }
  }

  summary.reviewDelta = reviewDelta
  summary.gscDataThrough = gscDataThrough
  return summary
}

export function latestMapWeekRows(
  rows: MarketingWeeklyRollupRow[],
  town: string,
): MarketingWeeklyRollupRow[] {
  const candidates = rows.filter(
    (row) =>
      row.rank_points > 0 &&
      isActiveServiceTown(row.town_slug) &&
      (town === 'all' || row.town_slug === town),
  )
  const latest = candidates.reduce(
    (value, row) => (row.week_start > value ? row.week_start : value),
    '',
  )
  return candidates.filter((row) => row.week_start === latest)
}

export function mapVisibility(row: MarketingWeeklyRollupRow): {
  percent: number
  status: 'Strong' | 'Mixed' | 'Weak' | 'Not showing'
  typical: string
} {
  const percent = row.rank_points ? (row.rank_found / row.rank_points) * 100 : 0
  const status =
    percent >= 70
      ? 'Strong'
      : percent >= 30
        ? 'Mixed'
        : percent > 0
          ? 'Weak'
          : 'Not showing'
  const typical =
    row.rank_median === null || row.rank_median >= 21
      ? 'usually outside the first 20 results'
      : `typically around position ${Number(row.rank_median.toFixed(1))}`
  return { percent, status, typical }
}

function money(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function percentChange(current: number, previous: number): string | null {
  if (previous <= 0) return null
  const change = ((current - previous) / previous) * 100
  const direction = change >= 0 ? 'up' : 'down'
  return `${direction} ${Math.abs(change).toFixed(0)}% from the preceding week`
}

export function buildBusinessInsights(input: {
  current: RollupSummary
  previous: RollupSummary | null
  serviceRows: MarketingWeeklyRollupRow[]
  mapRows: MarketingWeeklyRollupRow[]
  allServiceAreas: boolean
}): BusinessInsight[] {
  const { current, previous, serviceRows, mapRows, allServiceAreas } = input
  const insights: BusinessInsight[] = []

  if (current.searchAppearances >= 50) {
    const clickRate = current.googleVisits / current.searchAppearances
    if (clickRate < 0.01) {
      insights.push({
        tone: 'attention',
        title: 'Google visibility is not turning into many website visits',
        evidence: `${current.searchAppearances.toLocaleString()} search appearances produced ${current.googleVisits.toLocaleString()} website visits (${(clickRate * 100).toFixed(1)}%).`,
        meaning:
          'People are seeing Sasquatch in Google results, but few are choosing the listing. That can point to weak page titles, descriptions, review appeal, or a mismatch with what they searched for.',
        nextStep:
          'Open the highest-impression pages and search phrases in Google Search Console. Improve the title and description on pages that are seen often but rarely clicked before buying more traffic.',
      })
    } else {
      insights.push({
        tone: 'positive',
        title: 'Google search is producing measurable website traffic',
        evidence: `${current.googleVisits.toLocaleString()} website visits came from ${current.searchAppearances.toLocaleString()} search appearances (${(clickRate * 100).toFixed(1)}%).`,
        meaning:
          'The site is being discovered and some searchers are choosing it. Page-level data is still needed to know which services and towns are responsible.',
        nextStep:
          'Protect the pages producing visits, then compare their search phrases and locations with completed work before expanding similar content.',
      })
    }
  }

  if (current.spend < 50) {
    insights.push({
      tone: 'context',
      title: 'The spending record is too incomplete for an ROI decision',
      evidence: `Only ${money(current.spend)} of campaign-linked cost is recorded for the week.`,
      meaning:
        'This is not total marketing spend. It only includes costs that were linked to campaigns in the system, so dividing all revenue by this number would be misleading.',
      nextStep:
        'Finish linking Google Ads, Local Services Ads, print, vendor, and other campaign costs before using this report to increase or cut a budget.',
    })
  }

  const weakMapRows = mapRows
    .filter((row) => mapVisibility(row).percent < 30)
    .sort((a, b) => mapVisibility(a).percent - mapVisibility(b).percent)
  if (weakMapRows.length) {
    const labels = weakMapRows.map((row) => {
      const label = ACTIVE_SERVICE_TOWNS.find(
        (town) => town.slug === row.town_slug,
      )?.name
      return `${label ?? row.town_slug} (${row.rank_found} of ${row.rank_points})`
    })
    insights.push({
      tone: 'attention',
      title: 'Google Maps visibility is weak in active service markets',
      evidence: `Sasquatch appeared in the first 20 Maps results at few or none of the sampled locations in ${labels.join(' and ')}.`,
      meaning:
        'This is a location-based visibility test—not service coverage or market share. A weak result means nearby searchers may not see Sasquatch when they search “carpet cleaning.”',
      nextStep:
        'First confirm the sampled locations match neighborhoods you actually want. If they do, prioritize legitimate Google Business Profile relevance, reviews, and the matching town/service pages.',
    })
  }

  if (allServiceAreas && serviceRows.length) {
    const leader = [...serviceRows].sort(
      (a, b) => b.residential_revenue - a.residential_revenue,
    )[0]
    if (leader?.residential_jobs) {
      const name =
        ACTIVE_SERVICE_TOWNS.find((town) => town.slug === leader.town_slug)
          ?.name ?? leader.town_slug
      insights.push({
        tone: 'positive',
        title: `${name} produced the most completed residential revenue`,
        evidence: `${leader.residential_jobs} completed residential jobs produced ${money(leader.residential_revenue)}.`,
        meaning:
          'This shows where completed work occurred. It does not prove that the week’s marketing caused those jobs.',
        nextStep:
          'Compare this pattern over several weeks, then look at lead sources and search demand before shifting budget toward or away from the market.',
      })
    }
  }

  const revenueChange = previous
    ? percentChange(current.residentialRevenue, previous.residentialRevenue)
    : null
  if (revenueChange) {
    insights.push({
      tone: 'context',
      title: `Completed residential revenue was ${revenueChange}`,
      evidence: `${money(current.residentialRevenue)} this week versus ${money(previous!.residentialRevenue)} in the preceding week.`,
      meaning:
        'A one-week change can be scheduling noise. Several weeks moving in the same direction is a stronger clue than one isolated jump or drop.',
      nextStep:
        'Watch the four-week direction and compare it with quote activity, search visits, seasonality, and available appointment capacity.',
    })
  }

  return insights.slice(0, 5)
}
