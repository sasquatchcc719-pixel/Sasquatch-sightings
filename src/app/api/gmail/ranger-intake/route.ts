import { NextRequest, NextResponse } from 'next/server'
import { createRangerApplicantFromIntake } from '@/lib/ranger/applicants'
import { createAdminClient } from '@/supabase/server'

function verifySecret(request: NextRequest): boolean {
  const expected = process.env.RANGER_GMAIL_INTAKE_SECRET
  if (!expected) return false
  return request.headers.get('x-ranger-intake-secret') === expected
}

export async function POST(request: NextRequest) {
  try {
    if (!verifySecret(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await request.json()
    const supabase = createAdminClient()
    const result = await createRangerApplicantFromIntake({
      supabase,
      messageId: payload.messageId,
      actor: 'ranger',
      auditEventType: 'gmail_intake_created',
      auditSummary: 'Ranger applicant created from Gmail intake webhook.',
      intake: {
        source: payload.source || 'craigslist',
        sourceThreadId: payload.threadId,
        subject: payload.subject,
        body: payload.body || '',
        fromEmail: payload.fromEmail,
        fromName: payload.fromName,
        phone: payload.phone,
      },
    })

    return NextResponse.json({
      ok: true,
      duplicate: result.duplicate,
      applicant_id: result.applicant?.id,
    })
  } catch (error) {
    console.error('[gmail/ranger-intake] Error:', error)
    return NextResponse.json(
      { error: 'Failed to process Ranger Gmail intake' },
      { status: 500 },
    )
  }
}
