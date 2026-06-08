import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import {
  enrollEligibleReactivationCustomers,
  manualReactivationOverride,
  processReactivationEmails,
} from '@/lib/ops/reactivation-campaign'
import { createAdminClient } from '@/supabase/server'

const ADMIN_ROLES = ['admin', 'owner', 'dispatcher', 'marketing'] as const

export async function GET() {
  try {
    await requireAnyRole([...ADMIN_ROLES])
    const supabase = createAdminClient()

    const [settingsResult, templatesResult, enrollmentsResult, logResult] =
      await Promise.all([
        supabase
          .from('reactivation_settings')
          .select('*')
          .eq('id', true)
          .maybeSingle(),
        supabase
          .from('reactivation_email_templates')
          .select('*')
          .order('rotation_order', { ascending: true }),
        supabase
          .from('reactivation_campaign_enrollments')
          .select(
            `
          id,
          customer_id,
          status,
          enrollment_source,
          next_send_at,
          messages_sent,
          last_sent_at,
          latest_appointment_at,
          paused_until,
          stop_reason,
          manual_suppression_reason,
          override_notes,
          updated_at,
          ops_customers (
            full_name,
            first_name,
            email,
            phone,
            email_opt_out
          )
        `,
          )
          .order('updated_at', { ascending: false })
          .limit(200),
        supabase
          .from('reactivation_email_log')
          .select(
            `
          id,
          enrollment_id,
          customer_id,
          template_key,
          event_type,
          subject,
          to_email,
          status,
          error_message,
          sent_at,
          metadata,
          ops_customers ( full_name, email )
        `,
          )
          .order('sent_at', { ascending: false })
          .limit(50),
      ])

    if (settingsResult.error) throw settingsResult.error
    if (templatesResult.error) throw templatesResult.error
    if (enrollmentsResult.error) throw enrollmentsResult.error
    if (logResult.error) throw logResult.error

    const enrollments = enrollmentsResult.data || []
    const stats = {
      active: enrollments.filter((row) => row.status === 'active').length,
      paused_recent_booking: enrollments.filter(
        (row) => row.status === 'paused_recent_booking',
      ).length,
      suppressed_unsubscribed: enrollments.filter(
        (row) => row.status === 'suppressed_unsubscribed',
      ).length,
      suppressed_manual: enrollments.filter(
        (row) => row.status === 'suppressed_manual',
      ).length,
      excluded: enrollments.filter((row) =>
        String(row.status || '').startsWith('excluded_'),
      ).length,
      total: enrollments.length,
    }

    return NextResponse.json({
      settings: settingsResult.data,
      templates: templatesResult.data || [],
      enrollments,
      log: logResult.data || [],
      stats,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[comms/reactivation] GET error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAnyRole([...ADMIN_ROLES])
    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || '').trim()

    if (action === 'run_now') {
      const result = await processReactivationEmails()
      return NextResponse.json({ success: true, result })
    }

    if (action === 'recalculate_audience') {
      const result = await enrollEligibleReactivationCustomers()
      return NextResponse.json({ success: true, result })
    }

    if (action === 'manual_override') {
      const customerId = String(body?.customer_id || '').trim()
      const overrideAction = String(body?.override_action || '').trim()
      const reason = String(body?.reason || '').trim()

      if (
        !customerId ||
        !['pause', 'suppress', 'resume', 'unsubscribe'].includes(overrideAction)
      ) {
        return NextResponse.json(
          { error: 'Missing customer_id or valid override_action' },
          { status: 400 },
        )
      }

      await manualReactivationOverride({
        customerId,
        action: overrideAction as
          | 'pause'
          | 'suppress'
          | 'resume'
          | 'unsubscribe',
        userId: user.id,
        reason,
      })

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[comms/reactivation] POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAnyRole([...ADMIN_ROLES])
    const body = await request.json().catch(() => ({}))
    const type = String(body?.type || '').trim()
    const supabase = createAdminClient()

    if (type === 'settings') {
      const payload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      }
      for (const key of [
        'engine_enabled',
        'daily_send_cap',
        'cadence_days',
        'dormancy_months',
        'default_offer',
        'strong_offer_enabled',
        'strong_offer',
        'strong_offer_expires_at',
      ]) {
        if (body[key] !== undefined) payload[key] = body[key]
      }

      const { data, error } = await supabase
        .from('reactivation_settings')
        .update(payload)
        .eq('id', true)
        .select()
        .single()

      if (error) throw error
      return NextResponse.json({ settings: data })
    }

    if (type === 'template') {
      const id = String(body?.id || '').trim()
      if (!id) {
        return NextResponse.json(
          { error: 'Missing template id' },
          { status: 400 },
        )
      }

      const payload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      }
      for (const key of [
        'label',
        'rotation_order',
        'subject_template',
        'body_template',
        'is_enabled',
        'is_strong_offer',
      ]) {
        if (body[key] !== undefined) payload[key] = body[key]
      }

      const { data, error } = await supabase
        .from('reactivation_email_templates')
        .update(payload)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return NextResponse.json({ template: data })
    }

    return NextResponse.json({ error: 'Unknown update type' }, { status: 400 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[comms/reactivation] PUT error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    )
  }
}
