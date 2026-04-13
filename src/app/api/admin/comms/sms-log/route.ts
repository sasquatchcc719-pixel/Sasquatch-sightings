import { NextRequest, NextResponse } from 'next/server'
import { getUserWithRole, hasRoleAccess } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/** Outbound Operations / lifecycle SMS (Twilio), stored in sms_logs with message_type ops_* */
export async function GET(request: NextRequest) {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || !hasRoleAccess(role, ['admin', 'owner'])) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(Number(searchParams.get('limit') || 50), 200)
    const offset = Number(searchParams.get('offset') || 0)

    const supabase = createAdminClient()

    const { data, error, count } = await supabase
      .from('sms_logs')
      .select(
        `
        id,
        recipient_phone,
        message_type,
        message_content,
        status,
        twilio_sid,
        sent_at
      `,
        { count: 'exact' },
      )
      .like('message_type', 'ops_%')
      .order('sent_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error

    return NextResponse.json({ messages: data || [], total: count || 0 })
  } catch (error) {
    console.error('[comms/sms-log] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
