/**
 * Turns the weekly GSC snapshots into something readable by someone who does
 * not do SEO for a living.
 *
 * The old digest printed four numbers with "WoW"/"MoM" percentages and threw
 * away the eight weeks of history sitting in gsc_ranking_snapshots. This module
 * keeps the history, states the direction in words, and leads with the one
 * sentence that explains what changed — then hands the same analysis to both
 * the Telegram text and the report-card image so they can never disagree.
 *
 * Everything here is pure: snapshots in, strings out. No Supabase, no network.
 */

import type { ReportCardInput, ReportCardTone } from '@/lib/reports/report-card'

/** Below this, a 28-day window is too thin for a percentage to mean anything. */
const MIN_IMPRESSIONS_TO_TREND = 25
/** A keyword needs at least this many views before we trust its position. */
const MIN_KEYWORD_IMPRESSIONS_TO_TREND = 3
/** Google's first page. */
const PAGE_ONE_CUTOFF = 10
/** Rank moves smaller than this are noise on a 28-day average. */
const RANK_MOVE_THRESHOLD = 1
/** Keyword rank moves smaller than this are noise. */
const KEYWORD_MOVE_THRESHOLD = 3
/** Click changes below both of these are not worth calling a trend. */
const CLICK_MOVE_MIN_ABSOLUTE = 5
const CLICK_MOVE_MIN_RATIO = 0.15
/** Impression changes below this ratio are flat. */
const IMPRESSION_MOVE_MIN_RATIO = 0.1

const WEEK_MS = 7 * 86_400_000
const MOM_TARGET_DAYS = 28
const MOM_TOLERANCE_DAYS = 6

export type SiteSnapshot = {
  clicks: number
  impressions: number
  ctr: number
  avg_position: number | null
  checked_at: string
}

export type KeywordSnapshot = {
  keyword: string
  page: string | null
  clicks: number
  impressions: number
  avg_position: number | null
  checked_at: string
}

export type SiteCurrent = {
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export type KeywordCurrent = {
  keyword: string
  page: string
  clicks: number
  impressions: number
  position: number
}

export type KeywordVerdict = {
  keyword: string
  marker: string
  headline: string
  detail: string | null
  tone: ReportCardTone
  /** Sort weight: surface page-one wins and real losses above flat terms. */
  priority: number
}

export type SiteReport = {
  label: string
  hasEnoughData: boolean
  verdict: { text: string; tone: ReportCardTone }
  explanation: string | null
  lines: string[]
  clickSeries: Array<{ label: string; value: number }>
  metrics: ReportCardInput['metrics']
}

// ─────────────────────────────── formatting ───────────────────────────────

export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

export function formatRank(value: number): string {
  return value.toFixed(1)
}

/**
 * Keyword positions are a 28-day average over a handful of impressions, so a
 * decimal implies precision that isn't there. Whole numbers only.
 */
export function formatKeywordRank(value: number): string {
  return `#${Math.round(value)}`
}

export function formatRate(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

/** "Aug 24" in the shop's own timezone, so the label matches Charles's week. */
export function formatShortDate(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Denver',
  })
}

function weeksAgo(iso: string, now: Date): number {
  return Math.max(1, Math.round((now.getTime() - Date.parse(iso)) / WEEK_MS))
}

function describeWeeksAgo(weeks: number): string {
  if (weeks <= 1) return 'last week'
  // "2.4% 4 weeks ago" collides two numbers; "a month ago" reads cleanly.
  if (weeks === 4) return 'a month ago'
  return `${weeks} weeks ago`
}

/**
 * Position is stored as NULL (or historically 0) when the keyword had no
 * impressions. Google positions start at 1, so 0 can only ever mean "no data".
 */
function positionOf(row: { avg_position: number | null }): number | null {
  const value = row.avg_position
  if (value == null || value <= 0) return null
  return value
}

// ─────────────────────────────── comparisons ───────────────────────────────

/** Snapshots are newest-first, so the most recent prior row is last week. */
function lastWeekRow<T extends { checked_at: string }>(rows: T[]): T | null {
  return rows[0] ?? null
}

