import { NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { requireAnyRole } from '@/lib/auth'

const INDEXED = new Set([
  'Submitted and indexed',
  'Indexed, not submitted in sitemap',
])

function shortPath(url: string): string {
  return (
    url.replace(/https:\/\/(www\.|sightings\.)?sasquatchcarpet\.com/, '') || '/'
  )
}

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'marketing'])
    const supabase = createAdminClient()

    const { data: latestRow } = await supabase
      .from('gsc_page_snapshots')
      .select('checked_at')
      .order('checked_at', { ascending: false })
      .limit(1)
    const latestAt = latestRow?.[0]?.checked_at ?? null
    const latestStart = latestAt
      ? new Date(
          new Date(latestAt).getTime() - 2 * 60 * 60 * 1000,
        ).toISOString()
      : null
    const priorCutoff = latestAt
      ? new Date(
          new Date(latestAt).getTime() - 9 * 24 * 60 * 60 * 1000,
        ).toISOString()
      : null

    const loadRun = async (from: string | null, to: string | null) => {
      if (!from || !to) return []
      const { data } = await supabase
        .from('gsc_page_snapshots')
        .select('url, coverage, verdict, last_crawl_at, checked_at, property')
        .gt('checked_at', from)
        .lte('checked_at', to)
        .order('url')
      return data ?? []
    }

    const latestRows = await loadRun(latestStart, latestAt)
    const priorRows = await loadRun(priorCutoff, latestStart)

    const newestByUrl = (
      rows: Array<{
        url: string
        coverage: string | null
        verdict: string | null
        last_crawl_at: string | null
        checked_at: string
        property: string
      }>,
    ) => {
      const map = new Map<string, (typeof rows)[number]>()
      for (const row of [...rows].sort((a, b) =>
        a.checked_at < b.checked_at ? 1 : -1,
      )) {
        if (!map.has(row.url)) map.set(row.url, row)
      }
      return [...map.values()]
    }

    const latest = newestByUrl(latestRows)
    const prior = newestByUrl(priorRows)

    const priorByUrl = new Map(prior.map((r) => [r.url, r.coverage || '']))
    const dropped: string[] = []
    const newlyIndexed: string[] = []
    const buckets: Record<string, number> = {}
    for (const row of latest) {
      const cov = row.coverage || 'Unknown'
      buckets[cov] = (buckets[cov] ?? 0) + 1
      const was = priorByUrl.get(row.url)
      const isIndexed = INDEXED.has(cov)
      if (was !== undefined) {
        if (INDEXED.has(was) && !isIndexed) dropped.push(row.url)
        if (!INDEXED.has(was) && isIndexed) newlyIndexed.push(row.url)
      }
    }

    const indexed = latest.filter((r) => INDEXED.has(r.coverage || '')).length
    const waiting = latest.filter(
      (r) =>
        !INDEXED.has(r.coverage || '') && /not indexed/i.test(r.coverage || ''),
    ).length
    const other = latest.length - indexed - waiting
    const notIndexed = latest.filter((r) => !INDEXED.has(r.coverage || ''))
    const lines = [
      '🔎 Google Index Check',
      '',
      `${indexed} of ${latest.length} checked pages can appear in Google Search.`,
      '',
      `✅ Indexed: ${indexed}`,
      `⏳ Waiting on Google: ${waiting}`,
      `ℹ️ Unknown or excluded: ${other}`,
      '',
      newlyIndexed.length || dropped.length
        ? `Since the last check: ${newlyIndexed.length} newly indexed${
            dropped.length ? ` · ${dropped.length} no longer indexed` : ''
          }`
        : 'Since the last check: no indexing changes',
      'Monitoring only — no recrawl requests were sent.',
    ].filter(Boolean)

    return NextResponse.json({
      lastSent: latestAt,
      digest: lines.join('\n'),
      buckets,
      indexed,
      waiting,
      other,
      checked: latest.length,
      dropped: dropped.map(shortPath),
      newlyIndexed: newlyIndexed.map(shortPath),
      notIndexed: notIndexed.map((r) => ({
        url: r.url,
        path: shortPath(r.url),
        coverage: r.coverage,
        crawled: r.last_crawl_at,
      })),
      constants: {
        maxInspections: 80,
        staleSitemapDays: 7,
        indexCheckMaxInspections: 250,
      },
    })
  } catch (err) {
    console.error('[admin/comms/telegram/coverage]', err)
    return NextResponse.json(
      { error: 'Failed to load coverage' },
      { status: 500 },
    )
  }
}
