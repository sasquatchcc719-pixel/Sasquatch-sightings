import { NextRequest, NextResponse } from 'next/server'
import { getUserWithRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(Number(searchParams.get('limit') || 50), 200)
    const offset = Number(searchParams.get('offset') || 0)

    const supabase = createAdminClient()

    const { data, error, count } = await supabase
      .from('ops_email_log')
      .select(
        `
        id,
        template_key,
        to_email,
        subject,
        status,
        error_message,
        resend_id,
        sent_at,
        ops_customers ( full_name ),
        ops_appointments ( appointment_date )
      `,
        { count: 'exact' },
      )
      .order('sent_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error

    return NextResponse.json({ emails: data || [], total: count || 0 })
  } catch (error) {
    console.error('[comms/email-log] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
