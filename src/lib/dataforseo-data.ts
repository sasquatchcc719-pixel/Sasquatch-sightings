/**
 * DataForSEO — everything beyond Maps rank tracking.
 *
 * `dataforseo.ts` covers the geo-grid Maps SERP only. This module covers the
 * rest of the account: Business Data (profile info, reviews, Q&A, updates),
 * keyword volume (Google Ads + LLM), Bing SERP, and web-wide brand mentions.
 *
 * Why these and not Local Falcon: Falcon is the better instrument for "where do
 * we rank at a point, across platforms" and we should keep using it for that.
 * None of the endpoints below have a Falcon equivalent — Falcon returns rank
 * positions, never review TEXT, keyword volume, Bing, or off-platform mentions.
 * See ScanScheduleCard for the user-facing version of that split.
 *
 * Every path here was verified against the live API on 2026-08-11, not copied
 * from a blog post. Two contracts that are easy to get wrong:
 *   - my_business_info takes the CID inside `keyword` as `cid:NNN`, NOT a `cid`
 *     field. The `cid` field is reviews/Q&A only.
 *   - reviews/Q&A/updates are task-based (task_post → poll task_get). They
 *     return 40602 "Task In Queue" for ~60-90s before 20000. Only
 *     my_business_info supports Live.
 */

import { dfsPost, auth, DFS_BASE } from '@/lib/dataforseo'

/** US. DataForSEO's own location taxonomy — not a lat/lng. */
export const DFS_LOCATION_US = 2840

/* ------------------------------------------------------------------ */
/* Business Data — Google                                              */
/* ------------------------------------------------------------------ */

export type DfsRating = {
  rating_type?: string | null
  value?: number | null
  votes_count?: number | null
  rating_max?: number | null
}

export type MyBusinessInfo = {
  title: string | null
  /** The AGGREGATE counter Google displays. Compare against review item count. */
  votes_count: number | null
  rating_value: number | null
  cid: string | null
  place_id: string | null
  address: string | null
  phone: string | null
  url: string | null
  category: string | null
  is_claimed: boolean | null
  work_time: unknown
  raw: unknown
}

/**
 * Live profile snapshot. Cheap (~$0.005) and synchronous — safe to run daily.
 *
 * Returns `votes_count`, which is the number Google *displays*. That is a
 * different number from the count of reviews Google will actually hand you (see
 * fetchReviews) and the whole point of logging both.
 */
export async function fetchMyBusinessInfo(
  cid: string,
): Promise<MyBusinessInfo | null> {
  const { result } = await dfsPost<{ items?: Array<Record<string, unknown>> }>(
    '/business_data/google/my_business_info/live',
    {
      keyword: `cid:${cid}`,
      language_code: 'en',
      location_code: DFS_LOCATION_US,
    },
  )
  const item = result?.[0]?.items?.[0]
  if (!item) return null

  const rating = (item.rating ?? {}) as DfsRating
  return {
    title: (item.title as string) ?? null,
    votes_count: rating.votes_count ?? null,
    rating_value: rating.value ?? null,
    cid: (item.cid as string) ?? null,
    place_id: (item.place_id as string) ?? null,
    address: (item.address as string) ?? null,
    phone: (item.phone as string) ?? null,
    url: (item.url as string) ?? null,
    category: (item.category as string) ?? null,
    is_claimed: (item.is_claimed as boolean) ?? null,
    work_time: item.work_time ?? null,
    raw: item,
  }
}

/* ---- task-based endpoints ---------------------------------------- */

async function taskGet<T>(family: string, taskId: string): Promise<T[] | null> {
  const res = await fetch(`${DFS_BASE}/${family}/task_get/${taskId}`, {
    headers: { Authorization: `Basic ${auth()}` },
  })
  const json = (await res.json()) as {
    tasks?: Array<{ status_code?: number; status_message?: string; result?: T[] }>
  }
  const t = json.tasks?.[0]
  // 40602 = still queued. Caller polls; not an error.
  if (t?.status_code === 40602) return null
  if (t && t.status_code !== 20000) {
    throw new Error(`DataForSEO ${family} task_get: ${t.status_message}`)
  }
  return t?.result ?? []
}

/**
 * Poll a task to completion. Reviews take ~60-90s in practice; the default
 * budget is deliberately generous because a half-fetched review corpus is worse
 * than a slow one.
 */
