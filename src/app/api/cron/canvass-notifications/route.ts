import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { DAVID_CANVASS_USER_ID } from '@/lib/gps/canvassAutoStop'
import { deliverDavidCanvassNotifications } from '@/lib/gps/canvassNotifications'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('canvass_sessions')
    .select('id')
    .eq('user_id', DAVID_CANVASS_USER_ID)
    .in('status', ['active', 'completed'])
    .or(
      'start_telegram_notified_at.is.null,and(status.eq.completed,stop_telegram_notified_at.is.null)',
    )
    .order('started_at', { ascending: true })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  let pending = 0
  for (const walk of data ?? []) {
    if (!(await deliverDavidCanvassNotifications(supabase, walk.id))) pending++
  }
  return NextResponse.json({ processed: data?.length ?? 0, pending })
}
