import { NextRequest, NextResponse } from 'next/server'
import {
  clickedTooSoonAfterSend,
  isLikelyLinkScanner,
  reactivationBookingUrl,
} from '@/lib/ops/reactivation-campaign'
import { createAdminClient } from '@/supabase/server'

/**
 * The BOOK ONLINE button in reactivation emails. Records the click against
 * the exact send, then forwards to the website. The customer must always end
 * up on the booking site — a bad token or a DB hiccup only loses the stat.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  let templateKey: string | null = null

  try {
    const supabase = createAdminClient()
    const { data: log } = await supabase
      .from('reactivation_email_log')
      .select('id, enrollment_id, customer_id, template_key, sent_at')
      .eq('click_token', token)
      .maybeSingle()

    if (log) {
      templateKey = log.template_key
      const userAgent = request.headers.get('user-agent')
      const { error } = await supabase
        .from('reactivation_email_clicks')
        .insert({
          log_id: log.id,
          enrollment_id: log.enrollment_id,
          customer_id: log.customer_id,
          template_key: log.template_key,
          is_bot:
            isLikelyLinkScanner(userAgent) ||
            clickedTooSoonAfterSend(log.sent_at),
          user_agent: userAgent?.slice(0, 500) || null,
        })
      if (error) {
        console.error('[reactivation-click] insert failed:', error.message)
      }
    }
  } catch (error) {
    console.error('[reactivation-click] Error:', error)
  }

  return NextResponse.redirect(reactivationBookingUrl(templateKey), 302)
}

// Link scanners probe with HEAD before (or instead of) GET. Send them on
// without counting a click — otherwise Next falls back to GET and records one.
export async function HEAD(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  await params
  return NextResponse.redirect(reactivationBookingUrl(), 302)
}
