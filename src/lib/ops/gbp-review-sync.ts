/**
 * Google Business Profile review watchdog.
 *
 * Why this exists: on 2026-08-11 we discovered seven 5-star reviews had been
 * removed from the profile at some point between mid-June and end of July, and
 * nobody noticed because nothing was watching. We only caught it by diffing a
 * table that happened to be accumulating rows. This makes that diff deliberate,
 * daily, and loud.
 *
 * It tracks two DIFFERENT failures that are easy to conflate:
 *   1. REMOVAL  — a review Google used to return is gone from the list.
 *   2. DESYNC   — Google's aggregate counter disagrees with its own list
 *                 (verified 2026-08-11: counter 80, list 81, same payload).
 * They need different escalation language, so they are recorded separately.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchMyBusinessInfo, fetchReviews } from '@/lib/dataforseo-data'
import { sendAdminAlert } from '@/lib/telegram'

/**
 * Sasquatch Carpet Cleaning's Google CID.
 * Verified 2026-08-11 against Google Maps and DataForSEO my_business_info
 * (place_id ChIJw1Fmyv9_EQIRSsL80280NoQ). Overridable for testing.
 */
export const SASQUATCH_CID = process.env.GBP_CID ?? '9526859716651434570'

export type ReviewSyncResult = {
  cid: string
  aggregateCount: number | null
  returnedCount: number
  countMismatch: boolean
  inserted: number
  updated: number
  newlyMissing: Array<{ review_id: string; author: string | null; text: string | null }>
  reappeared: string[]
  alerted: boolean
}

export async function syncGbpReviews(
  supabase: SupabaseClient,
  { cid = SASQUATCH_CID, alert = true }: { cid?: string; alert?: boolean } = {},
): Promise<ReviewSyncResult> {
  const now = new Date().toISOString()

  // 1. Profile snapshot — the number Google DISPLAYS.
  const info = await fetchMyBusinessInfo(cid)

  // 2. Full corpus — the reviews Google will actually hand over.
  const pull = await fetchReviews(cid, { depth: 200 })
  const liveIds = new Set(pull.items.map((r) => r.review_id).filter(Boolean) as string[])

  await supabase.from('gbp_profile_snapshots').insert({
    cid,
    captured_at: now,
    title: info?.title ?? null,
    rating_value: info?.rating_value ?? null,
    votes_count: info?.votes_count ?? null,
    reviews_returned: pull.items_count,
    is_claimed: info?.is_claimed ?? null,
    phone: info?.phone ?? null,
    url: info?.url ?? null,
    category: info?.category ?? null,
    work_time: info?.work_time ?? null,
    raw: info?.raw ?? {},
  })

  // 3. Which known reviews were NOT returned this time?
  //    Only consider rows we've already attributed to this cid, plus legacy rows
  //    written before the cid column existed (cid is null on those).
  const { data: known } = await supabase
    .from('gbp_reviews')
    .select('review_id, author, snippet, missing_since')
    .or(`cid.eq.${cid},cid.is.null`)

  const newlyMissing: ReviewSyncResult['newlyMissing'] = []
  const reappeared: string[] = []

  for (const row of known ?? []) {
    const isLive = liveIds.has(row.review_id)
    if (!isLive && !row.missing_since) {
      newlyMissing.push({
        review_id: row.review_id,
        author: row.author ?? null,
        text: row.snippet ?? null,
      })
    } else if (isLive && row.missing_since) {
      reappeared.push(row.review_id)
    }
  }

  if (newlyMissing.length) {
    await supabase
      .from('gbp_reviews')
      .update({ missing_since: now })
      .in(
        'review_id',
        newlyMissing.map((r) => r.review_id),
      )
  }
  if (reappeared.length) {
    await supabase
      .from('gbp_reviews')
      .update({ missing_since: null })
      .in('review_id', reappeared)
  }

  // 4. Upsert everything currently live.
  let inserted = 0
  let updated = 0
  const knownIds = new Set((known ?? []).map((r) => r.review_id))

  for (const r of pull.items) {
    if (!r.review_id) continue
    const row = {
      cid,
      review_id: r.review_id,
      author: r.profile_name,
      rating: r.rating != null ? String(r.rating) : null,
      snippet: r.review_text,
      reviewed_at: r.timestamp ? new Date(r.timestamp).toISOString() : null,
      profile_url: r.profile_url,
      owner_answer: r.owner_answer,
      local_guide: r.local_guide,
      reviewer_review_count: r.reviews_count_by_reviewer,
      photos_count: r.photos_count,
      last_seen_at: now,
      missing_since: null,
      raw: r.raw as Record<string, unknown>,
    }
    const { error } = await supabase
      .from('gbp_reviews')
      .upsert(row, { onConflict: 'review_id' })
    if (error) throw new Error(`gbp_reviews upsert failed: ${error.message}`)
    if (knownIds.has(r.review_id)) updated++
    else inserted++
  }

  await supabase.from('gbp_review_pulls').insert({
    cid,
    pulled_at: now,
    aggregate_count: pull.reviews_count,
    returned_count: pull.items_count,
    rating_value: pull.rating_value,
    count_mismatch: pull.count_mismatch,
    newly_missing: newlyMissing.length,
  })

  // 5. Alert only on state CHANGES. A standing desync would otherwise fire every
  //    single day and train us to ignore it.
  let alerted = false
  if (alert && newlyMissing.length) {
    const lines = newlyMissing
      .slice(0, 10)
      .map(
        (r) =>
          `• ${r.author ?? 'Unknown'} — "${(r.text ?? '').slice(0, 70)}${(r.text ?? '').length > 70 ? '…' : ''}"`,
      )
      .join('\n')
    await sendAdminAlert(
      `${newlyMissing.length} Google review${newlyMissing.length === 1 ? '' : 's'} disappeared`,
      `Google stopped returning ${newlyMissing.length} review${newlyMissing.length === 1 ? '' : 's'} that were live yesterday:\n\n${lines}\n\nDisplayed count: ${info?.votes_count ?? '?'} · Reviews returned: ${pull.items_count}`,
    )
    alerted = true
  } else if (alert && pull.count_mismatch) {
    const { data: prev } = await supabase
      .from('gbp_review_pulls')
      .select('count_mismatch')
      .eq('cid', cid)
      .order('pulled_at', { ascending: false })
      .range(1, 1)
    // Only shout when the mismatch is NEW, not while it persists.
    if (prev?.[0] && prev[0].count_mismatch === false) {
      await sendAdminAlert(
        'Google review count desynced',
        `Google's displayed count (${pull.reviews_count}) no longer matches the number of reviews it returns (${pull.items_count}). No reviews are missing — the counter itself is wrong. This is ticket evidence.`,
      )
      alerted = true
    }
  }

  return {
    cid,
    aggregateCount: pull.reviews_count,
    returnedCount: pull.items_count,
    countMismatch: pull.count_mismatch,
    inserted,
    updated,
    newlyMissing,
    reappeared,
    alerted,
  }
}
