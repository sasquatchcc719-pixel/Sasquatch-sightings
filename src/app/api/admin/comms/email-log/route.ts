import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'marketing'])

    const { searchParams } = new URL(request.url)
    const limit = Math.min(Number(searchParams.get('limit') || 50), 200)
    const offset = Number(searchParams.get('offset') || 0)
    const templateKey = String(searchParams.get('template_key') || '').trim()
    const status = String(searchParams.get('status') || '').trim()
    const q = String(searchParams.get('q') || '').trim()

    const supabase = createAdminClient()

    let customerIds: string[] = []
    if (q) {
      const { data: customerRows } = await supabase
        .from('ops_customers')
        .select('id')
        .ilike('full_name', `%${q}%`)
        .limit(100)
      customerIds = (customerRows || []).map((row) => row.id as string)
    }

    let query = supabase
      .from('ops_email_log')
      .select(
        `
        id,
        customer_id,
        template_key,
        to_email,
        subject,
        body_text,
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

    if (templateKey) query = query.eq('template_key', templateKey)
    if (status === 'sent' || status === 'failed')
      query = query.eq('status', status)
    if (q) {
      const escaped = q.replace(/[,%]/g, ' ').trim()
      const filterParts = [
        `to_email.ilike.%${escaped}%`,
        `subject.ilike.%${escaped}%`,
      ]
      if (customerIds.length > 0) {
        const idList = customerIds.join(',')
        filterParts.push(`customer_id.in.(${idList})`)
      }
      query = query.or(filterParts.join(','))
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1)

    if (error) throw error

    return NextResponse.json({ emails: data || [], total: count || 0 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[comms/email-log] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
