import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export type CustomerEmailEntry = {
  source: 'reactivation' | 'drip' | 'transactional'
  subject: string | null
  to_email: string | null
  status: string | null
  sent_at: string | null
  template: string | null
}

/**
 * Unified email history for one customer across every sender:
 * reactivation campaign, post-job drip, and transactional ops emails.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const customerId = request.nextUrl.searchParams.get('customerId') || ''
    // Synthetic keys (ext:/hcp:/qb:) come from historical imports and have
    // no ops customer row — nothing was ever emailed through this system.
    if (!customerId || customerId.includes(':')) {
      return NextResponse.json({ emails: [], counts: {} })
    }

    const supabase = createAdminClient()

    const [reactRes, opsRes, dripEnrollRes] = await Promise.all([
      supabase
        .from('reactivation_email_log')
        .select('subject, to_email, status, sent_at, template_key, event_type')
        .eq('customer_id', customerId),
      supabase
        .from('ops_email_log')
        .select('subject, to_email, status, sent_at, template_key')
        .eq('customer_id', customerId),
      supabase
        .from('drip_campaign_enrollments')
        .select('id')
        .eq('customer_id', customerId),
    ])

    const dripEnrollmentIds = (dripEnrollRes.data || []).map((r) => r.id)
    const dripRes =
      dripEnrollmentIds.length > 0
        ? await supabase
            .from('drip_email_log')
            .select('subject, to_email, status, sent_at, template_label')
            .in('enrollment_id', dripEnrollmentIds)
        : { data: [] }

    const emails: CustomerEmailEntry[] = [
      ...(reactRes.data || [])
        .filter((r) => r.event_type === 'sent' || r.event_type === 'failed')
        .map((r) => ({
          source: 'reactivation' as const,
          subject: r.subject,
          to_email: r.to_email,
          status: r.status,
          sent_at: r.sent_at,
          template: r.template_key,
        })),
      ...(opsRes.data || []).map((r) => ({
        source: 'transactional' as const,
        subject: r.subject,
        to_email: r.to_email,
        status: r.status,
        sent_at: r.sent_at,
        template: r.template_key,
      })),
      ...(dripRes.data || []).map((r) => ({
        source: 'drip' as const,
        subject: r.subject,
        to_email: r.to_email,
        status: r.status,
        sent_at: r.sent_at,
        template: r.template_label,
      })),
    ].sort((a, b) =>
      String(b.sent_at || '').localeCompare(String(a.sent_at || '')),
    )

    const counts: Record<string, number> = {}
    for (const e of emails) counts[e.source] = (counts[e.source] || 0) + 1

    return NextResponse.json({ emails, counts })
  } catch (err) {
    console.error('[stats/customer-emails]', err)
    const message = err instanceof Error ? err.message : 'Failed to load'
    if (message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
