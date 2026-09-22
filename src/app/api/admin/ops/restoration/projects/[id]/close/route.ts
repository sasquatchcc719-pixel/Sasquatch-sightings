import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { closeRestorationProject } from '@/lib/ops/restoration-projects'
import { ensureInvoiceQuickBooksSyncJob } from '@/lib/ops/quickbooks-sync-jobs'
import { recordRevenueFromOpsInvoice } from '@/lib/ops/revenue-from-invoice'
import { restorationLaborHours } from '@/lib/ops/restoration-labor-hours'
import { freezeRestorationReport } from '@/lib/ops/pdf/frozen-restoration-report'

/**
 * "Dry standard reached — pull equipment and close."
 *
 * Available on any monitor visit, never on the mitigation day. This is the only
 * point at which a water loss produces an invoice.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))

    const closingAppointmentId = String(body.closing_appointment_id ?? '')
    if (!closingAppointmentId) {
      return NextResponse.json(
        { error: 'closing_appointment_id is required' },
        { status: 400 },
      )
    }

    const result = await closeRestorationProject(supabase, {
      projectId: id,
      closingAppointmentId,
      userId: access.id,
      dryStandardNotes: body.dry_standard_notes ?? null,
    })

    if (!result.ok) {
      // Closing the visits and freezing the immutable PDF are deliberately
      // separate operations. If storage had a transient failure after the
      // project closed, replaying this request must finish the PDF instead of
      // leaving the loss permanently hidden from month-end billing.
      if (result.error === 'project_already_closed') {
        const { data: recoverable } = await supabase
          .from('restoration_projects')
          .select('customer_id, billing_status, billing_snapshot')
          .eq('id', id)
          .is('invoice_id', null)
          .eq('billing_status', 'not_ready')
          .not('billing_snapshot', 'is', null)
          .maybeSingle()

        if (recoverable) {
          const report = await freezeRestorationReport(supabase, {
            projectId: id,
            customerId: String(recoverable.customer_id),
          })
          const { error: readyError } = await supabase
            .from('restoration_projects')
            .update({
              billing_status: 'ready',
              updated_at: new Date().toISOString(),
            })
            .eq('id', id)
            .eq('billing_status', 'not_ready')

          if (readyError) throw readyError

          return NextResponse.json({
            ok: true,
            recovered: true,
            customerId: String(recoverable.customer_id),
            billingMode: 'monthly_consolidated',
            invoiceId: null,
            finalReport: {
              sha256: report.sha256,
              version: report.version,
            },
            revenue_recorded: false,
            quickbooks: { queued: false, reason: 'awaiting_month_end_review' },
          })
        }
      }

      const status =
        result.error === 'project_not_found' ||
        result.error === 'closing_visit_not_in_project'
          ? 404
          : result.error === 'project_already_closed' ||
              result.error === 'cannot_close_on_mitigation_day'
            ? 409
            : 500
      return NextResponse.json({ error: result.error }, { status })
    }

    if (result.billingMode === 'monthly_consolidated') {
      const report = await freezeRestorationReport(supabase, {
        projectId: id,
        customerId: result.customerId,
      })
      await supabase
        .from('restoration_projects')
        .update({
          billing_status: 'ready',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('billing_status', 'not_ready')

      return NextResponse.json({
        ...result,
        finalReport: {
          sha256: report.sha256,
          version: report.version,
        },
        revenue_recorded: false,
        quickbooks: { queued: false, reason: 'awaiting_month_end_review' },
      })
    }

    if (!result.invoiceId) {
      throw new Error('Immediate restoration close did not create an invoice')
    }

    // Hand off to the normal invoice paths. Neither failure should undo a close
    // that already succeeded, so both are reported rather than thrown.
    /**
     * The whole loss, not just the visit it was closed from.
     *
     * Runs after closeRestorationProject on purpose: the close is what marks
     * worked-but-unfinished visits completed and drops the genuinely empty
     * ones, so this sees the settled picture. It is also why the close must
     * never cancel a visit that produced work — a cancelled visit bills its
     * line items and contributes no hours, which is how a six-hour mitigation
     * day disappeared from stats.
     */
    const revenue = await recordRevenueFromOpsInvoice(supabase, {
      invoiceId: result.invoiceId,
      userId: access.id,
      hoursWorkedOverride: await restorationLaborHours(supabase, id),
    })
    const qb = await ensureInvoiceQuickBooksSyncJob(supabase, result.invoiceId)

    return NextResponse.json({
      ...result,
      revenue_recorded:
        revenue.ok && !('skipped' in revenue && revenue.skipped),
      quickbooks: qb,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to close project'
    const status = message === 'Not authorized' ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