/** The prior snapshot closest to four weeks back, for a month-scale compare. */
function monthAgoRow<T extends { checked_at: string }>(
  rows: T[],
  now: Date,
): T | null {
  let best: T | null = null
  let bestDiff = Infinity
  for (const row of rows) {
    const ageDays = (now.getTime() - Date.parse(row.checked_at)) / 86_400_000
    const diff = Math.abs(ageDays - MOM_TARGET_DAYS)
    if (diff < bestDiff && ageDays >= MOM_TARGET_DAYS - MOM_TOLERANCE_DAYS) {
      best = row
      bestDiff = diff
    }
  }
  return best
}

type Direction = 'up' | 'down' | 'flat'

function countDirection(current: number, prior: number): Direction {
  const change = current - prior
  const ratio = prior === 0 ? (current === 0 ? 0 : 1) : Math.abs(change) / prior
  if (
    Math.abs(change) < CLICK_MOVE_MIN_ABSOLUTE &&
    ratio < CLICK_MOVE_MIN_RATIO
  ) {
    return 'flat'
  }
  return change > 0 ? 'up' : 'down'
}

function ratioDirection(
  current: number,
  prior: number,
  threshold: number,
): Direction {
  if (prior === 0) return current === 0 ? 'flat' : 'up'
  const change = (current - prior) / prior
  if (Math.abs(change) < threshold) return 'flat'
  return change > 0 ? 'up' : 'down'
}

/** Lower positions are better, so "up" here means moved toward #1. */
function rankDirection(current: number, prior: number): Direction {
  const improvement = prior - current
  if (Math.abs(improvement) < RANK_MOVE_THRESHOLD) return 'flat'
  return improvement > 0 ? 'up' : 'down'
}

/** How many consecutive weeks the newest values have fallen. */
export function decliningStreak(series: number[]): number {
  let streak = 0
  for (let i = series.length - 1; i > 0; i -= 1) {
    if (series[i] < series[i - 1]) streak += 1
    else break
  }
  return streak
}

/** How many consecutive weeks the newest values have risen. */
export function risingStreak(series: number[]): number {
  let streak = 0
  for (let i = series.length - 1; i > 0; i -= 1) {
    if (series[i] > series[i - 1]) streak += 1
    else break
  }
  return streak
}

/**
 * Whether `current` beats every value in `history`, and across how many weeks.
 * Returns null when there is no history to beat.
 */
function recordRun(
  current: number,
  history: number[],
  better: (a: number, b: number) => boolean,
): number | null {
  if (history.length === 0) return null
  if (!history.every((value) => better(current, value))) return null
  return history.length + 1
}

// ───────────────────────────── site analysis ─────────────────────────────

function describeCountChange(
  current: number,
  prior: number,
  whenLabel: string,
  unit: { more: string; fewer: string },
): string {
  const change = current - prior
  if (change === 0) return `Same as ${whenLabel} (${formatCount(prior)}).`
  const word = change > 0 ? unit.more : unit.fewer
  return `${formatCount(Math.abs(change))} ${word} than ${whenLabel} (${formatCount(prior)}).`
}

