import { createAdminClient } from '@/supabase/server'
import { requiresFiberCheck } from '@/lib/fiber/requires-check'
import type { FiberVerdict } from '@/lib/fiber/types'
import { loadInvoicePaymentTexts } from '@/lib/ops/load-payment-texts'
import type { PaymentTextSend } from '@/lib/ops/payment-texts'

type SupabaseAdminClient = ReturnType<typeof createAdminClient>

export type TechLineItem = {
  id: string
  invoiceLineId: string | null
  name: string
  quantity: number
  unitPrice: number | null
  lineTotal: number | null
  notes: string | null
  /** Catalog category, used to decide whether a fiber check is required. */
  catalogCategory: string | null
  /** Catalog pricing unit — decides whether quantity counts physical pieces. */
  catalogPricingUnit: string | null
  /** True for rug and upholstery items — these gate the customer signature. */
  requiresFiberCheck: boolean
  excludedAt: string | null
  excludedReason: string | null
  excludedOriginalTotal: number | null
}

export type TechPhoto = {
  id: string
  publicUrl: string
  label: string | null
  watermarked: boolean
  source: 'staff' | 'customer'
  uploadedByLabel: string | null
  createdAt: string
}

export type TechAppointment = {
  id: string
  assignedStaffUserId: string | null
  appointmentDate: string
  startTime: string | null
  endTime: string | null
  status: string
  paymentStatus: string | null
  recurringTemplateId: string | null
  /**
   * Set when this appointment is a visit on a water loss.
   *
   * The tech portal had no idea restoration existed, so a flood visit fell
   * through to the carpet invoice screen. David Gonzalez opened the Benns
   * job, got a bare line-item table, and could not take a single reading —
   * Charles: "he got this bullshit with nothing in it and he can't even take
   * readings."
   */
  restorationProjectId: string | null
  visitType: string | null
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
    paymentTexts: PaymentTextSend[]
  } | null
  lineItems: TechLineItem[]
  photos: TechPhoto[]
  fiberChecks: TechFiberCheck[]
}

