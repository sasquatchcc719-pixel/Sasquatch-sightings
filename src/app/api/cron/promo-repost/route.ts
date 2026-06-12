import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { deliverPromoToGoogle } from '@/lib/echo/delivery'

/**
 * Auto-repost cron — keeps a standing Offer/Event live on Google Business
 * Profile. Google Offer posts expire, so an active offer flagged auto_repost
 * is re-published on a cadence (default weekly) until its end date passes.
 *
 * Only reposts content Charles authored (auto_repost flag is opt-in per post).
 * Scheduled in vercel.json; runs weekly.
 */

const REPOST_EVERY_DAYS = 7

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const today = new Date().toISOString().split('T')[0]
  const cutoff = new Date(
    Date.now() - REPOST_EVERY_DAYS * 86400000,
  ).toISOString()

  // Active, opted-in offers whose window hasn't closed and that haven't been
  // reposted within the cadence window.
  const { data: due, error } = await supabase
    .from('promotional_posts')
    .select('*')
    .eq('auto_repost', true)
    .gte('offer_end_date', today)
    .or(`last_reposted_at.is.null,last_reposted_at.lt.${cutoff}`)

  if (error) {
    console.error('[promo-repost] query failed', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const results: Array<{ id: string; ok: boolean; detail: string }> = []
  for (const promo of due ?? []) {
    const result = await deliverPromoToGoogle({
      id: promo.id,
      post_type: promo.post_type,
      title: promo.title,
      body: promo.body,
      image_url: promo.image_url,
      coupon_code: promo.coupon_code,
      offer_start_date: promo.offer_start_date,
      offer_end_date: promo.offer_end_date,
    })
    if (result.ok) {
      const now = new Date().toISOString()
      await supabase
        .from('promotional_posts')
        .update({ social_posted_at: now, last_reposted_at: now })
        .eq('id', promo.id)
    }
    results.push({ id: promo.id, ok: result.ok, detail: result.detail })
  }

  return NextResponse.json({
    ok: true,
    reposted: results.filter((r) => r.ok).length,
    considered: results.length,
    results,
  })
}
