import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { recordRevenueFromOpsInvoice } from '@/lib/ops/revenue-from-invoice'
import { sendOpsLifecycleCommunications } from '@/lib/ops/communications'

type Params = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'tech',
    ])
    const supabase = createAdminClient()
    const { id: invoiceId } = await params

    let driveMinutes: number | null = null
    let markCompleted = true
    try {
      const body = await request.json()
      if (body?.drive_minutes != null) {
        const n = Number(body.drive_minutes)
        if (Number.isFinite(n)) driveMinutes = Math.max(0, Math.round(n))
      }
      if (body?.mark_completed === false) markCompleted = false
    } catch {
      /* empty body ok */
    }

    const { data: inv } = await supabase
      .from('ops_invoices')
      .select('appointment_id')
      .eq('id', invoiceId)
      .single()

    if (!inv?.appointment_id) {
      return NextResponse.json(
        { error: 'Invoice or appointment not found' },
        { status: 404 },
      )
    }

    const result = await recordRevenueFromOpsInvoice(supabase, {
      invoiceId,
      userId: access.id,
      driveMinutes,
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.error === 'Invoice not found' ? 404 : 500 },
      )
    }

    if (markCompleted) {
      const { data: appt } = await supabase
        .from('ops_appointments')
        .select('id, status, completed_at')
        .eq('id', inv.appointment_id)
        .single()

      if (appt && appt.status !== 'completed') {
        await supabase
          .from('ops_appointments')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', inv.appointment_id)
        await sendOpsLifecycleCommunications({
          event: 'job_finished',
          appointmentId: inv.appointment_id,
        })
      } else if (appt && !appt.completed_at) {
        await supabase
          .from('ops_appointments')
          .update({
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', inv.appointment_id)
      }
    }

    if (result.skipped) {
      return NextResponse.json({
        ok: true,
        already_recorded: true,
        message: 'Stats for this job were already recorded.',
      })
    }

    return NextResponse.json({
      ok: true,
      already_recorded: false,
      entry_id: result.entry_id,
    })
  } catch (err) {
    console.error('[record-stats]', err)
    const message =
      err instanceof Error ? err.message : 'Failed to record stats'
    if (message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
