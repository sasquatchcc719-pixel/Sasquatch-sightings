import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export type EmailSource = 'jobs' | 'reactivation' | 'drip'

type NormalizedEmail = {
  id: string
  source: EmailSource
  customer_id: string | null
  template_key: string | null
  to_email: string | null
  subject: string | null
  body_text: string | null
  status: string | null
  error_message: string | null
  resend_id: string | null
  sent_at: string | null
  ops_customers: { full_name: string | null } | null
  ops_appointments: { appointment_date: string | null } | null
}

/**
 * Unified outbox: transactional job emails, reactivation sends (including
 * the one-off June 2026 bulk blast), and post-job drip emails. Volumes are
 * small (~1k rows total), so we merge in memory and paginate the result.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'marketing'])

    const { searchParams } = new URL(request.url)
    const limit = Math.min(Number(searchParams.get('limit') || 50), 200)
    const offset = Number(searchParams.get('offset') || 0)
    const templateKey = String(searchParams.get('template_key') || '').trim()
    const status = String(searchParams.get('status') || '').trim()
    const q = String(searchParams.get('q') || '')
      .trim()
      .toLowerCase()
    const source = String(searchParams.get('source') || 'all').trim()

    const supabase = createAdminClient()
    const PER_TABLE_CAP = 1500
    const rows: NormalizedEmail[] = []

    if (source === 'all' || source === 'jobs') {
      const { data, error } = await supabase
        .from('ops_email_log')
        .select(
          `
          id, customer_id, template_key, to_email, subject, body_text,
          status, error_message, resend_id, sent_at,
          ops_customers ( full_name ),
          ops_appointments ( appointment_date )
        `,
        )
        .order('sent_at', { ascending: false })
        .limit(PER_TABLE_CAP)
      if (error) throw error
      for (const r of data || []) {
        rows.push({
          ...(r as unknown as Omit<NormalizedEmail, 'source'>),
          ops_customers: Array.isArray(r.ops_customers)
            ? r.ops_customers[0] || null
            : r.ops_customers,
          ops_appointments: Array.isArray(r.ops_appointments)
            ? r.ops_appointments[0] || null
            : r.ops_appointments,
          source: 'jobs',
        })
      }
    }

    if (source === 'all' || source === 'reactivation') {
      const { data, error } = await supabase
        .from('reactivation_email_log')
        .select(
          `
          id, customer_id, template_key, to_email, subject, body_text,
          status, error_message, resend_id, sent_at, event_type,
          ops_customers ( full_name )
        `,
        )
        // 'sent' = automated engine, 'email' = the one-off bulk blast.
        .in('event_type', ['sent', 'email', 'failed'])
        .order('sent_at', { ascending: false })
        .limit(PER_TABLE_CAP)
      if (error) throw error
      for (const r of data || []) {
        rows.push({
          id: String(r.id),
          source: 'reactivation',
          customer_id: r.customer_id,
          template_key: r.template_key,
          to_email: r.to_email,
          subject: r.subject,
          body_text: r.body_text,
          status: r.status,
          error_message: r.error_message,
          resend_id: r.resend_id,
          sent_at: r.sent_at,
          ops_customers: Array.isArray(r.ops_customers)
            ? r.ops_customers[0] || null
            : r.ops_customers,
          ops_appointments: null,
        })
      }
    }

    if (source === 'all' || source === 'drip') {
      const { data, error } = await supabase
        .from('drip_email_log')
        .select(
          `
          id, template_label, to_email, subject, status, error_message,
          resend_id, sent_at,
          drip_campaign_enrollments (
            customer_id,
            ops_customers ( full_name )
          )
        `,
        )
        .order('sent_at', { ascending: false })
        .limit(PER_TABLE_CAP)
      if (error) throw error
      for (const r of data || []) {
        const enrollment = Array.isArray(r.drip_campaign_enrollments)
          ? r.drip_campaign_enrollments[0]
          : r.drip_campaign_enrollments
        const cust = Array.isArray(enrollment?.ops_customers)
          ? enrollment.ops_customers[0] || null
          : (enrollment?.ops_customers ?? null)
        rows.push({
          id: String(r.id),
          source: 'drip',
          customer_id: enrollment?.customer_id ?? null,
          template_key: r.template_label,
          to_email: r.to_email,
          subject: r.subject,
          body_text: null,
          status: r.status,
          error_message: r.error_message,
          resend_id: r.resend_id,
          sent_at: r.sent_at,
          ops_customers: cust,
          ops_appointments: null,
        })
      }
    }

    let filtered = rows
    if (templateKey) {
      filtered = filtered.filter((r) => r.template_key === templateKey)
    }
    if (status === 'sent' || status === 'failed') {
      filtered = filtered.filter((r) => r.status === status)
    }
    if (q) {
      filtered = filtered.filter(
        (r) =>
          (r.to_email || '').toLowerCase().includes(q) ||
          (r.subject || '').toLowerCase().includes(q) ||
          (r.ops_customers?.full_name || '').toLowerCase().includes(q),
      )
    }

    filtered.sort((a, b) =>
      String(b.sent_at || '').localeCompare(String(a.sent_at || '')),
    )

    return NextResponse.json({
      emails: filtered.slice(offset, offset + limit),
      total: filtered.length,
    })
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