async function pollTask<T>(
  family: string,
  taskId: string,
  { attempts = 15, intervalMs = 12_000 } = {},
): Promise<T[]> {
  for (let i = 0; i < attempts; i++) {
    const out = await taskGet<T>(family, taskId)
    if (out !== null) return out
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(
    `DataForSEO ${family} task ${taskId} still queued after ${attempts} attempts`,
  )
}

export type GoogleReview = {
  review_id: string | null
  timestamp: string | null
  rating: number | null
  profile_name: string | null
  profile_url: string | null
  review_text: string | null
  owner_answer: string | null
  local_guide: boolean | null
  reviews_count_by_reviewer: number | null
  photos_count: number | null
  raw: unknown
}

export type ReviewsPull = {
  /** Google's AGGREGATE counter. */
  reviews_count: number | null
  rating_value: number | null
  /** How many review objects Google actually returned. */
  items_count: number
  items: GoogleReview[]
  /**
   * True when the aggregate disagrees with the item list. This is the exact
   * signature of the post-reinstatement count desync — evidence for a ticket,
   * not a bug in our code.
   */
  count_mismatch: boolean
}

/**
 * Pull the full review corpus. Billed per 10 reviews returned, so `depth` is a
 * real cost lever: depth 200 on an 81-review profile cost $0.015.
 *
 * `sort_by: 'newest'` matters — the default ordering is Google's "most
 * relevant", which is unstable between pulls and makes diffing corpora
 * meaningless.
 */
export async function fetchReviews(
  cid: string,
  { depth = 200 }: { depth?: number } = {},
): Promise<ReviewsPull> {
  const { taskId } = await dfsPost('/business_data/google/reviews/task_post', {
    cid,
    language_code: 'en',
    location_code: DFS_LOCATION_US,
    depth,
    sort_by: 'newest',
  })
  if (!taskId) throw new Error('DataForSEO reviews: no task id returned')

  const result = await pollTask<{
    reviews_count?: number
    rating?: DfsRating
    items_count?: number
    items?: Array<Record<string, unknown>>
  }>('business_data/google/reviews', taskId)

  const r = result?.[0]
  const items = (r?.items ?? []).map(
    (i): GoogleReview => ({
      review_id: (i.review_id as string) ?? null,
      timestamp: (i.timestamp as string) ?? null,
      rating: ((i.rating as DfsRating)?.value as number) ?? null,
      profile_name: (i.profile_name as string) ?? null,
      profile_url: (i.profile_url as string) ?? null,
      review_text: ((i.review_text as string) ?? '').trim() || null,
      owner_answer: ((i.owner_answer as string) ?? '').trim() || null,
      local_guide: (i.local_guide as boolean) ?? null,
      reviews_count_by_reviewer:
        (i.reviews_by_reviewer_count as number) ??
        (i.reviews_count as number) ??
        null,
      photos_count: (i.photos_count as number) ?? null,
      raw: i,
    }),
  )

  const aggregate = r?.reviews_count ?? r?.rating?.votes_count ?? null
  return {
    reviews_count: aggregate,
    rating_value: r?.rating?.value ?? null,
    items_count: items.length,
    items,
    count_mismatch: aggregate !== null && aggregate !== items.length,
  }
}

export type BusinessQuestion = {
  question_text: string | null
  timestamp: string | null
  profile_name: string | null
  answers: Array<{ text: string | null; profile_name: string | null }>
  raw: unknown
}

/**
 * GBP Questions & Answers. Underused lever: we're allowed to post and answer
 * our own questions, and that text sits directly on the entity Gemini reads.
 */
export async function fetchQuestionsAndAnswers(
  cid: string,
  { depth = 50 }: { depth?: number } = {},
): Promise<BusinessQuestion[]> {
  const { taskId } = await dfsPost(
    '/business_data/google/questions_and_answers/task_post',
    {
      keyword: `cid:${cid}`,
      language_code: 'en',
      location_code: DFS_LOCATION_US,
      depth,
    },
  )
  if (!taskId) throw new Error('DataForSEO Q&A: no task id returned')

  const result = await pollTask<{ items?: Array<Record<string, unknown>> }>(
    'business_data/google/questions_and_answers',
    taskId,
  )

  return (result?.[0]?.items ?? []).map(
    (i): BusinessQuestion => ({
      question_text: ((i.question_text as string) ?? '').trim() || null,
      timestamp: (i.timestamp as string) ?? null,
      profile_name: (i.profile_name as string) ?? null,
      answers: ((i.items as Array<Record<string, unknown>>) ?? []).map((a) => ({
        text: ((a.answer_text as string) ?? '').trim() || null,
        profile_name: (a.profile_name as string) ?? null,
      })),
      raw: i,
    }),
  )
}

/* ------------------------------------------------------------------ */
/* Keyword volume — Google Ads vs LLM                                  */
/* ------------------------------------------------------------------ */

export type KeywordVolume = {
  keyword: string
  search_volume: number | null
  competition: string | null
  cpc: number | null
}

/** Classic Google Ads monthly search volume. */
export async function fetchGoogleKeywordVolume(
  keywords: string[],
  locationCode = DFS_LOCATION_US,
): Promise<KeywordVolume[]> {
  if (!keywords.length) return []
  const { result } = await dfsPost<Record<string, unknown>>(
    '/keywords_data/google_ads/search_volume/live',
    { keywords, location_code: locationCode, language_code: 'en' },
  )
  return (result ?? []).map((r) => ({
    keyword: (r.keyword as string) ?? '',
    search_volume: (r.search_volume as number) ?? null,
    competition: (r.competition as string) ?? null,
    cpc: (r.cpc as number) ?? null,
  }))
}

/**
 * Search volume as seen through LLM platforms.
 *
 * The reason this endpoint is the interesting half of the pair: a topic with
 * real LLM volume and near-zero Google Ads volume is invisible to every
 * competitor using a conventional keyword tool. That gap is the cheapest
 * content opportunity we have.
 */
export async function fetchLlmKeywordVolume(
  keywords: string[],
  locationCode = DFS_LOCATION_US,
): Promise<KeywordVolume[]> {
  if (!keywords.length) return []
  const { result } = await dfsPost<{ items?: Array<Record<string, unknown>> }>(
    '/ai_optimization/ai_keyword_data/keywords_search_volume/live',
    { keywords, location_code: locationCode, language_name: 'English' },
  )
  const items = result?.[0]?.items ?? (result as Array<Record<string, unknown>>)
  return (items ?? []).map((r) => ({
    keyword: (r.keyword as string) ?? '',
    search_volume: (r.ai_search_volume as number) ?? (r.search_volume as number) ?? null,
    competition: null,
    cpc: null,
  }))
}

/* ------------------------------------------------------------------ */
/* Bing SERP — the ChatGPT proxy                                       */
/* ------------------------------------------------------------------ */

export type BingResult = {
  position: number
  title: string | null
  url: string | null
  domain: string | null
}

/**
 * Bing organic results.
 *
 * Worth tracking specifically because ChatGPT's local answers lean on Bing (plus
 * licensed Yelp data since Jul 2026), and our measured ChatGPT share of voice is
 * ~0. If we're absent from Bing, that is the mechanism — and unlike most AI
 * visibility questions, it's directly checkable and directly fixable.
 */
export async function fetchBingOrganic(
  keyword: string,
  locationCode = DFS_LOCATION_US,
  depth = 50,
): Promise<BingResult[]> {
  const { result } = await dfsPost<{ items?: Array<Record<string, unknown>> }>(
    '/serp/bing/organic/live/advanced',
    { keyword, location_code: locationCode, language_code: 'en', depth },
  )
  return (result?.[0]?.items ?? [])
    .filter((i) => i.type === 'organic')
    .map((i) => ({
      position: (i.rank_absolute as number) ?? 0,
      title: (i.title as string) ?? null,
      url: (i.url as string) ?? null,
      domain: (i.domain as string) ?? null,
    }))
}

/* ------------------------------------------------------------------ */
/* Brand mentions across the web                                       */
/* ------------------------------------------------------------------ */

export type BrandMention = {
  url: string | null
  domain: string | null
  title: string | null
  snippet: string | null
  date: string | null
}

/**
 * Web-wide mentions of a phrase. Two uses: unlinked brand mentions (an AI-era
 * citation signal), and an early warning when someone else starts using the
 * name.
 */
export async function fetchBrandMentions(
  phrase: string,
  limit = 100,
): Promise<BrandMention[]> {
  const { result } = await dfsPost<{ items?: Array<Record<string, unknown>> }>(
    '/content_analysis/search/live',
    {
      keyword: phrase,
      search_mode: 'as_is',
      limit,
      order_by: ['content_info.date_published,desc'],
    },
  )
  return (result?.[0]?.items ?? []).map((i) => {
    const ci = (i.content_info ?? {}) as Record<string, unknown>
    return {
      url: (i.url as string) ?? null,
      domain: (i.domain as string) ?? null,
      title: (ci.title as string) ?? null,
      snippet:
        ((ci.main_title as string) ?? (ci.snippet as string) ?? '').slice(0, 400) ||
        null,
      date: (ci.date_published as string) ?? null,
    }
  })
}
