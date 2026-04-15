import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  buildQuickBooksCustomerPayload,
  buildQuickBooksInvoicePayload,
  getQuickBooksSyncStatus,
} from '@/lib/quickbooks'

/**
 * POST /api/admin/ops/recurring/generate-monthly-invoice
 *
 * Consolidates ALL completed batch_monthly visits for a single customer
 * in a given month into one ops_batch_invoices row + one QB sync job.
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
      .select('id')
      .eq('customer_id', customerId)
      .eq('month', monthStart)
      .maybeSingle()

    if (existingBatch) {
      return NextResponse.json(
        { error: 'A batch invoice already exists for this customer and month' },
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
    const syncStatus = getQuickBooksSyncStatus()

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
        sync_status: syncStatus,
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

    await supabase.from('ops_batch_invoice_entries').insert(entryPayload)

    // Build QB line items — each line includes the date for context
    const qbLineItems = appointments.flatMap((appt) => {
      const lines = Array.isArray(appt.ops_appointment_line_items)
        ? appt.ops_appointment_line_items
        : []
      const dateObj = new Date(appt.appointment_date + 'T12:00:00')
      const datePrefix = dateObj.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })

      return lines.map(
        (l: {
          name_snapshot: string
          notes?: string | null
          quantity: number
          unit_price: number
          line_total: number
        }) => ({
          description: `${datePrefix} — ${l.notes || l.name_snapshot}`,
          quantity: l.quantity,
          unit_price: l.unit_price,
          line_total: Number(l.line_total),
        }),
      )
    })

    // Fetch customer details for the QB customer sync job
    const { data: customer } = await supabase
      .from('ops_customers')
      .select('full_name, email, phone')
      .eq('id', customerId)
      .single()

    const { data: address } = await supabase
      .from('ops_service_addresses')
      .select('street_1, street_2, city, state, zip_code')
      .eq('customer_id', customerId)
      .limit(1)
      .maybeSingle()

    // Queue QB sync jobs: customer (ensure exists) + batch_invoice
    const syncJobs: Array<{
      entity_type: string
      entity_id: string
      status: string
      payload: Record<string, unknown>
    }> = []

    if (customer && address) {
      syncJobs.push({
        entity_type: 'customer',
        entity_id: customerId,
        status: syncStatus,
        payload: buildQuickBooksCustomerPayload({
          customerId,
          fullName: customer.full_name,
          email: customer.email,
          phone: customer.phone,
          address: {
            street_1: address.street_1,
            street_2: address.street_2,
            city: address.city,
            state: address.state,
            zip_code: address.zip_code,
          },
        }),
      })
    }

    syncJobs.push({
      entity_type: 'batch_invoice',
      entity_id: batchInvoice.id,
      status: syncStatus,
      payload: buildQuickBooksInvoicePayload({
        invoiceId: batchInvoice.id,
        customerId,
        serviceDate: monthStart,
        subtotal,
        total,
        lineItems: qbLineItems,
      }),
    })

    await supabase.from('ops_quickbooks_sync_jobs').insert(syncJobs)

    return NextResponse.json({
      batchInvoiceId: batchInvoice.id,
      appointmentCount: appointments.length,
      subtotal: Number(subtotal.toFixed(2)),
      total: Number(total.toFixed(2)),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
