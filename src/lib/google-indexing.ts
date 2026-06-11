/**
 * Google Indexing API helper
 *
 * Notifies Google to immediately crawl a URL when a new job is published.
 * Uses a Google Cloud Service Account stored in GOOGLE_INDEXING_SA_JSON.
 *
 * SETUP (one-time, manual):
 * 1. Go to https://console.cloud.google.com → create/select project
 * 2. Enable "Web Search Indexing API"
 * 3. Create a Service Account (IAM → Service Accounts) → create JSON key → download
 * 4. Add GOOGLE_INDEXING_SA_JSON to Vercel env vars (paste the entire JSON as one line)
 * 5. In Google Search Console → Settings → Users and permissions
 *    → Add the service account email as an OWNER on www.sasquatchcarpet.com
 */

import { google } from 'googleapis'

const MAIN_DOMAIN = 'https://www.sasquatchcarpet.com'

/**
 * Convert a city name to a URL-safe slug (matches sitemap.ts logic)
 */
function toCitySlug(city: string): string {
  return city
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Build the main-domain URL for a job detail page.
 * Maps to the Vercel proxy: /sightings/:path* → sightings.sasquatchcarpet.com/work/:path*
 */
export function buildJobUrl(city: string, slug: string): string {
  const citySlug = toCitySlug(city || 'Colorado')
  return `${MAIN_DOMAIN}/sightings/${citySlug}/${slug}`
}

export type IndexingPingResult = {
  url: string
  ok: boolean
  error?: string
}

/**
 * Ping Google Indexing API for one URL and report the outcome.
 * (Official API scope is JobPosting/BroadcastEvent pages — for other pages
 * this acts as a crawl nudge, not a guarantee.)
 */
export async function pingGoogleIndexing(
  url: string,
): Promise<IndexingPingResult> {
  const saJson = process.env.GOOGLE_INDEXING_SA_JSON
  if (!saJson) {
    return { url, ok: false, error: 'GOOGLE_INDEXING_SA_JSON not set' }
  }

  let credentials: object
  try {
    credentials = JSON.parse(saJson)
  } catch {
    return {
      url,
      ok: false,
      error: 'GOOGLE_INDEXING_SA_JSON is not valid JSON',
    }
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/indexing'],
    })

    const client = await auth.getClient()
    const indexing = google.indexing({
      version: 'v3',
      auth: client as Parameters<typeof google.indexing>[0]['auth'],
    })

    await indexing.urlNotifications.publish({
      requestBody: {
        url,
        type: 'URL_UPDATED',
      },
    })

    console.log(`[google-indexing] Pinged Google for: ${url}`)
    return { url, ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[google-indexing] Ping failed:', err)
    return { url, ok: false, error: message.slice(0, 300) }
  }
}

/**
 * Fire-and-forget ping (publish flows). Never throws.
 */
export async function notifyGoogleIndexing(url: string): Promise<void> {
  await pingGoogleIndexing(url)
}