export type TechFiberCheck = {
  id: string
  appointmentLineItemId: string | null
  unitIndex: number
  itemLabel: string
  verdict: FiberVerdict
  determinedBy: string
  fiber: string | null
  confidence: string | null
  hasTag: boolean
  tagText: string | null
  burnResult: string | null
  photoUrls: string[]
  warnings: string[]
  recommendedMethod: string | null
  checkedByLabel: string | null
  createdAt: string
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
  service_concern_id,
  restoration_project_id,
  visit_type,
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
    notes,
    service_catalog_item_id,
    excluded_at,
    excluded_reason,
    excluded_original_total,
    fiber_check_id,
    service_catalog_items (
      category,
      pricing_unit
    )
  ),
  fiber_checks (
    id,
    appointment_line_item_id,
    unit_index,
    item_label,
    verdict,
    determined_by,
    fiber,
    confidence,
    has_tag,
    tag_text,
    burn_result,
    photo_urls,
    warnings,
    recommended_method,
    checked_by_label,
    created_at
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
    source,
    uploaded_by_label,
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

export function canViewTechAppointment(
  role: string,
  staffId: string | null,
  assignedStaffId: string | null,
): boolean {
  if (role === 'tech') {
    return Boolean(staffId && assignedStaffId === staffId)
  }
  return role === 'admin' || role === 'owner'
}

export function getTechStatusTransitionError(
  currentStatus: string,
  nextStatus: string,
): string | null {
  if (currentStatus === 'completed' && nextStatus !== 'completed') {
    return 'Completed jobs can only be reopened from Operations'
  }
  return null
}

export function isActiveTechJobStatus(status: string): boolean {
  return status === 'on_my_way' || status === 'in_progress'
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
    Boolean(row.service_concern_id) ||
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
        service_catalog_item_id?: string | null
        excluded_at?: string | null
        excluded_reason?: string | null
        excluded_original_total?: number | null
        fiber_check_id?: string | null
        service_catalog_items?: unknown
      }>)
    : []
  const fiberCheckRows = Array.isArray(row.fiber_checks)
    ? (row.fiber_checks as Array<Record<string, unknown>>)
    : []
  const photos = Array.isArray(row.ops_job_photos)
    ? (row.ops_job_photos as Array<{
        id: string
        public_url?: string | null
        label?: string | null
        watermarked?: boolean | null
        source?: string | null
        uploaded_by_label?: string | null
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
    assignedStaffUserId: row.assigned_staff_user_id
      ? String(row.assigned_staff_user_id)
      : null,
    appointmentDate: String(row.appointment_date),
    startTime: row.start_time ? String(row.start_time) : null,
    endTime: row.end_time ? String(row.end_time) : null,
    status: String(row.status),
    paymentStatus: row.payment_status ? String(row.payment_status) : null,
    recurringTemplateId: row.recurring_template_id
      ? String(row.recurring_template_id)
      : null,
    restorationProjectId: row.restoration_project_id
      ? String(row.restoration_project_id)
      : null,
    visitType: row.visit_type ? String(row.visit_type) : null,
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
          paymentTexts: [],
        }
      : null,
    lineItems: lineItems.map((line) => {
      const name = line.name_snapshot || 'Service'
      const catalog = unwrapRelation(
        (line as { service_catalog_items?: unknown }).service_catalog_items as
          | { category?: string | null; pricing_unit?: string | null }
          | Array<{ category?: string | null; pricing_unit?: string | null }>
          | null,
      )
      const catalogCategory = catalog?.category ?? null
      const catalogPricingUnit = catalog?.pricing_unit ?? null
      return {
        id: line.id,
        invoiceLineId:
          invoiceLines.find(
            (invoiceLine) => invoiceLine.appointment_line_item_id === line.id,
          )?.id ?? null,
        name,
        quantity: Number(line.quantity || 1),
        unitPrice: hidePricing ? null : Number(line.unit_price || 0),
        lineTotal: hidePricing ? null : Number(line.line_total || 0),
        notes: line.notes ?? null,
        catalogCategory,
        catalogPricingUnit,
        requiresFiberCheck: requiresFiberCheck({ name, catalogCategory }),
        excludedAt: line.excluded_at ?? null,
        excludedReason: line.excluded_reason ?? null,
        excludedOriginalTotal:
          line.excluded_original_total == null
            ? null
            : Number(line.excluded_original_total),
      }
    }),
    fiberChecks: fiberCheckRows.map((check) => ({
      id: String(check.id),
      appointmentLineItemId: check.appointment_line_item_id
        ? String(check.appointment_line_item_id)
        : null,
      unitIndex: Number(check.unit_index ?? 1),
      itemLabel: String(check.item_label ?? 'Item'),
      verdict: String(check.verdict) as FiberVerdict,
      determinedBy: String(check.determined_by ?? ''),
      fiber: check.fiber ? String(check.fiber) : null,
      confidence: check.confidence ? String(check.confidence) : null,
      hasTag: check.has_tag === true,
      tagText: check.tag_text ? String(check.tag_text) : null,
      burnResult: check.burn_result ? String(check.burn_result) : null,
      photoUrls: Array.isArray(check.photo_urls)
        ? (check.photo_urls as string[])
        : [],
      warnings: Array.isArray(check.warnings)
        ? (check.warnings as string[])
        : [],
      recommendedMethod: check.recommended_method
        ? String(check.recommended_method)
        : null,
      checkedByLabel: check.checked_by_label
        ? String(check.checked_by_label)
        : null,
      createdAt: String(check.created_at ?? ''),
    })),
    photos: photos.map((photo) => ({
      id: photo.id,
      publicUrl: photo.public_url ?? '',
      label: photo.label ?? null,
      watermarked: photo.watermarked === true,
      source: photo.source === 'customer' ? 'customer' : 'staff',
      uploadedByLabel: photo.uploaded_by_label ?? null,
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
  return getTechAppointmentForAccess(supabase, {
    role: 'tech',
    staffId: userId,
    appointmentId,
  })
}

export async function getTechAppointmentForAccess(
  supabase: SupabaseAdminClient,
  access: {
    role: string
    staffId: string | null
    appointmentId: string
  },
): Promise<TechAppointment | null> {
  const { data, error } = await supabase
    .from('ops_appointments')
    .select(TECH_APPOINTMENT_SELECT)
    .eq('id', access.appointmentId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const assignedStaffId = data.assigned_staff_user_id
    ? String(data.assigned_staff_user_id)
    : null
  if (!canViewTechAppointment(access.role, access.staffId, assignedStaffId)) {
    return null
  }

  return withPaymentTexts(supabase, mapTechAppointment(data))
}

async function withPaymentTexts(
  supabase: SupabaseAdminClient,
  appointment: TechAppointment,
): Promise<TechAppointment> {
  if (!appointment.invoice) return appointment
  const paymentTexts = await loadInvoicePaymentTexts(
    supabase,
    appointment.invoice.id,
  )
  return {
    ...appointment,
    invoice: {
      ...appointment.invoice,
      paymentTexts,
    },
  }
}

/**
 * Resolve the invoice a given user is allowed to take payment on for an
 * appointment. Back-office roles (admin/owner/dispatcher) can charge ANY
 * invoice; a tech is limited to jobs assigned to them (and never hidden-pricing
 * accounts). Returns null when there is no chargeable invoice with a positive
 * total. Shared by the Square tap-to-pay routes so payment works on every
 * invoice, not just the assigned tech's.
 */
export async function getChargeableInvoice(
  supabase: SupabaseAdminClient,
  params: { role: string; userId: string; appointmentId: string },
): Promise<{
  invoiceId: string
  total: number
  invoiceNumber: number | null
} | null> {
  const { role, userId, appointmentId } = params
  const privileged =
    role === 'admin' || role === 'owner' || role === 'dispatcher'

  if (privileged) {
    const { data, error } = await supabase
      .from('ops_appointments')
      .select('id, ops_invoices ( id, invoice_number, total )')
      .eq('id', appointmentId)
      .maybeSingle()
    if (error) throw error
    const inv = unwrapRelation(
      (data as { ops_invoices?: unknown } | null)?.ops_invoices as
        | { id: string; invoice_number: number | null; total: number | null }
        | { id: string; invoice_number: number | null; total: number | null }[]
        | null,
    )
    if (!inv) return null
    const total = Number(inv.total || 0)
    if (!Number.isFinite(total) || total <= 0) return null
    return {
      invoiceId: inv.id,
      total,
      invoiceNumber: inv.invoice_number ?? null,
    }
  }

  const appointment = await getAssignedTechAppointment(
    supabase,
    userId,
    appointmentId,
  )
  if (!appointment || appointment.hidePricing || !appointment.invoice) {
    return null
  }
  const total = Number(appointment.invoice.total || 0)
  if (!Number.isFinite(total) || total <= 0) return null
  return {
    invoiceId: appointment.invoice.id,
    total,
    invoiceNumber: appointment.invoice.invoiceNumber ?? null,
  }
}
