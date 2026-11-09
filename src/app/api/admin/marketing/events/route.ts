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
import { seoChangeSchema } from '@/lib/seo/change-ledger'

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
        'id, occurred_at, category, title, detail, town_slugs, source, external_ref, campaign_id, seo_change, seo_revision',
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
    const status =
      message === 'Not authorized' || /unauthor|forbidden|role/i.test(message)
        ? 403
        : 500
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
      seo_change?: unknown
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

    const parsedChange =
      body.seo_change == null
        ? null
        : seoChangeSchema.safeParse(body.seo_change)
    if (parsedChange && !parsedChange.success) {
      return NextResponse.json(
        {
          error: 'Invalid SEO change evidence',
          issues: parsedChange.error.issues,
        },
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
      ...(parsedChange?.success ? { seo_change: parsedChange.data } : {}),
    })
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to create event'
    const status =
      message === 'Not authorized' || /unauthor|forbidden|role/i.test(message)
        ? 403
        : 500
    console.error('[marketing events POST]', err)
    return NextResponse.json({ error: message }, { status })
  }
}

/** Revision-checked edits preserve all unrelated event fields. */
export async function PATCH(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'marketing'])
    const body = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json(
        { error: 'Expected a change object' },
        { status: 400 },
      )
    const change = seoChangeSchema.safeParse(body.seo_change)
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        body.id ?? '',
      ) ||
      !Number.isSafeInteger(body.expected_revision) ||
      body.expected_revision < 0 ||
      body.expected_revision >= 2147483647 ||
      !change.success ||
      (body.title !== undefined &&
        (typeof body.title !== 'string' || !body.title.trim()))
    ) {
      return NextResponse.json(
        { error: 'Invalid change or revision' },
        { status: 400 },
      )
    }
    const { data, error } = await createAdminClient()
      .from('marketing_events')
      .update({
        seo_change: change.data,
        seo_revision: body.expected_revision + 1,
        ...(body.title !== undefined
          ? { title: body.title.trim().slice(0, 300) }
          : {}),
      })
      .eq('id', body.id)
      .eq('seo_revision', body.expected_revision)
      .select('id,seo_revision')
      .maybeSingle()
    if (error) throw error
    if (!data)
      return NextResponse.json(
        { error: 'Record changed or is unavailable. Reload before editing.' },
        { status: 409 },
      )
    return NextResponse.json({ ok: true, event: data })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    const status =
      message === 'Not authorized' || /unauthor|forbidden|role/i.test(message)
        ? 403
        : err instanceof SyntaxError
          ? 400
          : 500
    console.error('[marketing events PATCH]', err)
    return NextResponse.json(
      {
        error:
          status === 403 ? 'Not authorized' : 'Could not save change evidence',
      },
      { status },
    )
  }
}
