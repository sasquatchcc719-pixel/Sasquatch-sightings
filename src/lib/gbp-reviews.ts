/**
 * Google Business Profile review sync via SerpApi (google_maps_reviews).
 * Runs with the daily SERP cron: pulls newest reviews, stores new ones in
 * gbp_reviews, and returns them so the cron can notify Charles. The table also
 * lets the review-request engine skip customers who already reviewed.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchSerpApiJson } from '@/lib/serpapi-budget'

// Sasquatch Carpet Cleaning, LLC — data_id from the Maps listing URL.
const GBP_DATA_ID =
  process.env.GBP_DATA_ID || '0x2117fffca6651c3:0x8436346fd3fcc24a'
/** One newest-first page is enough for normal daily incremental sync. */
const DEFAULT_MAX_PAGES = 1

export type GbpReview = {
  review_id: string
  author: string | null
  rating: number | null
  snippet: string | null
  review_date_label: string | null
}

type SerpReviewsPage = {
  place_info?: { reviews?: number }
  reviews?: Array<{
    review_id?: string
    rating?: number
    snippet?: string
    date?: string
    user?: { name?: string }
  }>
  serpapi_pagination?: { next_page_token?: string }
  error?: string
}

async function fetchReviewsPage(
  pageToken: string | null,
): Promise<SerpReviewsPage> {
  const params = new URLSearchParams({
    engine: 'google_maps_reviews',
    data_id: GBP_DATA_ID,
    sort_by: 'newestFirst',
  })
  if (pageToken) {
    params.set('next_page_token', pageToken)
    params.set('num', '20')
  }

  const data = await fetchSerpApiJson<SerpReviewsPage>({
    source: 'gbp-reviews',
    query: pageToken
      ? `GBP reviews page ${pageToken.slice(0, 16)}`
      : 'GBP reviews newest',
    params,
  })
  if (data.error) throw new Error(`SerpApi reviews error: ${data.error}`)
  return data
}

function getMaxPages(): number {
  const parsed = Number.parseInt(
    process.env.GBP_REVIEW_SYNC_MAX_PAGES || '',
    10,
  )
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_PAGES
  return Math.min(parsed, 5)
}

/**
 * Incremental sync: walk newest-first pages, insert unseen reviews, stop as
 * soon as a page contains nothing new (or after MAX_PAGES).
 */
export async function syncGbpReviews(supabase: SupabaseClient): Promise<{
  newReviews: GbpReview[]
  totalOnGoogle: number | null
}> {
  const newReviews: GbpReview[] = []
  let totalOnGoogle: number | null = null
  let pageToken: string | null = null

  const maxPages = getMaxPages()
  for (let page = 0; page < maxPages; page += 1) {
    const data = await fetchReviewsPage(pageToken)
    if (totalOnGoogle == null && data.place_info?.reviews != null) {
      totalOnGoogle = data.place_info.reviews
    }

    const pageReviews: GbpReview[] = (data.reviews || [])
      .filter((r) => r.review_id)
      .map((r) => ({
        review_id: String(r.review_id),
        author: r.user?.name?.trim() || null,
        rating: r.rating ?? null,
        snippet: r.snippet?.trim() || null,
        review_date_label: r.date?.trim() || null,
      }))
    if (pageReviews.length === 0) break

    const { data: existing } = await supabase
      .from('gbp_reviews')
      .select('review_id')
      .in(
        'review_id',
        pageReviews.map((r) => r.review_id),
      )
    const known = new Set((existing || []).map((r) => r.review_id))
    const fresh = pageReviews.filter((r) => !known.has(r.review_id))

    if (fresh.length > 0) {
      const { error } = await supabase.from('gbp_reviews').insert(fresh)
      if (error) throw error
      newReviews.push(...fresh)
    }

    // Entire page already known → we've caught up with history.
    if (fresh.length < pageReviews.length) break

    pageToken = data.serpapi_pagination?.next_page_token || null
    if (!pageToken) break
  }

  return { newReviews, totalOnGoogle }
}

function nameTokens(value: string | null | undefined): string[] {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Does a Google reviewer name plausibly belong to this customer?
 * Matches on exact full name, or last-name equality + first-initial equality
 * (catches "Kathie Hartman" record vs "Kathleen Hartman" reviewer). A false
 * positive only means we skip one ask — the safe direction.
 */
export function reviewerMatchesCustomer(
  author: string | null,
  customer: {
    first_name?: string | null
    last_name?: string | null
    full_name?: string | null
  },
): boolean {
  const authorTokens = nameTokens(author)
  if (authorTokens.length === 0) return false

  const customerTokens = nameTokens(
    customer.full_name ||
      `${customer.first_name || ''} ${customer.last_name || ''}`,
  )
  if (customerTokens.length === 0) return false

  if (authorTokens.join(' ') === customerTokens.join(' ')) return true

  if (authorTokens.length >= 2 && customerTokens.length >= 2) {
    const authorFirst = authorTokens[0]
    const authorLast = authorTokens[authorTokens.length - 1]
    const customerFirst = customerTokens[0]
    const customerLast = customerTokens[customerTokens.length - 1]
    if (authorLast === customerLast && authorFirst[0] === customerFirst[0]) {
      return true
    }
  }

  return false
}
