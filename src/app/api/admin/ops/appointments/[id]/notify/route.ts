import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { sendOpsLifecycleCommunications } from '@/lib/ops/communications'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const { id } = await params
    const body = await request.json()
    const event = body.event as string

    const allowedEvents = ['job_rescheduled', 'on_my_way', 'job_finished']
    if (!event || !allowedEvents.includes(event)) {
      return NextResponse.json({ error: 'Invalid event type' }, { status: 400 })
    }

    await sendOpsLifecycleCommunications({
      event: event as 'job_rescheduled' | 'on_my_way' | 'job_finished',
      appointmentId: id,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[ops/appointments/:id/notify] Error:', error)
    return NextResponse.json(
      { error: 'Failed to send notification' },
      { status: 500 },
    )
  }
}
