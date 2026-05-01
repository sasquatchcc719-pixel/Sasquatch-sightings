import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { syncBatchInvoiceToQuickBooks } from '@/lib/quickbooks-api'
import { createAdminClient } from '@/supabase/server'

/**
 * POST /api/admin/ops/recurring/generate-monthly-invoice
 *
 * Consolidates ALL completed batch_monthly visits for a single customer,
 * then immediately sends that invoice to QuickBooks.
 *
 * Body: { customerId: string, month: string }   month = "YYYY-MM-01"
 */
export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const body = await request.json()
    const { customerId, month } = body as {
      customerId: string
      month: string
    }

    if (!customerId || !month) {
      return NextResponse.json(
        { error: 'customerId and month are required' },
        { status: 400 },
      )
    }

    const monthStart = month.slice(0, 7) + '-01'
    const [year, mon] = month.slice(0, 7).split('-').map(Number)
    const monthEnd = new Date(year, mon, 0)
    const monthEndStr = `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}`

    // Prevent duplicates: check if a batch invoice already exists for this customer + month
    const { data: existingBatch } = await supabase
      .from('ops_batch_invoices')
      .select('id, quickbooks_invoice_id, sync_status')
      .eq('customer_id', customerId)
      .eq('month', monthStart)
      .maybeSingle()

    if (existingBatch) {
      if (!existingBatch.quickbooks_invoice_id) {
        try {
          const quickbooksInvoiceId = await syncBatchInvoiceToQuickBooks(
            existingBatch.id,
          )
          return NextResponse.json({
            batchInvoiceId: existingBatch.id,
            quickbooksInvoiceId,
            retried: true,
          })
        } catch (syncErr) {
          await supabase
            .from('ops_batch_invoices')
            .update({
              sync_status: 'failed',
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingBatch.id)

          const msg =
            syncErr instanceof Error
              ? syncErr.message
              : 'Failed to send invoice to QuickBooks'
          return NextResponse.json({ error: msg }, { status: 500 })
        }
      }

      return NextResponse.json(
        {
          error:
            'A batch invoice already exists for this customer and month and has already been sent to QuickBooks',
        },
        { status: 409 },
      )
    }

    // Find all batch_monthly templates for this customer
    const { data: templates } = await supabase
      .from('ops_recurring_templates')
      .select('id')
      .eq('customer_id', customerId)
      .eq('invoice_mode', 'batch_monthly')
      .eq('is_active', true)

    const templateIds = (templates || []).map((t) => t.id)

    const apptSelect = `id, appointment_date, quoted_total,
         ops_appointment_line_items (
           name_snapshot, notes, quantity, unit_price, line_total
         )`

    // Load completed appointments from recurring templates
    const { data: recurringAppts } =
      templateIds.length > 0
        ? await supabase
            .from('ops_appointments')
            .select(apptSelect)
            .in('recurring_template_id', templateIds)
            .eq('status', 'completed')
            .gte('appointment_date', monthStart)
            .lte('appointment_date', monthEndStr)
            .order('appointment_date')
        : { data: [] as never[] }

    // Load completed one-off appointments tagged for batch billing
    const { data: adHocAppts } = await supabase
      .from('ops_appointments')
      .select(apptSelect)
      .eq('batch_billing_customer_id', customerId)
      .is('recurring_template_id', null)
      .eq('status', 'completed')
      .gte('appointment_date', monthStart)
      .lte('appointment_date', monthEndStr)
      .order('appointment_date')

    // Merge and deduplicate
    const seenIds = new Set<string>()
    const appointments = [
      ...(recurringAppts || []),
      ...(adHocAppts || []),
    ].filter((a) => {
      if (seenIds.has(a.id)) return false
      seenIds.add(a.id)
      return true
    })

    if (appointments.length === 0) {
      return NextResponse.json(
        { error: 'No completed appointments found for this month' },
        { status: 400 },
      )
    }

    // Build entries and compute totals
    let subtotal = 0
    const entries: {
      appointmentId: string
      lineItemsSnapshot: unknown[]
      apptSubtotal: number
    }[] = []

    for (const appt of appointments) {
      const lines = Array.isArray(appt.ops_appointment_line_items)
        ? appt.ops_appointment_line_items
        : []
      const apptSubtotal = lines.reduce(
        (s: number, l: { line_total: number }) => s + Number(l.line_total),
        0,
      )
      subtotal += apptSubtotal
      entries.push({
        appointmentId: appt.id,
        lineItemsSnapshot: lines,
        apptSubtotal,
      })
    }

    const total = Math.max(0, subtotal)

    // Create ONE batch invoice for the customer (template_id = null since it spans multiple)
    const { data: batchInvoice, error: biErr } = await supabase
      .from('ops_batch_invoices')
      .insert({
        template_id: null,
        customer_id: customerId,
        month: monthStart,
        status: 'ready',
        subtotal: Number(subtotal.toFixed(2)),
        total: Number(total.toFixed(2)),
        sync_status: 'pending',
      })
      .select('id')
      .single()

    if (biErr || !batchInvoice) {
      return NextResponse.json(
        { error: biErr?.message || 'Failed to create batch invoice' },
        { status: 500 },
      )
    }

    // Create entry rows linking each appointment to the batch invoice
    const entryPayload = entries.map((e) => ({
      batch_invoice_id: batchInvoice.id,
      appointment_id: e.appointmentId,
      line_items_snapshot: e.lineItemsSnapshot,
      subtotal: Number(e.apptSubtotal.toFixed(2)),
    }))

    const { error: entryErr } = await supabase
      .from('ops_batch_invoice_entries')
      .insert(entryPayload)

    if (entryErr) {
      await supabase
        .from('ops_batch_invoices')
        .delete()
        .eq('id', batchInvoice.id)

      return NextResponse.json(
        { error: entryErr.message || 'Failed to create batch invoice entries' },
        { status: 500 },
      )
    }

    let quickbooksInvoiceId: string
    try {
      quickbooksInvoiceId = await syncBatchInvoiceToQuickBooks(batchInvoice.id)
    } catch (syncErr) {
      await supabase
        .from('ops_batch_invoices')
        .update({
          sync_status: 'failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', batchInvoice.id)

      const msg =
        syncErr instanceof Error
          ? syncErr.message
          : 'Failed to send invoice to QuickBooks'
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    return NextResponse.json({
      batchInvoiceId: batchInvoice.id,
      appointmentCount: appointments.length,
      subtotal: Number(subtotal.toFixed(2)),
      total: Number(total.toFixed(2)),
      quickbooksInvoiceId,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