export function buildSiteReport(params: {
  label: string
  current: SiteCurrent
  history: SiteSnapshot[]
  now: Date
}): SiteReport {
  const { label, current, history, now } = params
  const lastWeek = lastWeekRow(history)
  const monthAgo = monthAgoRow(history, now)

  // Oldest-first click series, current run appended, capped for display width.
  const clickSeries = [...history]
    .reverse()
    .map((row) => ({
      label: formatShortDate(row.checked_at),
      value: row.clicks,
    }))
    .concat([{ label: formatShortDate(now), value: current.clicks }])
    .slice(-9)

  if (current.impressions < MIN_IMPRESSIONS_TO_TREND) {
    return {
      label,
      hasEnoughData: false,
      verdict: {
        text: `Only ${formatCount(current.impressions)} ${current.impressions === 1 ? 'view' : 'views'} — too little data to trend.`,
        tone: 'neutral',
      },
      explanation: null,
      lines: [
        `${formatCount(current.impressions)} ${current.impressions === 1 ? 'view' : 'views'}, ${formatCount(current.clicks)} ${current.clicks === 1 ? 'click' : 'clicks'}.`,
        'Too little search traffic to read a trend yet.',
      ],
      clickSeries,
      metrics: [],
    }
  }

  const clickTrend = lastWeek
    ? countDirection(current.clicks, lastWeek.clicks)
    : 'flat'
  const impressionTrend = lastWeek
    ? ratioDirection(
        current.impressions,
        lastWeek.impressions,
        IMPRESSION_MOVE_MIN_RATIO,
      )
    : 'flat'
  const lastWeekPosition = lastWeek ? positionOf(lastWeek) : null
  const rankTrend =
    lastWeekPosition != null
      ? rankDirection(current.position, lastWeekPosition)
      : 'flat'

  const clickHistory = history.map((row) => row.clicks)
  const clickStreakDown = decliningStreak([
    ...clickHistory.slice().reverse(),
    current.clicks,
  ])
  const clickStreakUp = risingStreak([
    ...clickHistory.slice().reverse(),
    current.clicks,
  ])

  const impressionRecord = recordRun(
    current.impressions,
    history.map((row) => row.impressions),
    (a, b) => a > b,
  )
  const rankRecord = recordRun(
    current.position,
    history
      .map((row) => positionOf(row))
      .filter((value): value is number => value != null),
    (a, b) => a < b,
  )

  // ── Lines ──
  const lines: string[] = []

  const clickLine = [`Visits from Google: ${formatCount(current.clicks)}`]
  if (lastWeek) {
    clickLine.push(
      `  ${describeCountChange(current.clicks, lastWeek.clicks, 'last week', { more: 'more', fewer: 'fewer' })}`,
    )
  }
  if (monthAgo) {
    clickLine.push(
      `  ${describeCountChange(current.clicks, monthAgo.clicks, describeWeeksAgo(weeksAgo(monthAgo.checked_at, now)), { more: 'more', fewer: 'fewer' })}`,
    )
  }
  if (clickStreakDown >= 2) {
    clickLine.push(`  Down ${clickStreakDown} weeks in a row.`)
  } else if (clickStreakUp >= 2) {
    clickLine.push(`  Up ${clickStreakUp} weeks in a row.`)
  }
  lines.push(...clickLine, '')

  const impressionLine = [
    `Times we showed up: ${formatCount(current.impressions)}`,
  ]
  if (lastWeek) {
    impressionLine.push(
      `  ${describeCountChange(current.impressions, lastWeek.impressions, 'last week', { more: 'more', fewer: 'fewer' })}`,
    )
  }
  if (impressionRecord) {
    impressionLine.push(`  Highest in ${impressionRecord} weeks.`)
  }
  lines.push(...impressionLine, '')

  const rateLine = [`Click rate: ${formatRate(current.ctr)}`]
  const rateParts: string[] = []
  if (lastWeek) rateParts.push(`${formatRate(lastWeek.ctr)} last week`)
  if (monthAgo) {
    rateParts.push(
      `${formatRate(monthAgo.ctr)} ${describeWeeksAgo(weeksAgo(monthAgo.checked_at, now))}`,
    )
  }
  if (rateParts.length > 0) {
    rateLine.push(`  Was ${rateParts.join(', ')}.`)
  }
  rateLine.push(`  That is how many people clicked after seeing us.`)
  lines.push(...rateLine, '')

  const rankLine = [
    `Average rank: ${formatRank(current.position)} (lower is better)`,
  ]
  const rankParts: string[] = []
  if (lastWeekPosition != null) {
    rankParts.push(`${formatRank(lastWeekPosition)} last week`)
  }
  const monthAgoPosition = monthAgo ? positionOf(monthAgo) : null
  if (monthAgoPosition != null && monthAgo) {
    rankParts.push(
      `${formatRank(monthAgoPosition)} ${describeWeeksAgo(weeksAgo(monthAgo.checked_at, now))}`,
    )
  }
  if (rankRecord) rankLine.push(`  Best in ${rankRecord} weeks.`)
  if (rankParts.length > 0) rankLine.push(`  Was ${rankParts.join(', ')}.`)
  lines.push(...rankLine)

  // ── Verdict ──
  const verdict = pickVerdict({
    clickTrend,
    impressionTrend,
    rankTrend,
    clickStreakDown,
    clickStreakUp,
  })

  // ── Metric tiles for the image ──
  const metrics: ReportCardInput['metrics'] = [
    {
      label: 'Visits from Google',
      value: formatCount(current.clicks),
      note: lastWeek
        ? describeCountChange(current.clicks, lastWeek.clicks, 'last week', {
            more: 'more',
            fewer: 'fewer',
          })
        : undefined,
      tone:
        clickTrend === 'down'
          ? 'bad'
          : clickTrend === 'up'
            ? 'good'
            : 'neutral',
    },
    {
      label: 'Times we showed up',
      value: formatCount(current.impressions),
      note: impressionRecord
        ? `Highest in ${impressionRecord} weeks`
        : lastWeek
          ? describeCountChange(
              current.impressions,
              lastWeek.impressions,
              'last week',
              { more: 'more', fewer: 'fewer' },
            )
          : undefined,
      // A record high is good news even when the week-on-week move is flat.
      tone: impressionRecord
        ? 'good'
        : impressionTrend === 'up'
          ? 'good'
          : impressionTrend === 'down'
            ? 'bad'
            : 'neutral',
    },
    {
      label: 'Click rate',
      value: formatRate(current.ctr),
      note: lastWeek ? `Was ${formatRate(lastWeek.ctr)} last week` : undefined,
      tone:
        lastWeek && current.ctr < lastWeek.ctr
          ? 'bad'
          : lastWeek && current.ctr > lastWeek.ctr
            ? 'good'
            : 'neutral',
    },
    {
      label: 'Average rank',
      value: `#${formatRank(current.position)}`,
      note: rankRecord
        ? `Best in ${rankRecord} weeks`
        : lastWeekPosition != null
          ? `Was #${formatRank(lastWeekPosition)} last week`
          : undefined,
      tone: rankRecord
        ? 'good'
        : rankTrend === 'up'
          ? 'good'
          : rankTrend === 'down'
            ? 'bad'
            : 'neutral',
    },
  ]

  return {
    label,
    hasEnoughData: true,
    verdict: { text: verdict.text, tone: verdict.tone },
    explanation: verdict.explanation,
    lines,
    clickSeries,
    metrics,
  }
}

