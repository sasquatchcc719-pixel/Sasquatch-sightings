/**
 * POST /api/admin/seo/request-indexing
 * Pings the Google Indexing API (server-side, where the service-account
 * credential lives) for a list of our own URLs. Used to force-feed crawl
 * requests for pages the June 2026 audit found starved (never crawled).
 *
 * Auth: admin session (requireAnyRole) OR `Authorization: Bearer CRON_SECRET`
 * (so CLI/automation can trigger it like the cron routes).
 * Abuse guard: every URL must belong to one of our own live sitemaps.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { pingGoogleIndexing } from '@/lib/google-indexing'
import { fetchSitemapUrls } from '@/lib/gsc'

const MAX_URLS_PER_CALL = 20
const SITEMAPS = [
  'https://www.sasquatchcarpet.com/sitemap.xml',
  'https://www.sasquatchcarpet.com/sitemap-jobs.xml',
  'https://sightings.sasquatchcarpet.com/sitemap.xml',
]

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader === `Bearer ${process.env.CRON_SECRET}`
  ) {
    return true
  }
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    return true
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let urls: string[]
  try {
    const body = (await request.json()) as { urls?: unknown }
    urls = Array.isArray(body.urls) ? body.urls.map(String) : []
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (urls.length === 0 || urls.length > MAX_URLS_PER_CALL) {
    return NextResponse.json(
      { error: `Provide 1-${MAX_URLS_PER_CALL} urls` },
      { status: 400 },
    )
  }

  // Only ping URLs we actually publish — membership in our own sitemaps.
  const known = new Set<string>()
  for (const sm of SITEMAPS) {
    try {
      for (const u of await fetchSitemapUrls(sm)) known.add(u)
    } catch {
      /* sitemap fetch failure just narrows the allowlist */
    }
  }
  const rejected = urls.filter((u) => !known.has(u))
  const accepted = urls.filter((u) => known.has(u))

  const results = []
  for (const url of accepted) {
    results.push(await pingGoogleIndexing(url))
  }

  return NextResponse.json({
    pinged: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
    rejected,
  })
}
