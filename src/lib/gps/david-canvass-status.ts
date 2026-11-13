import type { createAdminClient } from '@/supabase/server'
import { DAVID_CANVASS_USER_ID } from './canvassAutoStop'

export async function readDavidCanvassStatus(
  db: ReturnType<typeof createAdminClient>,
  now = Date.now(),
): Promise<boolean | null> {
  const session = await db
    .from('canvass_sessions')
    .select('id,started_at')
    .eq('user_id', DAVID_CANVASS_USER_ID)
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (session.error) return null
  if (!session.data) return false

  const point = await db
    .from('canvass_points')
    .select('recorded_at')
    .eq('session_id', session.data.id)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (point.error) return null
  const lastActivity = point.data?.recorded_at ?? session.data.started_at
  return now - Date.parse(lastActivity) < 5 * 60_000
}
