import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

type Params = { params: Promise<{ id: string }> }

function unwrap<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

type OutLineItem = {
  service_catalog_item_id: string | null
  name_snapshot: string
  quantity: number
  unit_price: number
  duration_minutes: number
  buffer_minutes: number
  line_total: number
}

/**
 * Past completed jobs for a customer, with their line items + address, so the
 * New Job form can repeat a previous job in one tap.
 *
 * Source of truth is the INVOICE line items (what was actually billed), falling
 * back to the appointment line items (the original quote) only when no invoice
 * lines exist. The appointment quote can be edited up/down before billing, and
 * its stored quantity/unit_price are not always self-consistent, so the invoice
 * is what we reproduce.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const { id } = await params

    const { data, error } = await supabase
      .from('ops_appointments')
      .select(
        `
          id,
          appointment_date,
          start_time,
          status,
          quoted_total,
          service_address_id,
          ops_service_addresses (
            id, label, street_1, street_2, city, state, zip_code, gate_code, notes
          ),
          ops_appointment_line_items (
            service_catalog_item_id, name_snapshot, quantity, unit_price,
            duration_minutes, buffer_minutes, line_total
          ),
          ops_invoices (
            id, total, status, payment_status,
            ops_invoice_line_items ( description, quantity, unit_price, line_total )
          )
        `,
      )
      .eq('customer_id', id)
      .eq('status', 'completed')
      .order('appointment_date', { ascending: false })
      .limit(25)

    if (error) throw error

    const jobs = (data || [])
      .map((row) => {
        const address = unwrap(row.ops_service_addresses)
        const invoice = unwrap(row.ops_invoices)
        const invoiceLines = invoice?.ops_invoice_line_items || []
        const apptLines = row.ops_appointment_line_items || []

        let lineItems: OutLineItem[]
        if (invoiceLines.length > 0) {
          // Billed work — prices already consistent (qty × unit_price = total).
          lineItems = invoiceLines.map((li) => ({
            service_catalog_item_id: null,
            name_snapshot: li.description,
            quantity: Number(li.quantity || 1),
            unit_price: Number(li.unit_price || 0),
            duration_minutes: 0,
            buffer_minutes: 0,
            line_total: Number(li.line_total || 0),
          }))
        } else {
          // Fallback: original quote. Derive unit_price from the line total so
          // the form's live math matches what was quoted, even if the stored
          // quantity/unit_price were inconsistent.
          lineItems = apptLines.map((li) => {
            const quantity = Number(li.quantity || 1)
            const lineTotal = Number(li.line_total || 0)
            const unitPrice =
              quantity > 0 ? lineTotal / quantity : Number(li.unit_price || 0)
            return {
              service_catalog_item_id: li.service_catalog_item_id,
              name_snapshot: li.name_snapshot,
              quantity,
              unit_price: unitPrice,
              duration_minutes: Number(li.duration_minutes || 0),
              buffer_minutes: Number(li.buffer_minutes || 0),
              line_total: lineTotal,
            }
          })
        }

        const lineItemsTotal = lineItems.reduce(
          (sum, li) => sum + Number(li.line_total || 0),
          0,
        )
        const total =
          Number(invoice?.total ?? row.quoted_total ?? lineItemsTotal) || 0

        return {
          id: row.id,
          appointment_date: row.appointment_date,
          start_time: row.start_time,
          total,
          payment_status: invoice?.payment_status ?? null,
          service_address_id: row.service_address_id,
          address: address
            ? {
                id: address.id,
                label: address.label,
                street_1: address.street_1,
                street_2: address.street_2,
                city: address.city,
                state: address.state,
                zip_code: address.zip_code,
                gate_code: address.gate_code,
                notes: address.notes,
              }
            : null,
          line_items: lineItems,
        }
      })
      // Only jobs that actually have line items can be repeated.
      .filter((job) => job.line_items.length > 0)

    return NextResponse.json({ jobs })
  } catch (error) {
    console.error('[admin/customers/past-jobs][GET]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: status === 401 ? 'Unauthorized' : 'Failed to load past jobs' },
      { status },
    )
  }
}
