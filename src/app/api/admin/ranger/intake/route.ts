import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { buildInitialCandidateReport } from '@/lib/ranger/reports'
import {
  buildRangerScreeningDraft,
  parseApplicantIntake,
} from '@/lib/ranger/intake'
import { createAdminClient } from '@/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const payload = await request.json()
    const parsed = parseApplicantIntake({
      source: payload.source,
      sourceThreadId: payload.sourceThreadId,
      subject: payload.subject,
      body: payload.body || '',
      fromEmail: payload.fromEmail,
      fromName: payload.fromName,
      phone: payload.phone,
    })

    const supabase = createAdminClient()
    const { data: applicant, error: applicantError } = await supabase
      .from('ranger_applicants')
      .insert({
        ...parsed,
        source: parsed.source || 'craigslist',
        last_contact_at: new Date().toISOString(),
      })
      .select('*')
      .single()

    if (applicantError) throw applicantError

    await supabase.from('ranger_messages').insert({
      applicant_id: applicant.id,
      channel: 'gmail',
      direction: 'inbound',
      subject: payload.subject || null,
      body: payload.body || '',
      external_message_id: payload.externalMessageId || null,
      status: 'logged',
      metadata: {
        fromEmail: payload.fromEmail || null,
        fromName: payload.fromName || null,
      },
    })

    if ((applicant.missing_fields || []).length > 0) {
      await supabase.from('ranger_messages').insert({
        applicant_id: applicant.id,
        channel: 'gmail',
        direction: 'outbound',
        subject: 'Quick questions about your application',
        body: buildRangerScreeningDraft(),
        status: 'draft',
        requires_approval: false,
        metadata: { generated_by: 'ranger_foundation' },
      })
    }

    const reportPayload = buildInitialCandidateReport(applicant)
    const { data: report, error: reportError } = await supabase
      .from('ranger_candidate_reports')
      .insert(reportPayload)
      .select('*')
      .single()

    if (reportError) throw reportError

    await supabase.from('ranger_audit_events').insert({
      applicant_id: applicant.id,
      actor: actor.email,
      event_type: 'manual_intake_created',
      event_summary: 'Ranger applicant created from intake payload.',
      payload: {
        source: payload.source || 'craigslist',
        recommendation: report.overall_recommendation,
      },
    })

    return NextResponse.json({ applicant, report })
  } catch (error) {
    if (error instanceof Error && error.message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[admin/ranger/intake] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create Ranger applicant' },
      { status: 500 },
    )
  }
}
