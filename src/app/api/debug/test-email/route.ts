import { NextRequest, NextResponse } from 'next/server'
import { getUserWithRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { Resend } from 'resend'

export async function GET(request: NextRequest) {
  const { user, role } = await getUserWithRole()
  if (!user || role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const appointmentId = searchParams.get('appointment_id')

  const results: Record<string, unknown> = {}

  // 1. Check env vars
  results.env = {
    RESEND_API_KEY: process.env.RESEND_API_KEY ? '✅ set' : '❌ missing',
    OPS_EMAIL_FROM:
      process.env.OPS_EMAIL_FROM || '❌ missing (will use fallback)',
  }

  // 2. Check templates
  const supabase = createAdminClient()
  const { data: templates, error: templatesError } = await supabase
    .from('ops_communication_templates')
    .select('template_key, channel, is_enabled')
    .in('template_key', [
      'job_scheduled_email',
      'job_finished_email',
      'satisfaction_checkin_email',
    ])

  results.templates = templatesError
    ? { error: templatesError.message }
    : templates

  // 3. If appointment_id provided, get customer email
  if (appointmentId) {
    const { data: appt } = await supabase
      .from('ops_appointments')
      .select(
        'id, ops_customers!ops_appointments_customer_id_fkey(full_name, email)',
      )
      .eq('id', appointmentId)
      .single()
    results.appointment = appt
  }

  // 4. Try sending a real test email
  const resendKey = process.env.RESEND_API_KEY
  const fromEmail =
    process.env.OPS_EMAIL_FROM ||
    'Sasquatch Carpet Cleaning <onboarding@resend.dev>'
  const toEmail = searchParams.get('to') || user.email

  if (resendKey && toEmail) {
    try {
      const resend = new Resend(resendKey)
      const sent = await resend.emails.send({
        from: fromEmail,
        to: toEmail,
        subject: 'Sasquatch Email Test',
        html: '<p>This is a test email from Sasquatch Carpet Cleaning. If you got this, emails are working!</p>',
      })
      results.test_send = {
        success: true,
        resend_id: sent.data?.id,
        error: sent.error,
      }
    } catch (err) {
      results.test_send = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  } else {
    results.test_send = {
      skipped: true,
      reason: !resendKey ? 'No RESEND_API_KEY' : 'No to email',
    }
  }

  return NextResponse.json(results, { status: 200 })
}
