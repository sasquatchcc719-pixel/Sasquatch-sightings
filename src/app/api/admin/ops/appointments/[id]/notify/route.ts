import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import {
  sendOpsLifecycleCommunications,
  OpsLifecycleEvent,
} from '@/lib/ops/communications'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const { id } = await params
    const body = (await request.json()) as { event: OpsLifecycleEvent }
    const { event } = body

    if (!event) {
      return NextResponse.json({ error: 'Missing event' }, { status: 400 })
    }

    await sendOpsLifecycleCommunications({ event, appointmentId: id })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[ops/appointments/:id/notify][POST] Error:', error)
    return NextResponse.json(
      { error: 'Failed to send notification' },
      { status: 500 },
    )
  }
}