/**
 * The single sentence at the top. Ordered most-actionable first: a click drop
 * while visibility holds is a very different problem from losing visibility.
 */
function pickVerdict(input: {
  clickTrend: Direction
  impressionTrend: Direction
  rankTrend: Direction
  clickStreakDown: number
  clickStreakUp: number
}): { text: string; tone: ReportCardTone; explanation: string | null } {
  const { clickTrend, impressionTrend, rankTrend, clickStreakUp } = input

  if (
    clickTrend === 'down' &&
    impressionTrend !== 'down' &&
    rankTrend !== 'down'
  ) {
    return {
      text: 'More people are seeing us. Fewer are clicking.',
      tone: 'warn',
      explanation:
        'Rank and visibility are holding or improving, so this is most likely the ' +
        'title and description Google shows for us, or new competition in the ' +
        'results — not a ranking problem.',
    }
  }

  if (clickTrend === 'down' && rankTrend === 'down') {
    return {
      text: 'We are slipping in the rankings.',
      tone: 'bad',
      explanation:
        'Both clicks and average rank got worse. Competitors are likely moving ' +
        'above us on our main terms.',
    }
  }

  if (clickTrend === 'down' && impressionTrend === 'down') {
    return {
      text: 'Fewer people are seeing us at all.',
      tone: 'bad',
      explanation:
        'Visibility dropped along with clicks. Worth checking for lost pages, ' +
        'indexing problems, or a seasonal dip in searches.',
    }
  }

  if (clickTrend === 'up' && rankTrend === 'up') {
    return {
      text: 'Rankings and clicks are both up.',
      tone: 'good',
      explanation:
        clickStreakUp >= 2
          ? `Clicks have risen ${clickStreakUp} weeks running. The SEO work is landing.`
          : 'The SEO work is landing.',
    }
  }

  if (clickTrend === 'up') {
    return {
      text: 'More clicks than last week.',
      tone: 'good',
      explanation:
        'Clicks improved without a rank change, which usually means better ' +
        'titles, better matching, or more searches happening.',
    }
  }

  if (rankTrend === 'up') {
    return {
      text: 'Rank improved. Clicks held steady.',
      tone: 'good',
      explanation: null,
    }
  }

  return {
    text: 'Roughly flat week.',
    tone: 'neutral',
    explanation: null,
  }
}

