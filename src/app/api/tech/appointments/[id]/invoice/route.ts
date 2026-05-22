import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import {
  getAssignedTechAppointment,
  shouldHideTechPricing,
} from '@/lib/tech/appointments'
import { createAdminClient } from '@/supabase/server'

type LineItemInput = {
  id?: string
  name?: string
  quantity?: number | string
  unitPrice?: number | string
  notes?: string | null
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const supabase = createAdminClient()
    const { id } = await params
    const body = await request.json()
    const staffUserId = access.staff?.id ?? access.id
    const appointment = await getAssignedTechAppointment(
      supabase,
      staffUserId,
      id,
    )

    if (!appointment) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (appointment.hidePricing) {
      return NextResponse.json(
        { error: 'Invoice editing is disabled for this job' },
        { status: 403 },
      )
    }

    const lineItems: LineItemInput[] = Array.isArray(body.line_items)
      ? body.line_items
      : []
    if (lineItems.length === 0) {
      return NextResponse.json(
        { error: 'At least one line item is required' },
        { status: 400 },
      )
    }

    const { data: current, error: currentError } = await supabase
      .from('ops_appointments')
      .select(
        `
          id,
          recurring_template_id,
          ops_customers!ops_appointments_customer_id_fkey (
            full_name,
            business_name
          ),
          ops_recurring_templates (
            invoice_mode
          ),
          ops_invoices (
            id,
            discount_amount,
            percentage_discount_amount,
            tax_amount,
            minimum_charge_adjustment
          ),
          ops_appointment_line_items (
            id
          )
        `,
      )
      .eq('id', id)
      .eq('assigned_staff_user_id', staffUserId)
      .single()

    if (currentError) throw currentError
    if (shouldHideTechPricing(current)) {
      return NextResponse.json(
        { error: 'Invoice editing is disabled for this job' },
        { status: 403 },
      )
    }

    const invoice = Array.isArray(current.ops_invoices)
      ? current.ops_invoices[0]
      : current.ops_invoices
    if (!invoice) {
      return NextResponse.json(
        { error: 'No invoice found for this job' },
        { status: 404 },
      )
    }

    await supabase
      .from('ops_appointment_line_items')
      .delete()
      .eq('appointment_id', id)

    const normalized = lineItems.map((line) => {
      const quantity = Math.max(1, Number(line.quantity || 1))
      const unitPrice = Math.max(0, Number(line.unitPrice || 0))
      return {
        appointment_id: id,
        name_snapshot: String(line.name || '').trim() || 'Service',
        quantity,
        unit_price: unitPrice,
        duration_minutes: 60,
        buffer_minutes: 0,
        line_total: Number((quantity * unitPrice).toFixed(2)),
        notes: line.notes ? String(line.notes).trim() || null : null,
      }
    })

    const { data: appointmentLines, error: appointmentLinesError } =
      await supabase
        .from('ops_appointment_line_items')
        .insert(normalized)
        .select('id, name_snapshot, quantity, unit_price, line_total')

    if (appointmentLinesError) throw appointmentLinesError

    await supabase
      .from('ops_invoice_line_items')
      .delete()
      .eq('invoice_id', invoice.id)

    if (appointmentLines && appointmentLines.length > 0) {
      const { error: invoiceLinesError } = await supabase
        .from('ops_invoice_line_items')
        .insert(
          appointmentLines.map((line) => ({
            invoice_id: invoice.id,
            appointment_line_item_id: line.id,
            description: line.name_snapshot,
            quantity: line.quantity,
            unit_price: line.unit_price,
            line_total: line.line_total,
          })),
        )

      if (invoiceLinesError) throw invoiceLinesError
    }

    const subtotal = normalized.reduce((sum, line) => sum + line.line_total, 0)
    const total = Number(
      (
        subtotal -
        Number(invoice.discount_amount || 0) -
        Number(invoice.percentage_discount_amount || 0) +
        Number(invoice.minimum_charge_adjustment || 0) +
        Number(invoice.tax_amount || 0)
      ).toFixed(2),
    )
    const nowIso = new Date().toISOString()

    await supabase
      .from('ops_appointments')
      .update({ quoted_total: subtotal, updated_at: nowIso })
      .eq('id', id)

    await supabase
      .from('ops_invoices')
      .update({
        subtotal: Number(subtotal.toFixed(2)),
        total,
        updated_at: nowIso,
      })
      .eq('id', invoice.id)

    const updated = await getAssignedTechAppointment(supabase, staffUserId, id)
    return NextResponse.json({ appointment: updated })
  } catch (error) {
    console.error('[tech/appointments/:id/invoice][PATCH]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: status === 401 ? 'Unauthorized' : 'Failed to update invoice' },
      { status },
    )
  }
}
