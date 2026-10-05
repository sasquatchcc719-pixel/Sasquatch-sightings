export type ApiAppointmentStatus = 'scheduled' | 'completed' | 'cancelled'
export type ApiEstimateStatus = 'pending' | 'accepted' | 'declined'

type JsonRecord = Record<string, unknown>

export function relation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function appointmentStatus(value: unknown): ApiAppointmentStatus {
  if (value === 'completed') return 'completed'
  if (value === 'cancelled') return 'cancelled'
  return 'scheduled'
}

export function estimateStatus(value: unknown): ApiEstimateStatus {
  if (value === 'accepted' || value === 'converted') return 'accepted'
  if (value === 'declined') return 'declined'
  return 'pending'
}

function timeWindow(row: JsonRecord) {
  return {
    date: row.appointment_date,
    start_time: row.start_time,
    end_time: row.end_time,
    timezone: 'America/Denver',
  }
}

function serializeCustomer(value: unknown, includeNotes = false) {
  const customer = relation(value as JsonRecord | JsonRecord[] | null)
  if (!customer) return null
  return {
    id: customer.id,
    name: customer.full_name,
    first_name: customer.first_name,
    last_name: customer.last_name,
    business_name: customer.business_name,
    phone: customer.phone,
    email: customer.email,
    ...(includeNotes ? { notes: customer.notes } : {}),
  }
}

function serializeAddress(value: unknown, includeNotes = false) {
  const address = relation(value as JsonRecord | JsonRecord[] | null)
  if (!address) return null
  return {
    id: address.id,
    label: address.label,
    street_1: address.street_1,
    street_2: address.street_2,
    city: address.city,
    state: address.state,
    zip_code: address.zip_code,
    ...(includeNotes
      ? { gate_code: address.gate_code, notes: address.notes }
      : {}),
  }
}

function serializeTech(value: unknown) {
  const tech = relation(value as JsonRecord | JsonRecord[] | null)
  return tech ? { id: tech.id, name: tech.display_name } : null
}

function serializeLineItems(value: unknown) {
  const rows = Array.isArray(value) ? (value as JsonRecord[]) : []
  return rows.map((item) => ({
    id: item.id,
    service_id: item.service_catalog_item_id,
    name: item.name_snapshot,
    quantity: numeric(item.quantity),
    unit_price: numeric(item.unit_price),
    amount: numeric(item.line_total),
    duration_minutes: item.duration_minutes,
    notes: item.notes,
  }))
}

export function serializeAppointmentSummary(row: JsonRecord) {
  return {
    id: row.id,
    customer: serializeCustomer(row.customer),
    address: serializeAddress(row.address),
    tech: serializeTech(row.tech),
    time_window: timeWindow(row),
    status: appointmentStatus(row.status),
    price: numeric(row.quoted_total),
  }
}

export function serializeAppointmentDetail(row: JsonRecord) {
  const invoice = relation(
    row.invoices as JsonRecord | JsonRecord[] | null | undefined,
  )
  return {
    id: row.id,
    customer: serializeCustomer(row.customer, true),
    address: serializeAddress(row.address, true),
    services: serializeLineItems(row.services),
    price: numeric(invoice?.total) ?? numeric(row.quoted_total),
    tech: serializeTech(row.tech),
    time_window: timeWindow(row),
    status: appointmentStatus(row.status),
    notes: row.internal_notes,
    visit_type: row.visit_type,
    payment_status: invoice?.payment_status ?? row.payment_status,
  }
}

export function serializeEstimateSummary(row: JsonRecord) {
  return {
    id: row.id,
    customer: serializeCustomer(row.customer),
    address: serializeAddress(row.address),
    amount: numeric(row.quoted_total),
    status: estimateStatus(row.estimate_status),
    time_window: timeWindow(row),
  }
}

export function serializeEstimateDetail(row: JsonRecord) {
  return {
    id: row.id,
    line_items: serializeLineItems(row.line_items),
    amount: numeric(row.quoted_total),
    customer: serializeCustomer(row.customer, true),
    address: serializeAddress(row.address, true),
    status: estimateStatus(row.estimate_status),
    notes: row.internal_notes,
  }
}

export function serializeCustomerSearchResult(row: JsonRecord) {
  const addresses = Array.isArray(row.addresses)
    ? (row.addresses as JsonRecord[]).map((address) =>
        serializeAddress(address, true),
      )
    : []
  return {
    id: row.id,
    name: row.full_name,
    first_name: row.first_name,
    last_name: row.last_name,
    business_name: row.business_name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    addresses,
  }
}
