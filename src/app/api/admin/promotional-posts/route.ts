import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : ''
  return msg.includes('not authorized') || msg.includes('not authenticated')
}

type Season = 'spring' | 'summer' | 'fall' | 'winter'
function seasonFor(month: number): Season {
  if (month >= 3 && month <= 5) return 'spring'
  if (month >= 6 && month <= 8) return 'summer'
  if (month >= 9 && month <= 11) return 'fall'
  return 'winter'
}

// GET — list promotional posts (newest first)
export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('promotional_posts')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, posts: data ?? [] })
  } catch (err) {
    if (isAuthError(err)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[promotional-posts GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list' },
      { status: 500 },
    )
  }
}

// POST — create an offer/event from Charles's own input (never AI-invented terms)
export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const body = (await request.json()) as {
      post_type?: string
      title?: string
      body?: string
      coupon_code?: string | null
      offer_start_date?: string | null
      offer_end_date?: string | null
      image_url?: string | null
      auto_repost?: boolean
    }

    const postType = body.post_type === 'EVENT' ? 'EVENT' : 'OFFER'
    const title = (body.title ?? '').trim()
    const summary = (body.body ?? '').trim()

    if (!title || !summary) {
      return NextResponse.json(
        { error: 'Title and description are required.' },
        { status: 400 },
      )
    }
    if (summary.length > 1500) {
      return NextResponse.json(
        { error: 'Description must be 1500 characters or fewer.' },
        { status: 400 },
      )
    }
    if (!body.offer_start_date || !body.offer_end_date) {
      return NextResponse.json(
        { error: 'Start and end dates are required for Google posts.' },
        { status: 400 },
      )
    }

    const start = new Date(body.offer_start_date)
    const month = start.getMonth() + 1
    const year = start.getFullYear()

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('promotional_posts')
      .insert({
        post_type: postType,
        season: seasonFor(month),
        year,
        month,
        quarter: Math.ceil(month / 3),
        title,
        body: summary,
        image_url: body.image_url ?? null,
        coupon_code: body.coupon_code?.trim() || null,
        offer_start_date: body.offer_start_date,
        offer_end_date: body.offer_end_date,
        auto_repost: body.auto_repost ?? false,
      })
      .select('*')
      .single()

    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, post: data })
  } catch (err) {
    if (isAuthError(err)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[promotional-posts POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create' },
      { status: 500 },
    )
  }
}
