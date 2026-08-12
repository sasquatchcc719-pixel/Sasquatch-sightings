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

    // A rug or upholstery line cannot be zeroed out by editing the price.
    // Removing that work has to go through the exclusion flow, which requires
    // a fiber check and leaves a photo, a verdict and a name on the record.
    for (const incoming of lineItems) {
      if (!incoming.id) continue
      const existing = appointment.lineItems.find((l) => l.id === incoming.id)
      if (!existing?.requiresFiberCheck || existing.excludedAt) continue
      const nextPrice = Number(incoming.unitPrice || 0)
      const hadValue = (existing.unitPrice ?? 0) > 0
      if (hadValue && nextPrice === 0) {
        return NextResponse.json(
          {
            error: `Set "${existing.name}" to $0 by removing it from the invoice, so the reason is recorded. Open its fiber check to do that.`,
          },
          { status: 400 },
        )
      }
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

    // Update in place rather than delete-and-recreate. Recreating dropped
    // service_catalog_item_id (which is how rug/upholstery items are detected
    // for fiber checks) and orphaned any fiber check anchored to a line.
    const { data: existingLines, error: existingLinesError } = await supabase
      .from('ops_appointment_line_items')
      .select('id, excluded_at, excluded_original_total')
      .eq('appointment_id', id)

    if (existingLinesError) throw existingLinesError

    const existingById = new Map(
      (existingLines ?? []).map((line) => [String(line.id), line]),
    )

    const normalized = lineItems.map((line) => {
      const quantity = Math.max(1, Number(line.quantity || 1))
      const unitPrice = Math.max(0, Number(line.unitPrice || 0))
      const existingId =
        line.id && existingById.has(String(line.id)) ? String(line.id) : null
      const existing = existingId ? existingById.get(existingId) : null
      // An excluded line contributes nothing to the total regardless of what
      // the client sends; its original value is preserved on the row.
      const isExcluded = Boolean(existing?.excluded_at)
      return {
        existingId,
        isExcluded,
        row: {
          appointment_id: id,
          name_snapshot: String(line.name || '').trim() || 'Service',
          quantity,
          unit_price: isExcluded ? 0 : unitPrice,
          buffer_minutes: 0,
          line_total: isExcluded ? 0 : Number((quantity * unitPrice).toFixed(2)),
          notes: line.notes ? String(line.notes).trim() || null : null,
        },
      }
    })

    const keptIds = new Set(
      normalized.map((n) => n.existingId).filter((v): v is string => Boolean(v)),
    )
    const removedIds = (existingLines ?? [])
      .map((line) => String(line.id))
      .filter((existingId) => !keptIds.has(existingId))

    if (removedIds.length > 0) {
      await supabase
        .from('ops_appointment_line_items')
        .delete()
        .in('id', removedIds)
    }

    for (const entry of normalized.filter((n) => n.existingId)) {
      const { error: updateLineError } = await supabase
        .from('ops_appointment_line_items')
        .update(entry.row)
        .eq('id', entry.existingId as string)
      if (updateLineError) throw updateLineError
    }

    const toInsert = normalized.filter((n) => !n.existingId)
    if (toInsert.length > 0) {
      const { error: insertLinesError } = await supabase
        .from('ops_appointment_line_items')
        .insert(
          toInsert.map((n) => ({ ...n.row, duration_minutes: 60 })),
        )
      if (insertLinesError) throw insertLinesError
    }

    const { data: appointmentLines, error: appointmentLinesError } =
      await supabase
        .from('ops_appointment_line_items')
        .select(
          'id, name_snapshot, quantity, unit_price, line_total, excluded_at, excluded_reason, excluded_original_total',
        )
        .eq('appointment_id', id)
        .order('created_at', { ascending: true })

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
            excluded_at: line.excluded_at ?? null,
            excluded_reason: line.excluded_reason ?? null,
            excluded_original_total: line.excluded_original_total ?? null,
          })),
        )

      if (invoiceLinesError) throw invoiceLinesError
    }

    const subtotal = (appointmentLines ?? []).reduce(
      (sum, line) => sum + Number(line.line_total || 0),
      0,
    )
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
