import { createAdminClient } from '@/supabase/server'

type SupabaseAdminClient = ReturnType<typeof createAdminClient>

export type TechLineItem = {
  id: string
  invoiceLineId: string | null
  name: string
  quantity: number
  unitPrice: number | null
  lineTotal: number | null
  notes: string | null
}

export type TechPhoto = {
  id: string
  publicUrl: string
  label: string | null
  watermarked: boolean
  createdAt: string
}

export type TechAppointment = {
  id: string
  appointmentDate: string
  startTime: string | null
  endTime: string | null
  status: string
  paymentStatus: string | null
  recurringTemplateId: string | null
  customerName: string
  customerPhone: string | null
  customerEmail: string | null
  businessName: string | null
  address: {
    street1: string
    street2: string | null
    city: string
    state: string
    zipCode: string
    gateCode: string | null
    notes: string | null
    latitude: number | null
    longitude: number | null
  } | null
  internalNotes: string | null
  hidePricing: boolean
  quotedTotal: number | null
  invoice: {
    id: string
    invoiceNumber: number | null
    status: string
    paymentStatus: string | null
    paymentMethod: string | null
    total: number | null
    signatureUrl: string | null
    signatureCapturedAt: string | null
    signatureCustomerName: string | null
  } | null
  lineItems: TechLineItem[]
  photos: TechPhoto[]
}

const TECH_APPOINTMENT_SELECT = `
  id,
  appointment_date,
  start_time,
  end_time,
  status,
  payment_status,
  quoted_total,
  internal_notes,
  assigned_staff_user_id,
  recurring_template_id,
  ops_customers!ops_appointments_customer_id_fkey (
    full_name,
    first_name,
    last_name,
    business_name,
    phone,
    email
  ),
  ops_service_addresses (
    street_1,
    street_2,
    city,
    state,
    zip_code,
    gate_code,
    notes,
    latitude,
    longitude
  ),
  ops_appointment_line_items (
    id,
    name_snapshot,
    quantity,
    unit_price,
    line_total,
    notes
  ),
  ops_invoices (
    id,
    invoice_number,
    status,
    payment_status,
    payment_method,
    total,
    signature_url,
    signature_captured_at,
    signature_customer_name,
    ops_invoice_line_items (
      id,
      appointment_line_item_id
    )
  ),
  ops_job_photos (
    id,
    public_url,
    label,
    watermarked,
    created_at
  ),
  ops_recurring_templates (
    invoice_mode
  )
`

function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function isRecoveryVillageCustomer(
  customer: {
    business_name?: string | null
    full_name?: string | null
  } | null,
): boolean {
  const businessName = customer?.business_name?.trim().toLowerCase() ?? ''
  const fullName = customer?.full_name?.trim().toLowerCase() ?? ''
  return businessName === 'recovery village' || fullName === 'recovery village'
}

export function shouldHideTechPricing(row: Record<string, unknown>): boolean {
  const customer = unwrapRelation(
    row.ops_customers as
      | { business_name?: string | null; full_name?: string | null }
      | Array<{ business_name?: string | null; full_name?: string | null }>
      | null,
  )
  const recurringTemplate = unwrapRelation(
    row.ops_recurring_templates as
      | { invoice_mode?: string | null }
      | Array<{ invoice_mode?: string | null }>
      | null,
  )

  return (
    isRecoveryVillageCustomer(customer) ||
    recurringTemplate?.invoice_mode === 'batch_monthly'
  )
}

