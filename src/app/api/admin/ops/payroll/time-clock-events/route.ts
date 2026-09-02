import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import {
  mountainDateKey,
  mountainLocalDateTimeToIso,
} from '@/lib/ops/timesheet-pay'
import { createAdminClient } from '@/supabase/server'

/**
 * Audit trail behind the payroll timesheets: every clock action a tech's phone
 * sent (including the ones the server rejected) for a date range.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const today = mountainDateKey(new Date())
    const startDate = searchParams.get('startDate') || today
    const endDate = searchParams.get('endDate') || startDate
    const staffUserId = searchParams.get('staffUserId')

    const startIso = mountainLocalDateTimeToIso(startDate, '00:00')
    const endIso = mountainLocalDateTimeToIso(endDate, '23:59')
    if (!startIso || !endIso || startDate > endDate) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
    }

    let query = supabase
      .from('ops_time_clock_events')
      .select(
        'id, staff_user_id, entry_id, action, result, message, client_sent_at, user_agent, ip, created_at',
      )
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: true })
      .limit(2000)

    if (staffUserId) query = query.eq('staff_user_id', staffUserId)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({
      events: (data || []).map((row) => ({
        id: row.id,
        staffUserId: row.staff_user_id,
        entryId: row.entry_id,
        action: row.action,
        result: row.result,
        message: row.message,
        clientSentAt: row.client_sent_at,
        userAgent: row.user_agent,
        ip: row.ip,
        createdAt: row.created_at,
      })),
    })
  } catch (error) {
    console.error('[payroll/time-clock-events][GET]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: 'Failed to load time clock events' },
      { status },
    )
  }
}
