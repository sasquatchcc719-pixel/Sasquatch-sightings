/**
 * Exclude a line item from an invoice without deleting it.
 *
 * The row stays on the record with its original price preserved; line_total
 * goes to 0 so every existing revenue consumer (stats, rollups, QuickBooks
 * sync) is correct with no changes. Only the customer- and QuickBooks-facing
 * paths filter the row out entirely.
 *
 * This is the ONLY way a tech can take money off a rug or upholstery line, so
 * every dollar removed leaves a photo, a verdict, a name and a timestamp.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { getTechAppointmentForAccess } from '@/lib/tech/appointments'
import { createAdminClient } from '@/supabase/server'
import { sendTelegramNotification } from '@/lib/telegram'
import { unitsForLine } from '@/lib/fiber/gate'
import { pairInvoiceLines } from '@/lib/ops/invoice-line-pairing'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let access
  try {
    access = await requireAnyRole(['admin', 'owner', 'tech'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const { id: appointmentId } = await params
    const appointment = await getTechAppointmentForAccess(supabase, {
      role: access.role,
      staffId: access.staff?.id ?? null,
      appointmentId,
    })
    if (!appointment) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const body = await request.json()
    const lineItemId = String(body.lineItemId || '')
    const reason = String(body.reason || '').trim()
    const restore = body.restore === true

    const line = appointment.lineItems.find((l) => l.id === lineItemId)
    if (!line) {
      return NextResponse.json({ error: 'Line item not found' }, { status: 404 })
    }

    if (restore) {
      const original = line.excludedOriginalTotal ?? 0
      const quantity = line.quantity || 1
      await supabase
        .from('ops_appointment_line_items')
        .update({
          excluded_at: null,
          excluded_by: null,
          excluded_reason: null,
          excluded_original_total: null,
          line_total: original,
          unit_price: Number((original / quantity).toFixed(2)),
        })
        .eq('id', lineItemId)
    } else {
      if (!reason) {
        return NextResponse.json(
          { error: 'A reason is required to exclude work' },
          { status: 400 },
        )
      }

      // A rug or upholstery line can only be excluded once it has been
      // identified — that is what makes the record evidence rather than a
      // silent write-off.
      const targetUnit = Math.max(1, Math.floor(Number(body.unitIndex) || 1))
      const check = appointment.fiberChecks.find(
        (c) =>
          c.appointmentLineItemId === lineItemId &&
          (c.unitIndex ?? 1) === targetUnit,
      )
      if (line.requiresFiberCheck && !check) {
        return NextResponse.json(
          {
            error:
              'Run the fiber check on this item before removing it from the invoice',
          },
          { status: 400 },
        )
      }

      const units = unitsForLine(line)
      const unitPrice = line.unitPrice ?? 0
      const nowIso = new Date().toISOString()
      let originalTotal: number

      if (units > 1) {
        // Only one piece on this line is the problem. Split it: the line keeps
        // the pieces we can clean, and the excluded piece becomes its own row
        // so it carries its own reason and evidence. Excluding all three rugs
        // because one is viscose would be wrong.
        originalTotal = unitPrice
        const { data: newLine, error: splitError } = await supabase
          .from('ops_appointment_line_items')
          .insert({
            appointment_id: appointmentId,
            name_snapshot: line.name,
            quantity: 1,
            unit_price: 0,
            line_total: 0,
            duration_minutes: 0,
            buffer_minutes: 0,
            excluded_at: nowIso,
            excluded_by: access.id,
            excluded_reason: reason,
            excluded_original_total: unitPrice,
            fiber_check_id: check?.id ?? null,
          })
          .select('id')
          .single()
        if (splitError) throw splitError

        const remaining = units - 1
        await supabase
          .from('ops_appointment_line_items')
          .update({
            quantity: remaining,
            line_total: Number((remaining * unitPrice).toFixed(2)),
          })
          .eq('id', lineItemId)

        // Move the excluded piece's check onto the new row, then close the gap
        // in the remaining unit numbers so the gate can still be satisfied.
        const unitIndex = Math.max(1, Math.floor(Number(body.unitIndex) || 1))
        if (check) {
          await supabase
            .from('fiber_checks')
            .update({ appointment_line_item_id: newLine.id, unit_index: 1 })
            .eq('id', check.id)
        }
        const shifted = appointment.fiberChecks.filter(
          (c) =>
            c.appointmentLineItemId === lineItemId &&
            (c.unitIndex ?? 1) > unitIndex,
        )
        for (const moving of shifted) {
          await supabase
            .from('fiber_checks')
            .update({ unit_index: (moving.unitIndex ?? 1) - 1 })
            .eq('id', moving.id)
        }
      } else {
        originalTotal = line.lineTotal ?? 0
        const { error: updateError } = await supabase
          .from('ops_appointment_line_items')
          .update({
            excluded_at: nowIso,
            excluded_by: access.id,
            excluded_reason: reason,
            excluded_original_total: originalTotal,
            fiber_check_id: check?.id ?? null,
            line_total: 0,
            unit_price: 0,
          })
          .eq('id', lineItemId)

        if (updateError) throw updateError
      }

      const who = access.staff?.display_name ?? access.email
      const amount = originalTotal.toFixed(2)
      void sendTelegramNotification(
        `Work removed from an invoice\n\n` +
          `Item: ${line.name}\n` +
          `Customer: ${appointment.customerName}\n` +
          `Value removed: $${amount}\n` +
          `Reason: ${reason}\n` +
          (check
            ? `Fiber: ${check.fiber ?? 'unknown'} (${check.verdict})\n`
            : '') +
          `By: ${who}`,
      )
    }

    await recalculateInvoice(supabase, appointmentId)

    const updated = await getTechAppointmentForAccess(supabase, {
      role: access.role,
      staffId: access.staff?.id ?? null,
      appointmentId,
    })
    return NextResponse.json({ appointment: updated })
  } catch (error) {
    console.error('[tech/appointments/:id/exclude-line][POST]', error)
    return NextResponse.json(
      { error: 'Could not update the invoice' },
      { status: 500 },
    )
  }
}

async function recalculateInvoice(
  supabase: ReturnType<typeof createAdminClient>,
  appointmentId: string,
) {
  const { data: lines } = await supabase
    .from('ops_appointment_line_items')
    .select(
      'id, name_snapshot, quantity, unit_price, line_total, excluded_at, excluded_reason, excluded_original_total',
    )
    .eq('appointment_id', appointmentId)

  const { data: invoice } = await supabase
    .from('ops_invoices')
    .select(
      'id, discount_amount, percentage_discount_amount, tax_amount, minimum_charge_adjustment',
    )
    .eq('appointment_id', appointmentId)
    .maybeSingle()

  const appointmentSubtotal = (lines ?? []).reduce(
    (sum, line) => sum + Number(line.line_total || 0),
    0,
  )
  const nowIso = new Date().toISOString()

  await supabase
    .from('ops_appointments')
    .update({ quoted_total: appointmentSubtotal, updated_at: nowIso })
    .eq('id', appointmentId)

  if (!invoice) return

  // Mirror exclusion state onto the invoice lines so the customer-facing and
  // QuickBooks paths can filter them out. Splitting a multi-unit line creates
  // an appointment line with no invoice line yet, so insert those.
  //
  // Matching on appointment_line_item_id ALONE is not enough. The booking
  // widget writes the invoice lines and the appointment lines as two separate
  // unlinked sets, so on a widget-booked job every invoice line has a null
  // link. Those lines used to be invisible here, so every appointment line
  // looked missing and got inserted a second time — which is how Shane
  // Pruitt's $544 job briefly showed a little over $1,000 on the schedule.
  // Adopt an unlinked line that describes the same work instead of
  // duplicating it, and record the link so it only has to happen once.
  const { data: existingInvoiceLines } = await supabase
    .from('ops_invoice_line_items')
    .select('id, appointment_line_item_id, description')
    .eq('invoice_id', invoice.id)

  const appointmentLines = lines ?? []
  const pairings = pairInvoiceLines(appointmentLines, existingInvoiceLines ?? [])

  for (const [index, line] of appointmentLines.entries()) {
    const payload = {
      quantity: Number(line.quantity || 1),
      unit_price: Number(line.unit_price || 0),
      line_total: Number(line.line_total || 0),
      excluded_at: line.excluded_at ?? null,
      excluded_reason: line.excluded_reason ?? null,
      excluded_original_total: line.excluded_original_total ?? null,
    }
    const { invoiceLineId } = pairings[index]

    if (invoiceLineId) {
      await supabase
        .from('ops_invoice_line_items')
        // Writing the link back means the next recalc matches outright
        // instead of having to recognise the description again.
        .update({ ...payload, appointment_line_item_id: line.id })
        .eq('id', invoiceLineId)
    } else {
      await supabase.from('ops_invoice_line_items').insert({
        invoice_id: invoice.id,
        appointment_line_item_id: line.id,
        description: line.name_snapshot,
        ...payload,
      })
    }
  }

  // The invoice total comes from the INVOICE's own lines, not the
  // appointment's. Lines added through the admin screen before they were
  // linked to an appointment line item exist only here, and summing the
  // appointment side silently dropped them — leaving a stored total lower
  // than what the customer actually owes.
  const { data: invoiceLines } = await supabase
    .from('ops_invoice_line_items')
    .select('line_total')
    .eq('invoice_id', invoice.id)

  const subtotal = (invoiceLines ?? []).reduce(
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

  await supabase
    .from('ops_invoices')
    .update({
      subtotal: Number(subtotal.toFixed(2)),
      total,
      updated_at: nowIso,
    })
    .eq('id', invoice.id)
}
