/**
 * Google Search Console API client + thin helpers.
 * Read access via OAuth refresh token (GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN,
 * minted 2026-06-11 with webmasters.readonly scope on the Ranger OAuth client).
 * Note: sitemaps.submit requires full `webmasters` scope; with the readonly
 * token it will throw — callers must treat submit failures as non-fatal.
 */

import { google, type searchconsole_v1 } from 'googleapis'

export const GSC_WWW_PROPERTY = 'https://www.sasquatchcarpet.com/'
export const GSC_SIGHTINGS_PROPERTY = 'https://sightings.sasquatchcarpet.com/'

export function getSearchConsoleClient(): searchconsole_v1.Searchconsole {
  const clientId =
    process.env.RANGER_GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
  const clientSecret =
    process.env.RANGER_GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Google Search Console OAuth credentials are not configured',
    )
  }
  const auth = new google.auth.OAuth2(clientId, clientSecret)
  auth.setCredentials({ refresh_token: refreshToken })
  return google.searchconsole({ version: 'v1', auth })
}

export type GscInspection = {
  url: string
  property: string
  verdict: string | null
  coverage: string | null
  lastCrawlAt: string | null
}

export async function inspectUrl(
  sc: searchconsole_v1.Searchconsole,
  property: string,
  url: string,
): Promise<GscInspection> {
  const { data } = await sc.urlInspection.index.inspect({
    requestBody: { inspectionUrl: url, siteUrl: property },
  })
  const r = data.inspectionResult?.indexStatusResult || {}
  return {
    url,
    property,
    verdict: r.verdict ?? null,
    coverage: r.coverageState ?? null,
    lastCrawlAt: r.lastCrawlTime ?? null,
  }
}

export type GscSitemapStatus = {
  property: string
  path: string
  lastDownloaded: string | null
  errors: number
  warnings: number
}

export async function listSitemapStatuses(
  sc: searchconsole_v1.Searchconsole,
  property: string,
): Promise<GscSitemapStatus[]> {
  const { data } = await sc.sitemaps.list({ siteUrl: property })
  return (data.sitemap || []).map((s) => ({
    property,
    path: s.path || '',
    lastDownloaded: s.lastDownloaded ?? null,
    errors: Number(s.errors || 0),
    warnings: Number(s.warnings || 0),
  }))
}

export type GscTotals = { clicks: number; impressions: number }

export async function queryTotals(
  sc: searchconsole_v1.Searchconsole,
  property: string,
  startDaysAgo: number,
  endDaysAgo: number,
): Promise<GscTotals> {
  const day = (d: number) =>
    new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)
  const { data } = await sc.searchanalytics.query({
    siteUrl: property,
    requestBody: {
      startDate: day(startDaysAgo),
      endDate: day(endDaysAgo),
      rowLimit: 1,
    },
  })
  const row = (data.rows || [])[0]
  return {
    clicks: Number(row?.clicks || 0),
    impressions: Number(row?.impressions || 0),
  }
}

/** Extract <loc> URLs from a live sitemap XML. */
export async function fetchSitemapUrls(sitemapUrl: string): Promise<string[]> {
  const res = await fetch(sitemapUrl, { next: { revalidate: 0 } })
  if (!res.ok) return []
  const xml = await res.text()
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
}
