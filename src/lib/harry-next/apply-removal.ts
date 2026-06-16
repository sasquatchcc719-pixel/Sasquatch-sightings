/**
 * Harry (next) — the DB write layer for a service removal.
 *
 * This is the ONLY function in slice 1 that mutates customer data, and it runs
 * exclusively AFTER the owner approves the pending action. Given an already-
 * computed, validated execution plan (see executor.ts), it:
 *   1. deletes the one targeted appointment line by id (a diff, never a rebuild),
 *   2. updates the appointment's total + end time,
 *   3. rebuilds the invoice lines FROM the surviving appointment lines so the two
 *      tables can never drift (populating the appointment_line_item_id link the
 *      old code ignored — the cause of Jamie's split-brain).
 *
 * It deliberately REFUSES to touch an invoice that carries discounts or a
 * minimum-charge adjustment, returning `needs_manual_invoice` instead of
 * guessing the new total. Not miscomputing money is the whole point.
 *
 * NOTE: this layer is verified on its first live run against a real appointment,
 * not by unit tests — we never mutate production data from a test. The pure
 * planning it consumes (executor.ts) is fully unit-tested.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExistingAppointmentLine } from './executor'

export type ApplyRemovalResult =
  | { status: 'applied'; newTotal: number; newEndTime: string }
  | { status: 'needs_manual_invoice'; reason: string }
  | { status: 'error'; reason: string }

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export async function applyServiceRemoval(
  supabase: SupabaseClient,
  params: {
    appointmentId: string
    deleteAppointmentLineItemId: string
    keptLines: ExistingAppointmentLine[]
    newQuotedTotal: number
    newEndTime: string
  },
): Promise<ApplyRemovalResult> {
  try {
    // 1) Delete the single targeted appointment line.
    const del = await supabase
      .from('ops_appointment_line_items')
      .delete()
      .eq('id', params.deleteAppointmentLineItemId)
      .eq('appointment_id', params.appointmentId) // guard: never touch another job
    if (del.error) {
      return {
        status: 'error',
        reason: `line delete failed: ${del.error.message}`,
      }
    }

    // 2) Resize the appointment to match the new total.
    const apptUpdate = await supabase
      .from('ops_appointments')
      .update({
        quoted_total: params.newQuotedTotal,
        end_time: params.newEndTime,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.appointmentId)
    if (apptUpdate.error) {
      return {
        status: 'error',
        reason: `appointment update failed: ${apptUpdate.error.message}`,
      }
    }

    // 3) Keep the invoice in lockstep — but never miscompute a discounted one.
    const { data: invoice, error: invErr } = await supabase
      .from('ops_invoices')
      .select(
        'id, discount_amount, percentage_discount_amount, percentage_discount_percent, minimum_charge_adjustment, tax_amount',
      )
      .eq('appointment_id', params.appointmentId)
      .maybeSingle()
    if (invErr) {
      return {
        status: 'error',
        reason: `invoice lookup failed: ${invErr.message}`,
      }
    }

    if (invoice) {
      const hasDiscounts =
        Number(invoice.discount_amount) !== 0 ||
        Number(invoice.percentage_discount_amount) !== 0 ||
        Number(invoice.percentage_discount_percent) !== 0 ||
        Number(invoice.minimum_charge_adjustment) !== 0
      if (hasDiscounts) {
        // The appointment + total are already corrected; we just won't risk the
        // discounted invoice math. Surface it for a human instead of guessing.
        return {
          status: 'needs_manual_invoice',
          reason:
            'Invoice carries a discount or minimum-charge adjustment; total updated on the job, invoice left for manual review.',
        }
      }

      const delLines = await supabase
        .from('ops_invoice_line_items')
        .delete()
        .eq('invoice_id', invoice.id)
      if (delLines.error) {
        return {
          status: 'error',
          reason: `invoice line delete failed: ${delLines.error.message}`,
        }
      }

      const newInvoiceLines = params.keptLines.map((line) => ({
        invoice_id: invoice.id,
        appointment_line_item_id: line.id, // the link the old code never set
        service_catalog_item_id: line.serviceCatalogItemId,
        description: line.nameSnapshot,
        quantity: line.quantity,
        unit_price: line.unitPrice,
        line_total: round2(line.unitPrice * line.quantity),
      }))

      if (newInvoiceLines.length > 0) {
        const insLines = await supabase
          .from('ops_invoice_line_items')
          .insert(newInvoiceLines)
        if (insLines.error) {
          return {
            status: 'error',
            reason: `invoice line insert failed: ${insLines.error.message}`,
          }
        }
      }

      const tax = Number(invoice.tax_amount) || 0
      const invUpdate = await supabase
        .from('ops_invoices')
        .update({
          subtotal: params.newQuotedTotal,
          total: round2(params.newQuotedTotal + tax),
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoice.id)
      if (invUpdate.error) {
        return {
          status: 'error',
          reason: `invoice update failed: ${invUpdate.error.message}`,
        }
      }
    }

    return {
      status: 'applied',
      newTotal: params.newQuotedTotal,
      newEndTime: params.newEndTime,
    }
  } catch (error) {
    return {
      status: 'error',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}
