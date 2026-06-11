/**
 * Builds a per-customer context block (name, email, address, latest invoice)
 * for the admin Conversations view, so each thread shows who the customer is
 * with clickable links instead of just a phone number.
 *
 * Batched: one query per table across all customers on the page, then mapped
 * back by customer id. Server-only (uses the admin client).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type ConversationCustomerContext = {
  name: string | null
  email: string | null
  /** Single-line formatted service address, or null. */
  address: string | null
  /** Google Maps search link for the address, or null. */
  mapsUrl: string | null
  /** Most recent invoice for the customer, or null. */
  invoice: {
    id: string
    number: string | null
    total: number | null
    paymentStatus: string | null
  } | null
}

function formatAddress(row: {
  street_1?: string | null
  street_2?: string | null
  city?: string | null
  state?: string | null
  zip_code?: string | null
}): string | null {
  const line1 = [row.street_1, row.street_2]
    .map((v) => (v || '').trim())
    .filter(Boolean)
    .join(' ')
  const cityState = [row.city, row.state]
    .map((v) => (v || '').trim())
    .filter(Boolean)
    .join(', ')
  const tail = [cityState, (row.zip_code || '').trim()]
    .filter(Boolean)
    .join(' ')
  const full = [line1, tail].filter(Boolean).join(', ')
  return full || null
}

export async function getCustomerContextForConversations(
  supabase: SupabaseClient,
  customerIdsInput: Array<string | null | undefined>,
): Promise<Map<string, ConversationCustomerContext>> {
  const customerIds = Array.from(
    new Set(customerIdsInput.filter((id): id is string => Boolean(id))),
  )
  const result = new Map<string, ConversationCustomerContext>()
  if (customerIds.length === 0) return result

  const [customersRes, addressesRes, appointmentsRes] = await Promise.all([
    supabase
      .from('ops_customers')
      .select('id, full_name, first_name, last_name, email')
      .in('id', customerIds),
    // Newest address first so the first one seen per customer wins.
    supabase
      .from('ops_service_addresses')
      .select(
        'customer_id, street_1, street_2, city, state, zip_code, created_at',
      )
      .in('customer_id', customerIds)
      .order('created_at', { ascending: false }),
    supabase
      .from('ops_appointments')
      .select('id, customer_id')
      .in('customer_id', customerIds),
  ])

  const addressByCustomer = new Map<string, string | null>()
  for (const row of addressesRes.data || []) {
    const cid = row.customer_id as string
    if (!addressByCustomer.has(cid)) {
      addressByCustomer.set(cid, formatAddress(row))
    }
  }

  // Map appointments → customers so invoices (keyed by appointment) attribute back.
  const appointmentToCustomer = new Map<string, string>()
  for (const appt of appointmentsRes.data || []) {
    appointmentToCustomer.set(appt.id as string, appt.customer_id as string)
  }

  const invoiceByCustomer = new Map<
    string,
    NonNullable<ConversationCustomerContext['invoice']>
  >()
  const appointmentIds = Array.from(appointmentToCustomer.keys())
  if (appointmentIds.length > 0) {
    const { data: invoices } = await supabase
      .from('ops_invoices')
      .select(
        'id, appointment_id, invoice_number, total, payment_status, created_at',
      )
      .in('appointment_id', appointmentIds)
      .order('created_at', { ascending: false })
    for (const inv of invoices || []) {
      const cid = appointmentToCustomer.get(inv.appointment_id as string)
      if (!cid || invoiceByCustomer.has(cid)) continue // newest already kept
      invoiceByCustomer.set(cid, {
        id: inv.id as string,
        number: (inv.invoice_number as string | null) ?? null,
        total: inv.total != null ? Number(inv.total) : null,
        paymentStatus: (inv.payment_status as string | null) ?? null,
      })
    }
  }

  for (const customer of customersRes.data || []) {
    const cid = customer.id as string
    const name =
      (customer.full_name as string | null)?.trim() ||
      [customer.first_name, customer.last_name]
        .map((v) => (v || '').trim())
        .filter(Boolean)
        .join(' ') ||
      null
    const address = addressByCustomer.get(cid) ?? null
    result.set(cid, {
      name,
      email: (customer.email as string | null)?.trim() || null,
      address,
      mapsUrl: address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
        : null,
      invoice: invoiceByCustomer.get(cid) ?? null,
    })
  }

  return result
}
