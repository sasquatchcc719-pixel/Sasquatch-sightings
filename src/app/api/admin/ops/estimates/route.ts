import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  applyAppointmentBuffer,
  calculateLineItemDurationMinutes,
} from '@/lib/ops/availability'
import {
  computeAreaQuantity,
  parseAreaSegmentsInput,
  quantityFromSegments,
  supportsDimensions,
} from '@/lib/ops/estimates'
import { normalizeOpsPhone, opsPhoneLookupVariants } from '@/lib/ops/phone'
import { resolveServiceAddress } from '@/lib/ops/addresses'

type IncomingLineItem = {
  service_catalog_item_id?: string | null
  name_snapshot?: string | null
  notes?: string | null
  quantity?: number | string | null
  unit_price?: number | string | null
  duration_minutes?: number | string | null
  buffer_minutes?: number | string | null
  length_value?: number | string | null
  width_value?: number | string | null
  pricing_unit_snapshot?: string | null
  area_segments?: unknown
}

type NormalizedEstimateLine = {
  service_catalog_item_id: string | null
  name_snapshot: string
  notes: string | null
  quantity: number
  unit_price: number
  duration_minutes: number
  buffer_minutes: number
  line_total: number
  length_value: number | null
  width_value: number | null
  pricing_unit_snapshot: string | null
  area_segments: unknown
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function addMinutesToTime(value: string, minutesToAdd: number): string {
  const [hours, minutes] = value.split(':').map(Number)
  const total = hours * 60 + minutes + minutesToAdd
  const normalized = ((total % 1440) + 1440) % 1440
  const nextHours = Math.floor(normalized / 60)
  const nextMinutes = normalized % 60
  return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}:00`
}

const ESTIMATE_SELECT = `
  id,
  appointment_date,
  start_time,
  end_time,
  status,
  estimate_status,
  converted_appointment_id,
  quoted_total,
  internal_notes,
  kind,
  created_at,
  updated_at,
  ops_customers!ops_appointments_customer_id_fkey (
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
`

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'marketing'])
    const supabase = createAdminClient()

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const customerId = searchParams.get('customer_id')
    const dateFrom = searchParams.get('date_from')
    const dateTo = searchParams.get('date_to')

    let query = supabase
      .from('ops_appointments')
      .select(ESTIMATE_SELECT)
      .eq('kind', 'estimate')
      .order('appointment_date', { ascending: false })
      .order('start_time', { ascending: false })

    if (status) {
      query = query.eq('estimate_status', status)
    }
    if (customerId) {
      query = query.eq('customer_id', customerId)
    }
    if (dateFrom) {
      query = query.gte('appointment_date', dateFrom)
    }
    if (dateTo) {
      query = query.lte('appointment_date', dateTo)
    }

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ estimates: data || [] })
  } catch (error) {
    console.error('[ops/estimates][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load estimates' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'tech',
    ])
    const supabase = createAdminClient()
    const body = await request.json()

    // --- Schedule validation ---
    const appointmentDate = String(body.appointment_date || '').trim()
    const startTime = String(body.start_time || '').trim()
    if (!appointmentDate || !startTime) {
      return NextResponse.json(
        { error: 'Appointment date and start time are required' },
        { status: 400 },
      )
    }

    // --- Customer ---
    let customerId = body.customer_id ? String(body.customer_id) : null
    const inlineCustomer = body.customer
    if (!customerId && inlineCustomer) {
      const fullName =
        inlineCustomer.full_name ||
        [inlineCustomer.first_name, inlineCustomer.last_name]
          .filter(Boolean)
          .join(' ')
          .trim() ||
        inlineCustomer.business_name ||
        'Customer'
      const phoneRaw = String(inlineCustomer.phone || '').trim()
      if (!phoneRaw) {
        return NextResponse.json(
          { error: 'Customer phone is required when creating inline' },
          { status: 400 },
        )
      }
      const phone = normalizeOpsPhone(phoneRaw)
      const variants = opsPhoneLookupVariants(phoneRaw)
      const { data: matches, error: matchError } = await supabase
        .from('ops_customers')
        .select('id')
        .in('phone', variants)
        .order('updated_at', { ascending: false })
        .limit(1)
      if (matchError) throw matchError
      const existing = matches?.[0]
      if (existing) {
        customerId = existing.id
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('ops_customers')
          .insert({
            full_name: fullName,
            first_name: inlineCustomer.first_name || null,
            last_name: inlineCustomer.last_name || null,
            business_name: inlineCustomer.business_name || null,
            email: inlineCustomer.email || null,
            phone,
            notes: inlineCustomer.notes || null,
          })
          .select('id')
          .single()
        if (insertError) throw insertError
        customerId = inserted.id
      }
    }
    if (!customerId) {
      return NextResponse.json(
        { error: 'customer_id or inline customer is required' },
        { status: 400 },
      )
    }

    // --- Address ---
    let addressId = body.service_address_id
      ? String(body.service_address_id)
      : null
    const inlineAddress = body.address
    if (!addressId && inlineAddress) {
      const resolved = await resolveServiceAddress(
        supabase,
        customerId,
        inlineAddress,
      )
      addressId = resolved?.id || null
    }
    if (!addressId) {
      return NextResponse.json(
        { error: 'service_address_id or inline address is required' },
        { status: 400 },
      )
    }

    // --- Line items ---
    const rawLines: IncomingLineItem[] = Array.isArray(body.line_items)
      ? body.line_items
      : []

    const serviceIds = rawLines
      .map((l) => l.service_catalog_item_id)
      .filter(Boolean) as string[]

    const { data: services } = serviceIds.length
      ? await supabase
          .from('service_catalog_items')
          .select(
            'id, name, base_price, default_duration_minutes, buffer_minutes, pricing_unit',
          )
          .in('id', serviceIds)
      : { data: [] }

    const serviceMap = new Map((services || []).map((s) => [s.id, s]))

    const normalized: NormalizedEstimateLine[] = rawLines.map((line) => {
      const service = line.service_catalog_item_id
        ? serviceMap.get(String(line.service_catalog_item_id))
        : null

      const pricingUnit =
        line.pricing_unit_snapshot ||
        (service && typeof service === 'object' && 'pricing_unit' in service
          ? (service.pricing_unit as string | null)
          : null)

      let lengthValue = toNumberOrNull(line.length_value)
      let widthValue = toNumberOrNull(line.width_value)
      const providedQty = toNumberOrNull(line.quantity)
      const segments = parseAreaSegmentsInput(line.area_segments)

      let quantity: number
      let areaSegmentsToStore: unknown = null

      if (supportsDimensions(pricingUnit) && segments?.length) {
        const q = quantityFromSegments(segments, pricingUnit)
        areaSegmentsToStore = segments
        lengthValue = segments[0]?.length ?? null
        widthValue = segments[0]?.width ?? null
        quantity =
          q != null && q > 0
            ? q
            : providedQty != null && providedQty > 0
              ? providedQty
              : 1
      } else if (supportsDimensions(pricingUnit)) {
        const computedQty = computeAreaQuantity(
          lengthValue,
          widthValue,
          pricingUnit,
        )
        quantity =
          providedQty != null && providedQty > 0
            ? providedQty
            : computedQty != null && computedQty > 0
              ? computedQty
              : 1
      } else {
        quantity =
          providedQty != null && providedQty > 0 ? providedQty : 1
      }

      const unitPrice = Number(
        line.unit_price ??
          (service as { base_price?: number })?.base_price ??
          0,
      )
      const durationMinutes = Number(
        line.duration_minutes ??
          (service as { default_duration_minutes?: number })
            ?.default_duration_minutes ??
          30,
      )
      const bufferMinutes = Number(
        line.buffer_minutes ??
          (service as { buffer_minutes?: number })?.buffer_minutes ??
          0,
      )

      const lineTotal = Number((unitPrice * quantity).toFixed(2))

      return {
        service_catalog_item_id: line.service_catalog_item_id
          ? String(line.service_catalog_item_id)
          : null,
        name_snapshot: String(
          line.name_snapshot ||
            (service as { name?: string })?.name ||
            'Measurement item',
        ).trim(),
        notes: line.notes ? String(line.notes) : null,
        quantity,
        unit_price: unitPrice,
        duration_minutes: durationMinutes,
        buffer_minutes: bufferMinutes,
        line_total: lineTotal,
        length_value: lengthValue,
        width_value: widthValue,
        pricing_unit_snapshot: pricingUnit ? String(pricingUnit) : null,
        area_segments: areaSegmentsToStore,
      }
    })

    // --- Duration for the measuring visit ---
    // Estimates default to 30 minutes when there are no line items yet. If line
    // items are provided, sum their durations (not scaled by quantity since
    // measuring time is about the space, not the volume of work).
    const totalMeasureMinutes = normalized.length
      ? normalized.reduce(
          (sum, item) =>
            sum +
            calculateLineItemDurationMinutes({
              durationMinutes: item.duration_minutes,
              quantity: item.quantity,
              pricingUnit: item.pricing_unit_snapshot,
              unitPrice: item.unit_price,
              nameSnapshot: item.name_snapshot,
              applyOversizedResidentialDollarDuration: false,
            }),
          0,
        )
      : 30

    const buffered = applyAppointmentBuffer(
      totalMeasureMinutes > 0 ? totalMeasureMinutes : 30,
    )

    const requestedEndTime = body.end_time ? String(body.end_time) : null
    const endTime =
      requestedEndTime && /^\d{2}:\d{2}/.test(requestedEndTime)
        ? `${requestedEndTime}:00`.slice(0, 8)
        : addMinutesToTime(startTime, buffered)

    const subtotal = normalized.reduce((sum, item) => sum + item.line_total, 0)

    // --- Insert appointment (kind=estimate) ---
    const { data: appointment, error: appointmentError } = await supabase
      .from('ops_appointments')
      .insert({
        customer_id: customerId,
        service_address_id: addressId,
        appointment_date: appointmentDate,
        start_time: `${startTime}:00`.slice(0, 8),
        end_time: endTime,
        status: 'confirmed',
        payment_status: 'unpaid',
        booking_channel: 'admin',
        source: 'internal',
        kind: 'estimate',
        estimate_status: 'draft',
        quickbooks_sync_status: 'not_synced',
        quoted_total: Number(subtotal.toFixed(2)),
        internal_notes: body.internal_notes
          ? String(body.internal_notes)
          : null,
      })
      .select('id')
      .single()

    if (appointmentError) throw appointmentError

    // --- Line items ---
    if (normalized.length > 0) {
      const payload = normalized.map((item) => ({
        appointment_id: appointment.id,
        ...item,
      }))
      const { error: lineError } = await supabase
        .from('ops_appointment_line_items')
        .insert(payload)
      if (lineError) throw lineError
    }

    // --- Audit event ---
    await supabase.from('ops_appointment_status_events').insert({
      appointment_id: appointment.id,
      from_status: null,
      to_status: 'confirmed',
      changed_by: access.id,
      notes: 'Estimate created manually',
    })

    return NextResponse.json({ estimate_id: appointment.id }, { status: 201 })
  } catch (error) {
    console.error('[ops/estimates][POST] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create estimate' },
      { status: 500 },
    )
  }
}
