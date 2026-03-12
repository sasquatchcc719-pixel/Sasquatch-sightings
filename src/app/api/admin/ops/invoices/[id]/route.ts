import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

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

    const lineItems = Array.isArray(body.line_items) ? body.line_items : []

    for (const item of lineItems) {
      const lineId = String(item.id || '').trim()
      if (!lineId) continue
      const description = String(item.description || '').trim()
      const unitPrice = Number(item.unit_price || 0)
      const quantity = Number(item.quantity || 1)
      const lineTotal = Number((unitPrice * quantity).toFixed(2))

      const existingLine = (current.ops_invoice_line_items || []).find(
        (line: {
          id: string
          appointment_line_item_id: string | null
          quantity: number
        }) => line.id === lineId,
      )

      if (!existingLine) continue

      const { error: invoiceLineError } = await supabase
        .from('ops_invoice_line_items')
        .update({
          description,
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

    const { data: refreshedLines, error: refreshedLinesError } = await supabase
      .from('ops_invoice_line_items')
      .select('*')
      .eq('invoice_id', id)

    if (refreshedLinesError) throw refreshedLinesError

    const subtotal = (refreshedLines || []).reduce(
      (sum, item) => sum + Number(item.line_total || 0),
      0,
    )
    const total = Number(
      (
        subtotal -
        Number(current.discount_amount || 0) +
        Number(current.minimum_charge_adjustment || 0) +
        Number(current.tax_amount || 0)
      ).toFixed(2),
    )

    const { data: invoice, error: invoiceError } = await supabase
      .from('ops_invoices')
      .update({
        subtotal: Number(subtotal.toFixed(2)),
        total,
        status:
          body.status !== undefined ? String(body.status) : current.status,
        payment_status:
          body.payment_status !== undefined
            ? String(body.payment_status)
            : current.payment_status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (invoiceError) throw invoiceError

    if (current.appointment_id) {
      const { error: appointmentError } = await supabase
        .from('ops_appointments')
        .update({
          quoted_total: Number(subtotal.toFixed(2)),
          payment_status:
            body.payment_status !== undefined
              ? String(body.payment_status)
              : current.payment_status,
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
