/**
 * Marketing timeline events — list and create.
 *
 * These overlay onto rank and revenue charts so a change in the numbers can be
 * lined up against what was actually done. The 'instrument' category is the one
 * that earns the table: changes to how we measure look identical to real
 * movement, and mistaking one for the other is expensive.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

const EVENT_CATEGORIES = [
  'instrument',
  'gbp',
  'website',
  'marketing',
  'reviews',
  'competitor',
  'external',
] as const

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'marketing'])
    const supabase = createAdminClient()

    const since = request.nextUrl.searchParams.get('since')
    const category = request.nextUrl.searchParams.get('category')

    let q = supabase
      .from('marketing_events')
      .select(
        'id, occurred_at, category, title, detail, town_slugs, source, external_ref, campaign_id',
      )
      .order('occurred_at', { ascending: false })
      .limit(300)
    if (since) q = q.gte('occurred_at', since)
    if (category) q = q.eq('category', category)

    const { data, error } = await q
    if (error) throw error
    return NextResponse.json({ ok: true, events: data ?? [] })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load events'
    const status = (message === 'Not authorized' || /unauthor|forbidden|role/i.test(message)) ? 403 : 500
    console.error('[marketing events GET]', err)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'marketing'])
    const body = (await request.json()) as {
      occurred_at?: string
      category?: string
      title?: string
      detail?: string
      town_slugs?: string[]
      external_ref?: string
      campaign_id?: string
    }

    if (!body.title?.trim()) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }
    const category = String(body.category || '')
    if (!(EVENT_CATEGORIES as readonly string[]).includes(category)) {
      return NextResponse.json(
        { error: `category must be one of ${EVENT_CATEGORIES.join(', ')}` },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    const { error } = await supabase.from('marketing_events').insert({
      occurred_at: body.occurred_at || new Date().toISOString(),
      category,
      title: body.title.trim().slice(0, 300),
      detail: body.detail?.slice(0, 2000) || null,
      town_slugs: body.town_slugs ?? [],
      source: 'manual',
      external_ref: body.external_ref?.slice(0, 200) || null,
      campaign_id: body.campaign_id || null,
    })
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create event'
    const status = (message === 'Not authorized' || /unauthor|forbidden|role/i.test(message)) ? 403 : 500
    console.error('[marketing events POST]', err)
    return NextResponse.json({ error: message }, { status })
  }
}