export function mapTechAppointment(
  row: Record<string, unknown>,
): TechAppointment {
  const customer = unwrapRelation(
    row.ops_customers as
      | {
          full_name?: string | null
          first_name?: string | null
          last_name?: string | null
          business_name?: string | null
          phone?: string | null
          email?: string | null
        }
      | Array<{
          full_name?: string | null
          first_name?: string | null
          last_name?: string | null
          business_name?: string | null
          phone?: string | null
          email?: string | null
        }>
      | null,
  )
  const address = unwrapRelation(
    row.ops_service_addresses as
      | {
          street_1?: string | null
          street_2?: string | null
          city?: string | null
          state?: string | null
          zip_code?: string | null
          gate_code?: string | null
          notes?: string | null
          latitude?: number | null
          longitude?: number | null
        }
      | Array<{
          street_1?: string | null
          street_2?: string | null
          city?: string | null
          state?: string | null
          zip_code?: string | null
          gate_code?: string | null
          notes?: string | null
          latitude?: number | null
          longitude?: number | null
        }>
      | null,
  )
  const invoice = unwrapRelation(
    row.ops_invoices as
      | {
          id: string
          invoice_number?: number | null
          status?: string | null
          payment_status?: string | null
          payment_method?: string | null
          total?: number | null
          signature_url?: string | null
          signature_captured_at?: string | null
          signature_customer_name?: string | null
          ops_invoice_line_items?: Array<{
            id: string
            appointment_line_item_id: string | null
          }>
        }
      | Array<{
          id: string
          invoice_number?: number | null
          status?: string | null
          payment_status?: string | null
          payment_method?: string | null
          total?: number | null
          signature_url?: string | null
          signature_captured_at?: string | null
          signature_customer_name?: string | null
          ops_invoice_line_items?: Array<{
            id: string
            appointment_line_item_id: string | null
          }>
        }>
      | null,
  )
  const lineItems = Array.isArray(row.ops_appointment_line_items)
    ? (row.ops_appointment_line_items as Array<{
        id: string
        name_snapshot?: string | null
        quantity?: number | null
        unit_price?: number | null
        line_total?: number | null
        notes?: string | null
      }>)
    : []
  const photos = Array.isArray(row.ops_job_photos)
    ? (row.ops_job_photos as Array<{
        id: string
        public_url?: string | null
        label?: string | null
        watermarked?: boolean | null
        created_at?: string | null
      }>)
    : []
  const hidePricing = shouldHideTechPricing(row)
  const fallbackName = [customer?.first_name, customer?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()
  const invoiceLines = Array.isArray(invoice?.ops_invoice_line_items)
    ? invoice.ops_invoice_line_items
    : []

  return {
    id: String(row.id),
    appointmentDate: String(row.appointment_date),
    startTime: row.start_time ? String(row.start_time) : null,
    endTime: row.end_time ? String(row.end_time) : null,
    status: String(row.status),
    paymentStatus: row.payment_status ? String(row.payment_status) : null,
    recurringTemplateId: row.recurring_template_id
      ? String(row.recurring_template_id)
      : null,
    customerName:
      customer?.full_name?.trim() ||
      fallbackName ||
      customer?.business_name?.trim() ||
      'Customer',
    customerPhone: customer?.phone ?? null,
    customerEmail: customer?.email ?? null,
    businessName: customer?.business_name ?? null,
    address: address
      ? {
          street1: address.street_1 ?? '',
          street2: address.street_2 ?? null,
          city: address.city ?? '',
          state: address.state ?? '',
          zipCode: address.zip_code ?? '',
          gateCode: address.gate_code ?? null,
          notes: address.notes ?? null,
          latitude: address.latitude ?? null,
          longitude: address.longitude ?? null,
        }
      : null,
    internalNotes: row.internal_notes ? String(row.internal_notes) : null,
    hidePricing,
    quotedTotal: hidePricing ? null : Number(row.quoted_total || 0),
    invoice: invoice
      ? {
          id: invoice.id,
          invoiceNumber:
            invoice.invoice_number === null ||
            invoice.invoice_number === undefined
              ? null
              : Number(invoice.invoice_number),
          status: invoice.status ?? 'draft',
          paymentStatus: invoice.payment_status ?? null,
          paymentMethod: invoice.payment_method ?? null,
          total: hidePricing ? null : Number(invoice.total || 0),
          signatureUrl: invoice.signature_url ?? null,
          signatureCapturedAt: invoice.signature_captured_at ?? null,
          signatureCustomerName: invoice.signature_customer_name ?? null,
        }
      : null,
    lineItems: lineItems.map((line) => ({
      id: line.id,
      invoiceLineId:
        invoiceLines.find(
          (invoiceLine) => invoiceLine.appointment_line_item_id === line.id,
        )?.id ?? null,
      name: line.name_snapshot || 'Service',
      quantity: Number(line.quantity || 1),
      unitPrice: hidePricing ? null : Number(line.unit_price || 0),
      lineTotal: hidePricing ? null : Number(line.line_total || 0),
      notes: line.notes ?? null,
    })),
    photos: photos.map((photo) => ({
      id: photo.id,
      publicUrl: photo.public_url ?? '',
      label: photo.label ?? null,
      watermarked: photo.watermarked === true,
      createdAt: photo.created_at ?? '',
    })),
  }
}

export async function getAssignedTechAppointments(
  supabase: SupabaseAdminClient,
  userId: string,
  date: string,
): Promise<TechAppointment[]> {
  const { data, error } = await supabase
    .from('ops_appointments')
    .select(TECH_APPOINTMENT_SELECT)
    .eq('assigned_staff_user_id', userId)
    .eq('appointment_date', date)
    .not('status', 'in', '("cancelled")')
    .order('start_time')

  if (error) throw error
  return (data ?? []).map((row) => mapTechAppointment(row))
}

export async function getAssignedTechAppointment(
  supabase: SupabaseAdminClient,
  userId: string,
  appointmentId: string,
): Promise<TechAppointment | null> {
  const { data, error } = await supabase
    .from('ops_appointments')
    .select(TECH_APPOINTMENT_SELECT)
    .eq('id', appointmentId)
    .eq('assigned_staff_user_id', userId)
    .maybeSingle()

  if (error) throw error
  return data ? mapTechAppointment(data) : null
}