// ─────────────────────────── keyword analysis ───────────────────────────

export function classifyKeyword(params: {
  keyword: string
  current: KeywordCurrent | null
  history: KeywordSnapshot[]
}): KeywordVerdict {
  const { keyword, current, history } = params
  const ranked = history.filter((row) => positionOf(row) != null)
  const lastRanked = ranked[0] ?? null

  if (!current || current.impressions === 0) {
    if (lastRanked) {
      const priorPosition = positionOf(lastRanked)
      return {
        keyword,
        marker: '❔',
        headline: 'no views this week',
        detail:
          priorPosition != null
            ? `last seen at ${formatKeywordRank(priorPosition)}`
            : null,
        tone: 'neutral',
        priority: 3,
      }
    }
    return {
      keyword,
      marker: '❔',
      headline: 'no views yet',
      detail: null,
      tone: 'neutral',
      priority: 5,
    }
  }

  const onPageOne = current.position <= PAGE_ONE_CUTOFF

  // Compare against the oldest snapshot we have, which is the real "since we
  // started tracking" movement rather than one noisy week.
  const oldestRanked = ranked[ranked.length - 1] ?? null
  const oldestPosition = oldestRanked ? positionOf(oldestRanked) : null
  const movement =
    oldestPosition != null ? oldestPosition - current.position : null

  const pageChanged =
    lastRanked?.page != null &&
    current.page !== '' &&
    lastRanked.page !== current.page

  const details: string[] = []
  if (
    movement != null &&
    Math.abs(movement) >= KEYWORD_MOVE_THRESHOLD &&
    oldestRanked
  ) {
    const word = movement > 0 ? 'up' : 'down'
    details.push(
      `${word} ${Math.round(Math.abs(movement))} spots since ${formatShortDate(oldestRanked.checked_at)}`,
    )
  } else if (movement != null) {
    details.push(`flat since ${formatShortDate(oldestRanked!.checked_at)}`)
  }
  if (current.impressions < MIN_KEYWORD_IMPRESSIONS_TO_TREND) {
    details.push(`only ${current.impressions} views`)
  }
  if (pageChanged) details.push('ranking page changed')

  const headline = `${formatKeywordRank(current.position)}${onPageOne ? ' · page 1' : ''}`

  if (onPageOne) {
    return {
      keyword,
      marker: '✅',
      headline,
      detail: details.join(' · ') || null,
      tone: 'good',
      priority: 0,
    }
  }
  if (movement != null && movement <= -KEYWORD_MOVE_THRESHOLD) {
    return {
      keyword,
      marker: '🔻',
      headline,
      detail: details.join(' · ') || null,
      tone: 'bad',
      priority: 1,
    }
  }
  if (movement != null && movement >= KEYWORD_MOVE_THRESHOLD) {
    return {
      keyword,
      marker: '✅',
      headline,
      detail: details.join(' · ') || null,
      tone: 'good',
      priority: 2,
    }
  }
  return {
    keyword,
    marker: '➖',
    headline,
    detail: details.join(' · ') || null,
    tone: 'neutral',
    priority: 4,
  }
}

