import { sortLineItems } from '@/lib/ops/line-item-order'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  addMinutesToTimeWithinDay,
  applyAppointmentBuffer,
  calculateAppointmentDurationFromTotal,
} from '@/lib/ops/availability'
import { findAppointmentConflict } from '@/lib/ops/availability-bundle'
import { sendOpsLifecycleCommunications } from '@/lib/ops/communications'
import { ensureCustomerQuickBooksSyncJob } from '@/lib/ops/quickbooks-sync-jobs'
import {
  buildQuickBooksCustomerPayload,
  getQuickBooksSyncStatus,
} from '@/lib/quickbooks'
import { syncAppointmentToQuickBooks } from '@/lib/quickbooks-api'

type Db = SupabaseClient

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

function normalizedTime(value: string): string {
  return `${value}:00`.slice(0, 8)
}

function timeMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export type PreparedEstimateConversion = {
  estimate_id: string
  expected_updated_at: string
  expected_status: string
  appointment_date: string
  start_time: string
  end_time: string
  assigned_staff_user_id: string
  assigned_staff_auth_user_id: string
  technician_name: string
  discount_amount: number
  subtotal: number
  total: number
  service_minutes: number
  total_minutes_with_buffer: number
  sync_status: 'held' | 'pending' | 'synced' | 'failed'
  notify_customer: boolean
  sync_quickbooks: boolean
  customer: {
    id: string
    full_name: string
    business_name: string | null
    email: string | null
    phone: string
  }
  address: {
    id: string
    street_1: string
    street_2: string | null
    city: string
    state: string
    zip_code: string
  }
  line_items: Array<{
    id: string
    name: string
    quantity: number
    unit_price: number
    line_total: number
    length_value: number | null
    width_value: number | null
    pricing_unit: string | null
    area_segments: unknown
  }>
  preview_fingerprint: string
}

export async function prepareEstimateConversion(params: {
  supabase: Db
  estimateId: string
  appointmentDate: string
  startTime: string
  endTime?: string | null
  assignedStaffUserId: string
  discountAmount?: number
  allowConflict?: boolean
  notifyCustomer?: boolean
  syncQuickBooks?: boolean
}): Promise<PreparedEstimateConversion> {
  const { data: staff, error: staffError } = await params.supabase
    .from('staff_users')
    .select('id, user_id, display_name')
    .eq('id', params.assignedStaffUserId)
    .eq('is_active', true)
    .maybeSingle()
  if (staffError) throw staffError
  if (!staff) throw new Error('Choose an active technician')

  const { data: estimate, error: estimateError } = await params.supabase
    .from('ops_appointments')
    .select(
      `id, kind, customer_id, service_address_id, estimate_status,
       converted_appointment_id, updated_at,
       ops_customers!ops_appointments_customer_id_fkey(id, full_name, business_name, email, phone),
       ops_service_addresses(id, street_1, street_2, city, state, zip_code),
       ops_appointment_line_items(id, sort_order, created_at, name_snapshot, quantity, unit_price, line_total,
         length_value, width_value, pricing_unit_snapshot, area_segments)`,
    )
    .eq('id', params.estimateId)
    .eq('kind', 'estimate')
    .maybeSingle()
  if (estimateError) throw estimateError
  if (!estimate) throw new Error('Estimate not found')
  if (
    estimate.converted_appointment_id ||
    estimate.estimate_status === 'converted'
  ) {
    throw new Error('This estimate has already been converted')
  }

  const customer = one(estimate.ops_customers)
  const address = one(estimate.ops_service_addresses)
  const sourceLines = sortLineItems(
    Array.isArray(estimate.ops_appointment_line_items)
      ? estimate.ops_appointment_line_items
      : [],
  )
  if (!customer || !address) {
    throw new Error('Estimate is missing its customer or service address')
  }
  if (!sourceLines.length) {
    throw new Error('Add at least one line item before converting')
  }

  const subtotal = Number(
    sourceLines
      .reduce((sum, line) => sum + Number(line.line_total || 0), 0)
      .toFixed(2),
  )
  const discountAmount = Number(
    Math.max(0, Number(params.discountAmount || 0)).toFixed(2),
  )
  const total = Number(Math.max(0, subtotal - discountAmount).toFixed(2))
  const serviceMinutes = calculateAppointmentDurationFromTotal(subtotal)
  const totalMinutesWithBuffer = applyAppointmentBuffer(serviceMinutes)
  const startTime = normalizedTime(params.startTime)
  const endTime = params.endTime
    ? normalizedTime(params.endTime)
    : addMinutesToTimeWithinDay(startTime, totalMinutesWithBuffer)
  if (timeMinutes(endTime) <= timeMinutes(startTime)) {
    throw new Error('The conversion end time must be after its start time')
  }

  if (!params.allowConflict) {
    const conflict = await findAppointmentConflict(params.supabase, {
      date: params.appointmentDate,
      startTime,
      endTime,
      staffUserId: params.assignedStaffUserId,
      staffAuthUserId: staff.user_id,
    })
    if (conflict) {
      throw new Error(
        `That time overlaps existing work from ${String(conflict.start_time).slice(0, 5)} to ${String(conflict.end_time).slice(0, 5)} on ${staff.display_name}'s calendar`,
      )
    }
  }

  const lineItems = sourceLines.map((line) => ({
    id: line.id,
    name: line.name_snapshot,
    quantity: Number(line.quantity || 0),
    unit_price: Number(line.unit_price || 0),
    line_total: Number(line.line_total || 0),
    length_value:
      line.length_value === null ? null : Number(line.length_value || 0),
    width_value:
      line.width_value === null ? null : Number(line.width_value || 0),
    pricing_unit: line.pricing_unit_snapshot || null,
    area_segments: line.area_segments ?? null,
  }))
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        estimate_id: estimate.id,
        estimate_status: estimate.estimate_status || 'draft',
        estimate_updated_at: estimate.updated_at,
        appointment_date: params.appointmentDate,
        start_time: startTime,
        end_time: endTime,
        assigned_staff_user_id: staff.id,
        discount_amount: discountAmount,
        subtotal,
        total,
        line_items: lineItems,
      }),
    )
    .digest('hex')

  return {
    estimate_id: estimate.id,
    expected_updated_at: estimate.updated_at,
    expected_status: estimate.estimate_status || 'draft',
    appointment_date: params.appointmentDate,
    start_time: startTime,
    end_time: endTime,
    assigned_staff_user_id: staff.id,
    assigned_staff_auth_user_id: staff.user_id,
    technician_name: staff.display_name,
    discount_amount: discountAmount,
    subtotal,
    total,
    service_minutes: serviceMinutes,
    total_minutes_with_buffer: totalMinutesWithBuffer,
    sync_status: getQuickBooksSyncStatus(),
    notify_customer: Boolean(params.notifyCustomer),
    sync_quickbooks: params.syncQuickBooks !== false,
    customer: {
      id: customer.id,
      full_name: customer.full_name || 'Customer',
      business_name: customer.business_name || null,
      email: customer.email || null,
      phone: customer.phone,
    },
    address: {
      id: address.id,
      street_1: address.street_1,
      street_2: address.street_2 || null,
      city: address.city,
      state: address.state,
      zip_code: address.zip_code,
    },
    line_items: lineItems,
    preview_fingerprint: fingerprint,
  }
}

