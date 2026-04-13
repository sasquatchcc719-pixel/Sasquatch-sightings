import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { voidQBInvoice, createQBPayment } from '@/lib/quickbooks-api'

const INVOICE_SELECT = `
  *,
  ops_appointments (
    id,
    appointment_date,
    start_time,
    end_time,
    status,
    payment_status,
    quoted_total,
    internal_notes,
    lead_source,
    ops_customers (
      id,
      full_name,
      first_name,
      last_name,
      business_name,
      email,
      phone
    ),
    ops_service_addresses (
      id,
      label,
      street_1,
      street_2,
      city,
      state,
      zip_code,
      gate_code,
      notes
    )
  ),
  ops_invoice_line_items (
    id,
    appointment_line_item_id,
    description,
    quantity,
    unit_price,
    line_total
  )
`

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'marketing'])
    const supabase = createAdminClient()
    const { id } = await params

    const { data, error } = await supabase
      .from('ops_invoices')
      .select(INVOICE_SELECT)
      .eq('id', id)
      .single()

    if (error) throw error

    return NextResponse.json({ invoice: data })
  } catch (error) {
    console.error('[ops/invoices/:id][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load invoice' },
      { status: 500 },
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const { id } = await params
    const body = await request.json()

    const { data: current, error: currentError } = await supabase
      .from('ops_invoices')
      .select(
        `
          *,
          ops_invoice_line_items (
            id,
            appointment_line_item_id,
            description,
            quantity,
            unit_price,
            line_total
          )
        `,
      )
      .eq('id', id)
      .single()

    if (currentError) throw currentError

    const existingInvoiceLines = current.ops_invoice_line_items || []
    const existingDbIds = existingInvoiceLines.map((l: { id: string }) => l.id)
    const lineItemsInBody = Object.prototype.hasOwnProperty.call(
      body,
      'line_items',
    )
    const lineItemsPayload = Array.isArray(body.line_items)
      ? body.line_items
      : []
    const dangerousEmpty =
      lineItemsInBody &&
      lineItemsPayload.length === 0 &&
      existingDbIds.length > 0 &&
      body.clear_line_items !== true

    if (!lineItemsInBody || dangerousEmpty) {
      if (dangerousEmpty) {
        console.warn(
          '[ops/invoices/:id][PATCH] Ignored empty line_items to prevent wiping invoice lines',
        )
      }
    } else {
      const lineItems = lineItemsPayload

      const submittedRealIds = lineItems
        .map((i: { id?: string }) => String(i.id || ''))
        .filter((lid: string) => !lid.startsWith('new-') && lid.length > 0)
      const idsToDelete = existingDbIds.filter(
        (dbId: string) => !submittedRealIds.includes(dbId),
      )
      if (idsToDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from('ops_invoice_line_items')
          .delete()
          .in('id', idsToDelete)
        if (deleteError) throw deleteError
      }

      for (const item of lineItems) {
        const lineId = String(item.id || '').trim()
        const description = String(item.description || '').trim()
        const unitPrice = Number(item.unit_price || 0)
        const quantity = Number(item.quantity || 1)
        const lineTotal = Number((unitPrice * quantity).toFixed(2))

        const isNew = !lineId || lineId.startsWith('new-')

        if (isNew) {
          const { error: insertError } = await supabase
            .from('ops_invoice_line_items')
            .insert({
              invoice_id: id,
              appointment_line_item_id: null,
              description,
              quantity,
              unit_price: unitPrice,
              line_total: lineTotal,
            })
          if (insertError) throw insertError
        } else {
          const existingLine = existingInvoiceLines.find(
            (line: { id: string; appointment_line_item_id: string | null }) =>
              line.id === lineId,
          )
          if (!existingLine) continue

          const { error: invoiceLineError } = await supabase
            .from('ops_invoice_line_items')
            .update({
              description,
              quantity,
              unit_price: unitPrice,
              line_total: lineTotal,
            })
            .eq('id', lineId)
          if (invoiceLineError) throw invoiceLineError

          if (existingLine.appointment_line_item_id) {
            const { error: appointmentLineError } = await supabase
              .from('ops_appointment_line_items')
              .update({
                name_snapshot: description,
                unit_price: unitPrice,
                line_total: lineTotal,
              })
              .eq('id', existingLine.appointment_line_item_id)
            if (appointmentLineError) throw appointmentLineError
          }
        }
      }
    }

    const { data: refreshedLines, error: refreshedLinesError } = await supabase
      .from('ops_invoice_line_items')
      .select('*')
      .eq('invoice_id', id)

    if (refreshedLinesError) throw refreshedLinesError

    const subtotal = (refreshedLines || []).reduce(
      (sum, item) => sum + Number(item.line_total || 0),
      0,
    )
    const discountAmount =
      body.discount_amount !== undefined
        ? Math.max(0, Number(body.discount_amount || 0))
        : Number(current.discount_amount || 0)
    const total = Number(
      (
        subtotal -
        discountAmount +
        Number(current.minimum_charge_adjustment || 0) +
        Number(current.tax_amount || 0)
      ).toFixed(2),
    )

    const { data: invoice, error: invoiceError } = await supabase
      .from('ops_invoices')
      .update({
        subtotal: Number(subtotal.toFixed(2)),
        total,
        discount_amount: discountAmount,
        status:
          body.status !== undefined ? String(body.status) : current.status,
        payment_method:
          body.payment_method !== undefined
            ? body.payment_method
            : current.payment_method,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (invoiceError) throw invoiceError

    const isBeingMarkedPaid =
      body.status === 'paid' && current.status !== 'paid'
    const method = body.payment_method || current.payment_method
    const isNonCardPayment = method && method !== 'card'

    if (
      isBeingMarkedPaid &&
      isNonCardPayment &&
      current.quickbooks_invoice_id
    ) {
      try {
        const { data: apptData } = await supabase
          .from('ops_appointments')
          .select('customer_id')
          .eq('id', current.appointment_id)
          .single()

        let qbCustId: string | null = null
        if (apptData?.customer_id) {
          const { data: custData } = await supabase
            .from('ops_customers')
            .select('quickbooks_customer_id')
            .eq('id', apptData.customer_id)
            .single()
          qbCustId = custData?.quickbooks_customer_id ?? null
        }

        if (qbCustId) {
          await createQBPayment({
            qbCustomerId: qbCustId,
            qbInvoiceId: current.quickbooks_invoice_id,
            amount: total,
            paymentMethod: method,
          })
        }
      } catch (qbErr) {
        console.error(
          '[ops/invoices/:id][PATCH] QB payment record failed:',
          qbErr,
        )
      }
    }

    if (current.appointment_id) {
      const { error: appointmentError } = await supabase
        .from('ops_appointments')
        .update({
          quoted_total: Number(subtotal.toFixed(2)),
          updated_at: new Date().toISOString(),
        })
        .eq('id', current.appointment_id)

      if (appointmentError) throw appointmentError
    }

    return NextResponse.json({ invoice })
  } catch (error) {
    console.error('[ops/invoices/:id][PATCH] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update invoice' },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const { id } = await params

    const { data: current, error: currentError } = await supabase
      .from('ops_invoices')
      .select('id, appointment_id, quickbooks_invoice_id')
      .eq('id', id)
      .single()

    if (currentError) throw currentError

    // Void the invoice in QuickBooks if it was synced
    if (current?.quickbooks_invoice_id) {
      try {
        await voidQBInvoice(current.quickbooks_invoice_id)
      } catch (qbErr) {
        console.error('[ops/invoices/:id][DELETE] QB void failed:', qbErr)
        // Don't block the delete if QB void fails
      }
    }

    const { error: deleteError } = await supabase
      .from('ops_invoices')
      .delete()
      .eq('id', id)

    if (deleteError) throw deleteError

    const { error: cleanupError } = await supabase
      .from('ops_quickbooks_sync_jobs')
      .delete()
      .eq('entity_type', 'invoice')
      .eq('entity_id', id)

    if (cleanupError) throw cleanupError

    if (current?.appointment_id) {
      const { error: appointmentUpdateError } = await supabase
        .from('ops_appointments')
        .update({
          updated_at: new Date().toISOString(),
          quickbooks_sync_status: 'held',
        })
        .eq('id', current.appointment_id)

      if (appointmentUpdateError) throw appointmentUpdateError
    }

    return NextResponse.json({
      success: true,
      appointment_id: current?.appointment_id || null,
    })
  } catch (error) {
    console.error('[ops/invoices/:id][DELETE] Error:', error)
    return NextResponse.json(
      { error: 'Failed to delete invoice' },
      { status: 500 },
    )
  }
}
