import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { deliverPromoToGoogle } from '@/lib/echo/delivery'

type Params = { params: Promise<{ id: string }> }

function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : ''
  return msg.includes('not authorized') || msg.includes('not authenticated')
}

// POST — publish this offer/event to Google Business Profile now.
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const { id } = await params
    const supabase = createAdminClient()

    const { data: promo, error } = await supabase
      .from('promotional_posts')
      .select('*')
      .eq('id', id)
      .single()
    if (error || !promo) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

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

    if (!result.ok) {
      return NextResponse.json(
        { error: result.detail || 'Google rejected the post' },
        { status: 502 },
      )
    }

    const now = new Date().toISOString()
    await supabase
      .from('promotional_posts')
      .update({ social_posted_at: now, last_reposted_at: now })
      .eq('id', id)

    return NextResponse.json({ ok: true, detail: result.detail })
  } catch (err) {
    if (isAuthError(err)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[promotional-posts POST publish]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to post' },
      { status: 500 },
    )
  }
}
