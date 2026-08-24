/**
 * Render the weekly Google Search report from the stored snapshot history and
 * write it to disk, so the wording and the card design can be checked without
 * waiting for Monday's cron or sending anything to Telegram.
 *
 *   npx tsx scripts/preview-gsc-report.ts
 *
 * Writes /tmp/gsc-report-card.png and prints the Telegram text to stdout.
 * Reads only — never posts, never inserts a snapshot.
 */
import { config as loadEnv } from 'dotenv'
import { writeFile } from 'node:fs/promises'

loadEnv({ path: '.env.local' })

const OUT_PATH = '/tmp/gsc-report-card.png'

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { buildGscReport, classifyKeyword } =
    await import('../src/lib/gsc-ranking-report')
  const { renderReportCardPng } = await import('../src/lib/reports/report-card')
  const { fetchWatchlistKeywords } = await import('../src/lib/gsc-watchlist')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error(
      'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local',
    )
    process.exit(1)
  }
  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const WWW = 'https://www.sasquatchcarpet.com/'
  const SIGHTINGS = 'https://sightings.sasquatchcarpet.com/'

  const siteHistory = async (property: string) => {
    const { data } = await supabase
      .from('gsc_ranking_snapshots')
      .select('clicks, impressions, ctr, avg_position, checked_at')
      .eq('property', property)
      .order('checked_at', { ascending: false })
      .limit(12)
    return data || []
  }

  const [wwwRows, sightingsRows] = await Promise.all([
    siteHistory(WWW),
    siteHistory(SIGHTINGS),
  ])

  // Treat the newest stored row as "this run" so the preview matches the last
  // real report, and compare it against everything older.
  const [wwwLatest, ...wwwPrior] = wwwRows
  const [sightingsLatest, ...sightingsPrior] = sightingsRows
  if (!wwwLatest) {
    console.error('No gsc_ranking_snapshots rows yet — nothing to preview.')
    process.exit(1)
  }

  const watchlist = await fetchWatchlistKeywords(supabase, WWW)
  const watchlistKeywords = watchlist.map((row) => row.keyword)

  const { data: keywordRows } = await supabase
    .from('gsc_keyword_snapshots')
    .select('keyword, page, clicks, impressions, avg_position, checked_at')
    .in('keyword', watchlistKeywords)
    .order('checked_at', { ascending: false })

  const grouped = new Map<string, typeof keywordRows>()
  for (const row of keywordRows || []) {
    const bucket = grouped.get(row.keyword)
    if (bucket) bucket.push(row)
    else grouped.set(row.keyword, [row])
  }

  const now = new Date(wwwLatest.checked_at)
  let keywordClicks = 0
  const verdicts = watchlistKeywords.map((keyword) => {
    const rows = grouped.get(keyword) || []
    const [latest, ...prior] = rows
    keywordClicks += latest?.clicks ?? 0
    return classifyKeyword({
      keyword,
      current:
        latest && latest.avg_position != null && latest.impressions > 0
          ? {
              keyword,
              page: latest.page ?? '',
              clicks: latest.clicks,
              impressions: latest.impressions,
              position: Number(latest.avg_position),
            }
          : null,
      history: prior.map((row) => ({
        keyword: row.keyword,
        page: row.page,
        clicks: row.clicks,
        impressions: row.impressions,
        avg_position:
          row.avg_position == null ? null : Number(row.avg_position),
        checked_at: row.checked_at,
      })),
    })
  })

  const toCurrent = (row: (typeof wwwRows)[number]) => ({
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: Number(row.ctr),
    position: Number(row.avg_position ?? 0),
  })
  const toHistory = (rows: typeof wwwRows) =>
    rows.map((row) => ({
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: Number(row.ctr),
      avg_position: row.avg_position == null ? null : Number(row.avg_position),
      checked_at: row.checked_at,
    }))

  const report = buildGscReport({
    now,
    dataThrough: new Date(now.getTime() - 3 * 86_400_000),
    windowDays: 28,
    main: { current: toCurrent(wwwLatest), history: toHistory(wwwPrior) },
    secondary: {
      label: 'Sightings site',
      current: sightingsLatest
        ? toCurrent(sightingsLatest)
        : { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      history: toHistory(sightingsPrior),
    },
    keywords: verdicts,
    keywordClicks,
    footerNote: 'Source: Google Search Console · sasquatchcarpet.com',
  })

  console.log('──────── TELEGRAM CAPTION (with image) ────────')
  console.log(report.caption)
  console.log('\n──────── TELEGRAM TEXT ────────')
  console.log(report.text)
  console.log(
    `\ncaption ${report.caption.length} chars · text ${report.text.length} chars`,
  )

  const png = await renderReportCardPng(report.card)
  await writeFile(OUT_PATH, png)
  console.log(`\nCard written to ${OUT_PATH} (${png.length} bytes)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
