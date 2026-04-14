import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner'])
  } catch {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  const [templatesResult, enrollmentsResult, logResult] = await Promise.all([
    supabase.from('drip_email_templates').select('*').order('step_index'),
    supabase
      .from('drip_campaign_enrollments')
      .select(
        `
        id, customer_id, appointment_id, enrolled_at,
        current_step, next_send_at, status, created_at,
        ops_customers(full_name, email),
        ops_appointments(appointment_date)
      `,
      )
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('drip_email_log')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(200),
  ])

  return NextResponse.json({
    templates: templatesResult.data || [],
    enrollments: enrollmentsResult.data || [],
    log: logResult.data || [],
    stats: {
      active: (enrollmentsResult.data || []).filter(
        (e) => e.status === 'active',
      ).length,
      completed: (enrollmentsResult.data || []).filter(
        (e) => e.status === 'completed',
      ).length,
      unsubscribed: (enrollmentsResult.data || []).filter(
        (e) => e.status === 'unsubscribed',
      ).length,
      totalEmails: (logResult.data || []).filter((l) => l.status === 'sent')
        .length,
    },
  })
}

export async function PUT(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
  } catch {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  }

  const body = await request.json()
  const { id, label, delay_days, subject_template, body_template, is_enabled } =
    body

  if (!id) {
    return NextResponse.json({ error: 'Missing template id' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (label !== undefined) updatePayload.label = label
  if (delay_days !== undefined) updatePayload.delay_days = Number(delay_days)
  if (subject_template !== undefined)
    updatePayload.subject_template = subject_template
  if (body_template !== undefined) updatePayload.body_template = body_template
  if (is_enabled !== undefined) updatePayload.is_enabled = Boolean(is_enabled)

  const { data, error } = await supabase
    .from('drip_email_templates')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ template: data })
}