// ──────────────────────────── report assembly ────────────────────────────

export type GscReport = {
  /** The long-form Telegram message. */
  text: string
  /** Short caption that rides along with the report-card image. */
  caption: string
  /** Everything the image renderer needs. */
  card: ReportCardInput
}

export function buildGscReport(params: {
  now: Date
  dataThrough: Date
  windowDays: number
  main: { current: SiteCurrent; history: SiteSnapshot[] }
  secondary: {
    label: string
    current: SiteCurrent
    history: SiteSnapshot[]
  }
  keywords: KeywordVerdict[]
  keywordClicks: number
  /** Linked at the bottom of the text report when a dashboard page exists. */
  dashboardUrl?: string
  /** Shown in the image footer when there is no dashboard to link yet. */
  footerNote?: string
}): GscReport {
  const {
    now,
    dataThrough,
    windowDays,
    main,
    secondary,
    keywords,
    keywordClicks,
    dashboardUrl,
    footerNote,
  } = params

  const mainReport = buildSiteReport({
    label: 'Main site',
    current: main.current,
    history: main.history,
    now,
  })
  const secondaryReport = buildSiteReport({
    label: secondary.label,
    current: secondary.current,
    history: secondary.history,
    now,
  })

  const toneMarker: Record<ReportCardTone, string> = {
    good: '✅',
    warn: '⚠️',
    bad: '🚨',
    neutral: 'ℹ️',
  }

  const header = [
    `GOOGLE SEARCH · week of ${formatShortDate(now)}`,
    `Last ${windowDays} days, data through ${formatShortDate(dataThrough)}`,
    '',
    `${toneMarker[mainReport.verdict.tone]} ${mainReport.verdict.text}`,
    '',
  ]

  const body = [...mainReport.lines]

  if (mainReport.explanation) {
    body.push('', 'What this means:', mainReport.explanation)
  }

  const sortedKeywords = [...keywords].sort(
    (a, b) => a.priority - b.priority || a.keyword.localeCompare(b.keyword),
  )
  const keywordSection = [
    '',
    `KEYWORDS WE TRACK (${keywords.length})`,
    keywordClicks === 0
      ? 'None of them brought a single click this window.'
      : `${formatCount(keywordClicks)} ${keywordClicks === 1 ? 'click' : 'clicks'} from tracked keywords.`,
  ]
  for (const verdict of sortedKeywords) {
    keywordSection.push(
      `${verdict.marker} ${verdict.keyword} — ${verdict.headline}`,
    )
    if (verdict.detail) keywordSection.push(`   ${verdict.detail}`)
  }

  const secondarySection = [
    '',
    `${secondaryReport.label}:`,
    ...secondaryReport.lines.map((line) => line.trim()).filter(Boolean),
  ]

  const footer = dashboardUrl ? ['', `Full history → ${dashboardUrl}`] : []

  const text = [
    ...header,
    ...body,
    ...keywordSection,
    ...secondarySection,
    ...footer,
  ].join('\n')

  const topKeyword = sortedKeywords[0]
  const caption = [
    `${toneMarker[mainReport.verdict.tone]} ${mainReport.verdict.text}`,
    `${formatCount(main.current.clicks)} visits · ${formatCount(main.current.impressions)} views · rank #${formatRank(main.current.position)}`,
    topKeyword
      ? `Biggest keyword move: ${topKeyword.keyword} — ${topKeyword.headline}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 1024)

  const card: ReportCardInput = {
    eyebrow: 'Google Search',
    title: `Week of ${formatShortDate(now)}`,
    subtitle: `Last ${windowDays} days · data through ${formatShortDate(dataThrough)}`,
    verdict: mainReport.verdict,
    metrics: mainReport.metrics,
    series: {
      label: 'Visits from Google, by week',
      points: mainReport.clickSeries,
    },
    footer: dashboardUrl ?? footerNote ?? null,
  }

  return { text, caption, card }
}
