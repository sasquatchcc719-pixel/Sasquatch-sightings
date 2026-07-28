/**
 * Daily snapshot of Google's public review count for the business profile.
 *
 * The GBP sync already receives this number in place_info.reviews; it used to
 * be interpolated into a Telegram line and dropped. While the profile is
 * suspended/being reinstated it is the clearest outside signal of whether
 * Google has restored the review history, so it is worth a row a day and a
 * shout when it moves. No extra SerpApi credits — same response, kept.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type ReviewCountChange = {
  today: number
  previous: number | null
  delta: number | null
  previousDate: string | null
}

/**
 * Record today's count and report how it moved versus the last snapshot.
 * Returns null when Google gave us no number (nothing useful to compare).
 */
export async function recordReviewCount(
  supabase: SupabaseClient,
  totalOnGoogle: number | null,
  storedReviews: number,
  today = new Date(),
): Promise<ReviewCountChange | null> {
  if (totalOnGoogle == null) return null

  const capturedOn = today.toISOString().slice(0, 10)

  // Compare against the most recent earlier day before writing, so re-running
  // the cron on the same day doesn't read back its own value as "previous".
  const { data: prior } = await supabase
    .from('gbp_review_counts')
    .select('captured_on, total_on_google')
    .lt('captured_on', capturedOn)
    .order('captured_on', { ascending: false })
    .limit(1)
    .maybeSingle()

  await supabase.from('gbp_review_counts').upsert(
    {
      captured_on: capturedOn,
      total_on_google: totalOnGoogle,
      stored_reviews: storedReviews,
      captured_at: today.toISOString(),
    },
    { onConflict: 'captured_on' },
  )

  const previous =
    typeof prior?.total_on_google === 'number' ? prior.total_on_google : null

  return {
    today: totalOnGoogle,
    previous,
    delta: previous == null ? null : totalOnGoogle - previous,
    previousDate: prior?.captured_on ?? null,
  }
}

/**
 * Owner-facing text for a move in the public review count — only worth
 * sending when it actually changed, since the daily digest already runs.
 */
export function formatReviewCountChange(
  change: ReviewCountChange,
  storedReviews: number,
): string | null {
  if (change.delta == null || change.delta === 0) return null

  const direction = change.delta > 0 ? '📈' : '📉'
  const verb = change.delta > 0 ? 'up' : 'down'
  const lines = [
    `${direction} Google review count ${verb} ${Math.abs(change.delta)}`,
    `Now showing ${change.today} (was ${change.previous})`,
  ]
  if (storedReviews > change.today) {
    lines.push(
      `We have ${storedReviews} archived — ${storedReviews - change.today} still not public.`,
    )
  }
  return lines.join('\n')
}
