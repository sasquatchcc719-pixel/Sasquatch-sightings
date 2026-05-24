/**
 * Send push notification to selected audiences. One OneSignal notification per audience.
 * POST /api/admin/push/send
 * Body: { title: string, body: string, audiences: ('admin'|'business_card'|'vendor'|'contest')[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import {
  sendOneSignalToAudience,
  getOneSignalMessageStats,
  type PushAudience,
} from '@/lib/onesignal'
import { getUserWithRole } from '@/lib/auth'

const VALID_AUDIENCES: PushAudience[] = [
  'admin',
  'business_card',
  'vendor',
  'contest',
]

function isValidAudience(a: string): a is PushAudience {
  return VALID_AUDIENCES.includes(a as PushAudience)
}

export async function POST(request: NextRequest) {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || (role !== 'admin' && role !== 'owner')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      title,
      body: content,
      audiences,
    } = body as {
      title?: string
      body?: string
      audiences?: string[]
    }

    if (!title || typeof title !== 'string') {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }
    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: 'body is required' }, { status: 400 })
    }
    const list = Array.isArray(audiences)
      ? audiences.filter(isValidAudience)
      : []
    if (list.length === 0) {
      return NextResponse.json(
        {
          error:
            'At least one audience is required (admin, business_card, vendor, contest)',
        },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    const results: Array<{
      audience: string
      message_id: string
      delivered: number
      opened: number
    }> = []

    for (const audience of list) {
      const sendResult = await sendOneSignalToAudience(
        audience as PushAudience,
        title,
        content,
      )
      if (!sendResult?.id) {
        continue
      }
      const { data: row, error: insertError } = await supabase
        .from('push_sends')
        .insert({
          message_id: sendResult.id,
          audience,
          title,
          sent_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (insertError) {
        console.error('[Push send] Insert error:', insertError)
      }

      await new Promise((r) => setTimeout(r, 800))
      const stats = await getOneSignalMessageStats(sendResult.id)
      if (stats && row?.id) {
        await supabase
          .from('push_sends')
          .update({
            delivered: stats.successful,
            received: stats.received,
            opened: stats.converted,
            failed: stats.failed,
            errored: stats.errored,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id)
        results.push({
          audience,
          message_id: sendResult.id,
          delivered: stats.successful,
          opened: stats.converted,
        })
      } else {
        results.push({
          audience,
          message_id: sendResult.id,
          delivered: 0,
          opened: 0,
        })
      }
    }

    return NextResponse.json({ success: true, results })
  } catch (error) {
    console.error('[Push send] Error:', error)
    return NextResponse.json(
      { error: 'Failed to send push notifications' },
      { status: 500 },
    )
  }
}