export async function executeAtomicEstimateConversion(params: {
  supabase: Db
  prepared: PreparedEstimateConversion
  actorId: string
  allowConflict?: boolean
  notifyCustomer?: boolean
  syncQuickBooks?: boolean
  sendCommunications?: typeof sendOpsLifecycleCommunications
  syncAppointment?: typeof syncAppointmentToQuickBooks
}) {
  const current = await prepareEstimateConversion({
    supabase: params.supabase,
    estimateId: params.prepared.estimate_id,
    appointmentDate: params.prepared.appointment_date,
    startTime: params.prepared.start_time,
    endTime: params.prepared.end_time,
    assignedStaffUserId: params.prepared.assigned_staff_user_id,
    discountAmount: params.prepared.discount_amount,
    allowConflict: params.allowConflict,
    notifyCustomer: params.notifyCustomer,
    syncQuickBooks: params.syncQuickBooks,
  })
  if (
    current.preview_fingerprint !== params.prepared.preview_fingerprint ||
    current.expected_updated_at !== params.prepared.expected_updated_at ||
    current.expected_status !== params.prepared.expected_status
  ) {
    throw new Error(
      'The estimate, pricing, measurements, technician, or schedule changed after preview; preview again',
    )
  }

  const { data, error } = await params.supabase.rpc('mcp_convert_estimate', {
    p_estimate_id: current.estimate_id,
    p_expected_updated_at: current.expected_updated_at,
    p_expected_status: current.expected_status,
    p_appointment_date: current.appointment_date,
    p_start_time: current.start_time,
    p_end_time: current.end_time,
    p_assigned_staff_user_id: current.assigned_staff_user_id,
    p_discount_amount: current.discount_amount,
    p_actor_user_id: params.actorId,
    p_sync_status: current.sync_status,
    p_allow_conflict: Boolean(params.allowConflict),
  })
  if (error) throw error
  const result = data as {
    appointment_id: string
    invoice_id: string
    estimate_id: string
    subtotal: number
    discount_amount: number
    total: number
  }

  const warnings: string[] = []
  if (params.syncQuickBooks !== false) {
    try {
      await ensureCustomerQuickBooksSyncJob(
        params.supabase as ReturnType<
          typeof import('@/supabase/server').createAdminClient
        >,
        current.customer.id,
        buildQuickBooksCustomerPayload({
          customerId: current.customer.id,
          fullName: current.customer.full_name,
          businessName: current.customer.business_name,
          email: current.customer.email,
          phone: current.customer.phone,
          address: current.address,
        }),
      )
      await (params.syncAppointment || syncAppointmentToQuickBooks)(
        result.appointment_id,
      )
    } catch (syncError) {
      console.error(
        '[estimate-conversion] QuickBooks follow-up failed:',
        syncError,
      )
      warnings.push(
        'The conversion committed, but QuickBooks follow-up failed. Do not convert again; retry synchronization for the created appointment.',
      )
    }
  }

  if (params.notifyCustomer) {
    try {
      await (params.sendCommunications || sendOpsLifecycleCommunications)({
        event: 'job_scheduled',
        appointmentId: result.appointment_id,
      })
    } catch (communicationError) {
      console.error(
        '[estimate-conversion] lifecycle communication failed:',
        communicationError,
      )
      warnings.push(
        'The conversion committed, but scheduled-job communications failed. Do not convert again; inspect communication history before sending manually.',
      )
    }
  }

  return {
    ...result,
    customer_contact_requested: Boolean(params.notifyCustomer),
    quickbooks_sync_requested: params.syncQuickBooks !== false,
    warnings,
  }
}
