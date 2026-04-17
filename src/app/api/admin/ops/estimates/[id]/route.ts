import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  computeAreaQuantity,
  parseAreaSegmentsInput,
  quantityFromSegments,
  supportsDimensions,
} from '@/lib/ops/estimates'

const ESTIMATE_DETAIL_SELECT = `
  *,
  ops_customers!ops_appointments_customer_id_fkey (
    id,
    full_name,
    first_name,
    last_name,
    business_name,
    email,
    phone,
    notes
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
  ),
  ops_appointment_line_items (
    id,
    service_catalog_item_id,
    name_snapshot,
    notes,
    quantity,
    unit_price,
    duration_minutes,
    buffer_minutes,
    line_total,
    length_value,
    width_value,
    pricing_unit_snapshot,
    area_segments,
    created_at
  ),
  ops_job_photos (
    id,
    storage_path,
    public_url,
    label,
    watermarked,
    created_at
  )
`

type IncomingLineItem = {
  id?: string | null
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

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function loadEstimate(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
) {
  const { data, error } = await supabase
    .from('ops_appointments')
    .select(ESTIMATE_DETAIL_SELECT)
    .eq('id', id)
    .eq('kind', 'estimate')
    .single()

  if (error) throw error
  return data
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'marketing', 'tech'])
    const supabase = createAdminClient()
    const { id } = await params

    const estimate = await loadEstimate(supabase, id)
    return NextResponse.json({ estimate })
  } catch (error) {
    console.error('[ops/estimates/:id][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load estimate' },
      { status: 500 },
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'tech',
    ])
    const supabase = createAdminClient()
    const { id } = await params
    const body = await request.json()

    const { data: current, error: currentError } = await supabase
      .from('ops_appointments')
      .select(`*, ops_appointment_line_items (id)`)
      .eq('id', id)
      .eq('kind', 'estimate')
      .single()

    if (currentError) throw currentError

    // --- Customer / address inline edits (mirrors invoice PATCH) ---
    if (body.customer && typeof body.customer === 'object') {
      const c = body.customer
      const cu: Record<string, unknown> = {}
      if (c.first_name !== undefined) cu.first_name = c.first_name
      if (c.last_name !== undefined) cu.last_name = c.last_name
      if (c.full_name !== undefined) {
        cu.full_name = c.full_name
      } else if (c.first_name !== undefined || c.last_name !== undefined) {
        cu.full_name =
          [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Customer'
      }
      if (c.business_name !== undefined) cu.business_name = c.business_name
      if (c.email !== undefined) cu.email = c.email || null
      if (c.phone !== undefined) cu.phone = c.phone
      if (c.notes !== undefined) cu.notes = c.notes || null
      if (Object.keys(cu).length > 0) {
        cu.updated_at = new Date().toISOString()
        await supabase
          .from('ops_customers')
          .update(cu)
          .eq('id', current.customer_id)
      }
    }

    if (body.address && typeof body.address === 'object') {
      const a = body.address
      const au: Record<string, unknown> = {}
      if (a.street_1 !== undefined) au.street_1 = a.street_1
      if (a.street_2 !== undefined) au.street_2 = a.street_2 || null
      if (a.city !== undefined) au.city = a.city
      if (a.state !== undefined) au.state = a.state
      if (a.zip_code !== undefined) au.zip_code = a.zip_code
      if (a.gate_code !== undefined) au.gate_code = a.gate_code || null
      if (a.notes !== undefined) au.notes = a.notes || null
      if (Object.keys(au).length > 0) {
        au.updated_at = new Date().toISOString()
        await supabase
          .from('ops_service_addresses')
          .update(au)
          .eq('id', current.service_address_id)
      }
    }

    // --- Schedule changes ---
    const scheduleUpdate: Record<string, unknown> = {}
    if (body.appointment_date !== undefined)
      scheduleUpdate.appointment_date = String(body.appointment_date)
    if (body.start_time !== undefined) {
      const s = String(body.start_time)
      scheduleUpdate.start_time = `${s}:00`.slice(0, 8)
    }
    if (body.end_time !== undefined) {
      const e = String(body.end_time)
      scheduleUpdate.end_time = `${e}:00`.slice(0, 8)
    }
    if (body.internal_notes !== undefined) {
      scheduleUpdate.internal_notes = body.internal_notes || null
    }
    if (body.estimate_status !== undefined) {
      const s = String(body.estimate_status)
      if (!['draft', 'sent', 'accepted', 'declined', 'converted'].includes(s)) {
        return NextResponse.json(
          { error: `Invalid estimate_status: ${s}` },
          { status: 400 },
        )
      }
      scheduleUpdate.estimate_status = s
    }
    if (body.status !== undefined) {
      scheduleUpdate.status = String(body.status)
    }

    // --- Line items ---
    const lineItemsInBody = Object.prototype.hasOwnProperty.call(
      body,
      'line_items',
    )
    const lineItemsPayload: IncomingLineItem[] = Array.isArray(body.line_items)
      ? body.line_items
      : []

    let subtotal: number | null = null

    if (lineItemsInBody) {
      const existingIds = (current.ops_appointment_line_items || []).map(
        (l: { id: string }) => l.id,
      )
      const submittedRealIds = lineItemsPayload
        .map((i) => String(i.id || ''))
        .filter((lid) => !lid.startsWith('new-') && lid.length > 0)
      const idsToDelete = existingIds.filter(
        (dbId: string) => !submittedRealIds.includes(dbId),
      )

      if (idsToDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from('ops_appointment_line_items')
          .delete()
          .in('id', idsToDelete)
        if (deleteError) throw deleteError
      }

      const serviceIds = lineItemsPayload
        .map((l) => l.service_catalog_item_id)
        .filter(Boolean) as string[]

      const { data: services } = serviceIds.length
        ? await supabase
            .from('service_catalog_items')
            .select('id, pricing_unit')
            .in('id', serviceIds)
        : { data: [] }

      const serviceMap = new Map((services || []).map((s) => [s.id, s]))

      for (const item of lineItemsPayload) {
        const lineId = String(item.id || '').trim()
        const isNew = !lineId || lineId.startsWith('new-')

        const pricingUnit =
          item.pricing_unit_snapshot ||
          (item.service_catalog_item_id
            ? (serviceMap.get(String(item.service_catalog_item_id))
                ?.pricing_unit ?? null)
            : null)

        let lengthValue = toNumberOrNull(item.length_value)
        let widthValue = toNumberOrNull(item.width_value)
        const providedQty = toNumberOrNull(item.quantity)
        const segments = parseAreaSegmentsInput(item.area_segments)

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

        const unitPrice = Number(item.unit_price ?? 0)
        const durationMinutes = Number(item.duration_minutes ?? 0)
        const bufferMinutes = Number(item.buffer_minutes ?? 0)
        const lineTotal = Number((unitPrice * quantity).toFixed(2))

        const row = {
          service_catalog_item_id: item.service_catalog_item_id
            ? String(item.service_catalog_item_id)
            : null,
          name_snapshot: String(item.name_snapshot || '').trim() || 'Line item',
          notes: item.notes ? String(item.notes) : null,
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

        if (isNew) {
          const { error: insertError } = await supabase
            .from('ops_appointment_line_items')
            .insert({ appointment_id: id, ...row })
          if (insertError) throw insertError
        } else {
          const { error: updateError } = await supabase
            .from('ops_appointment_line_items')
            .update(row)
            .eq('id', lineId)
          if (updateError) throw updateError
        }
      }

      const { data: refreshed, error: refreshedError } = await supabase
        .from('ops_appointment_line_items')
        .select('line_total')
        .eq('appointment_id', id)
      if (refreshedError) throw refreshedError
      subtotal = (refreshed || []).reduce(
        (sum, r) => sum + Number(r.line_total || 0),
        0,
      )
      scheduleUpdate.quoted_total = Number(subtotal.toFixed(2))
    }

    if (Object.keys(scheduleUpdate).length > 0) {
      scheduleUpdate.updated_at = new Date().toISOString()
      const { error: updateError } = await supabase
        .from('ops_appointments')
        .update(scheduleUpdate)
        .eq('id', id)
        .eq('kind', 'estimate')
      if (updateError) throw updateError

      if (
        body.estimate_status &&
        body.estimate_status !== current.estimate_status
      ) {
        await supabase.from('ops_appointment_status_events').insert({
          appointment_id: id,
          from_status: current.estimate_status,
          to_status: body.estimate_status,
          changed_by: access.id,
          notes: `Estimate status changed to ${body.estimate_status}`,
        })
      }
    }

    const estimate = await loadEstimate(supabase, id)
    return NextResponse.json({ estimate })
  } catch (error) {
    console.error('[ops/estimates/:id][PATCH] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update estimate' },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const { id } = await params

    const { data: current } = await supabase
      .from('ops_appointments')
      .select('id, kind, converted_appointment_id')
      .eq('id', id)
      .eq('kind', 'estimate')
      .single()

    if (!current) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
    }

    // Appointment line items, status events, and job photos all cascade off
    // the appointment on delete per the schema's ON DELETE rules.
    const { error: deleteError } = await supabase
      .from('ops_appointments')
      .delete()
      .eq('id', id)
      .eq('kind', 'estimate')

    if (deleteError) throw deleteError

    return NextResponse.json({
      success: true,
      converted_appointment_id: current.converted_appointment_id ?? null,
    })
  } catch (error) {
    console.error('[ops/estimates/:id][DELETE] Error:', error)
    return NextResponse.json(
      { error: 'Failed to delete estimate' },
      { status: 500 },
    )
  }
}
