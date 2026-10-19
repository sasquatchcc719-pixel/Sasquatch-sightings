import type { SupabaseClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { sendTelegramNotification } from '@/lib/telegram'
import {
  CANVASS_AUTO_STOP_NOTE,
  DAVID_CANVASS_USER_ID,
} from './canvassAutoStop'

export const CANVASS_STALE_STOP_NOTE =
  'Closed when a new walk started after the previous session stopped reporting GPS.'
const CLAIM_TTL_MS = 5 * 60 * 1000
const FIELDS =
  'id, user_id, status, started_at, ended_at, distance_m, notes, start_telegram_notified_at, stop_telegram_notified_at'

type Walk = {
  id: string
  user_id: string
  status: string
  started_at: string
  ended_at: string | null
  distance_m: number | null
  notes: string | null
  start_telegram_notified_at: string | null
  stop_telegram_notified_at: string | null
}

function time(iso: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso))
}
function message(walk: Walk, event: 'start' | 'stop') {
  const lines =
    event === 'start'
      ? ['David started canvassing.', `Started: ${time(walk.started_at)}`]
      : [
          walk.notes === CANVASS_AUTO_STOP_NOTE
            ? 'David’s canvassing tracking stopped automatically.'
            : walk.notes === CANVASS_STALE_STOP_NOTE
              ? 'David’s previous canvassing session was closed.'
              : 'David stopped canvassing.',
          `Started: ${time(walk.started_at)}`,
          `Stopped: ${time(walk.ended_at!)}`,
          `Recorded duration: ${Math.max(0, Math.round((Date.parse(walk.ended_at!) - Date.parse(walk.started_at)) / 60_000))} minutes`,
          ...(walk.distance_m == null
            ? []
            : [
                `GPS distance: ${(Number(walk.distance_m) / 1609.344).toFixed(2)} mi`,
              ]),
          `Reason: ${walk.notes === CANVASS_AUTO_STOP_NOTE ? 'Movement exceeded walking limits.' : walk.notes === CANVASS_STALE_STOP_NOTE ? CANVASS_STALE_STOP_NOTE : 'Manual stop.'}`,
        ]
  lines.push('Map: https://sightings.sasquatchcarpet.com/admin/canvass')
  return lines.join('\n')
}

// Run after the response so Telegram latency never delays starting/stopping GPS.
export function queueDavidCanvassNotification(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string,
) {
  if (userId !== DAVID_CANVASS_USER_ID) return
  after(async () => {
    await deliverDavidCanvassNotifications(supabase, sessionId)
  })
}

// The cron retries failed/abandoned deliveries; API retries share these claims.
export async function deliverDavidCanvassNotifications(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<boolean> {
  try {
    const { data: walk, error } = await supabase
      .from('canvass_sessions')
      .select(FIELDS)
      .eq('id', sessionId)
      .eq('user_id', DAVID_CANVASS_USER_ID)
      .maybeSingle()
    if (error) throw error
    if (!walk) return true
    for (const event of ['start', 'stop'] as const) {
      if (event === 'stop' && (walk.status !== 'completed' || !walk.ended_at))
        continue
      const sentColumn = `${event}_telegram_notified_at` as const
      const claimColumn = `${event}_telegram_claimed_at` as const
      if (walk[sentColumn]) continue
      const claimedAt = new Date().toISOString()
      const staleBefore = new Date(Date.now() - CLAIM_TTL_MS).toISOString()
      const { data: claimed, error: claimError } = await supabase
        .from('canvass_sessions')
        .update({ [claimColumn]: claimedAt })
        .eq('id', sessionId)
        .eq('user_id', DAVID_CANVASS_USER_ID)
        .is(sentColumn, null)
        .or(`${claimColumn}.is.null,${claimColumn}.lt.${staleBefore}`)
        .select(FIELDS)
        .maybeSingle()
      if (claimError) throw claimError
      if (!claimed) return false
      const delivered = await sendTelegramNotification(
        message(claimed as Walk, event),
        { disablePreview: true },
      )
      const { error: receiptError } = await supabase
        .from('canvass_sessions')
        .update({
          [claimColumn]: null,
          ...(delivered ? { [sentColumn]: new Date().toISOString() } : {}),
        })
        .eq('id', sessionId)
        .eq(claimColumn, claimedAt)
      if (receiptError) throw receiptError
      if (!delivered) {
        console.error('[canvass-telegram] Delivery failed; queued for retry', {
          sessionId,
          event,
        })
        return false
      }
    }
    return true
  } catch (error) {
    console.error('[canvass-telegram] Delivery pending', { sessionId, error })
    return false
  }
}
