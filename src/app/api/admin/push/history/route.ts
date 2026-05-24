/**
 * List push send history with optional date range and category filters.
 * GET /api/admin/push/history?days=30&audience=business_card
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'

const VALID_AUDIENCES = ['admin', 'business_card', 'vendor', 'contest']

export async function GET(request: NextRequest) {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || (role !== 'admin' && role !== 'owner')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const daysParam = searchParams.get('days')
    const audience = searchParams.get('audience')

    const days = daysParam
      ? Math.min(365, Math.max(1, parseInt(daysParam, 10) || 30))
      : 30
    const since = new Date()
    since.setDate(since.getDate() - days)

    const supabase = createAdminClient()
    let query = supabase
      .from('push_sends')
      .select(
        'id, message_id, audience, title, sent_at, delivered, received, opened, failed, errored',
      )
      .gte('sent_at', since.toISOString())
      .order('sent_at', { ascending: false })
      .limit(200)

    if (audience && VALID_AUDIENCES.includes(audience)) {
      query = query.eq('audience', audience)
    }

    const { data, error } = await query

    if (error) {
      console.error('[Push history] Error:', error)
      return NextResponse.json(
        { error: 'Failed to fetch history' },
        { status: 500 },
      )
    }

    const list = (data ?? []).map((row) => ({
      id: row.id,
      message_id: row.message_id,
      audience: row.audience,
      title: row.title,
      sent_at: row.sent_at,
      delivered: row.delivered ?? 0,
      received: row.received ?? 0,
      opened: row.opened ?? 0,
      failed: row.failed ?? 0,
      errored: row.errored ?? 0,
      open_rate:
        (row.delivered ?? 0) > 0
          ? Math.round(((row.opened ?? 0) / (row.delivered ?? 1)) * 100)
          : null,
    }))

    return NextResponse.json({ list, days, audience: audience || null })
  } catch (error) {
    console.error('[Push history] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
