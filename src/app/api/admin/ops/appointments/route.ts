import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  buildQuickBooksCustomerPayload,
  buildQuickBooksInvoicePayload,
  getQuickBooksSyncStatus,
} from '@/lib/quickbooks'
import {
  applyAppointmentBuffer,
  calculateLineItemDurationMinutes,
  getAvailableSlots,
} from '@/lib/ops/availability'
import { sendOpsLifecycleCommunications } from '@/lib/ops/communications'
import { syncAppointmentToQuickBooks } from '@/lib/quickbooks-api'

type IncomingLineItem = {
  service_catalog_item_id?: string | null
  name_snapshot?: string | null
  quantity?: number | string | null
  unit_price?: number | string | null
  duration_minutes?: number | string | null
  buffer_minutes?: number | string | null
  notes?: string | null
}

type NormalizedLineItem = {
  service_catalog_item_id: string | null
  name_snapshot: string
  quantity: number
  unit_price: number
  duration_minutes: number
  buffer_minutes: number
  line_total: number
  notes: string | null
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}

function addMinutesToTime(value: string, minutesToAdd: number): string {
  const [hours, minutes] = value.split(':').map(Number)
  const total = hours * 60 + minutes + minutesToAdd
  const normalized = ((total % 1440) + 1440) % 1440
  const nextHours = Math.floor(normalized / 60)
  const nextMinutes = normalized % 60
  return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}:00`
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const body = await request.json()

    const firstName = String(body.customer?.first_name || '').trim()
    const lastName = String(body.customer?.last_name || '').trim()
    const businessName = body.customer?.business_name
      ? String(body.customer.business_name).trim()
      : null
    const fullName =
      String(body.customer?.full_name || '').trim() ||
      [firstName, lastName].filter(Boolean).join(' ').trim()
    const phone = normalizePhone(String(body.customer?.phone || '').trim())
    const email = body.customer?.email
      ? String(body.customer.email).trim()
      : null

    if (!firstName || !lastName || !phone || !email) {
      return NextResponse.json(
        {
          error:
            'Customer first name, last name, email, and phone are required',
        },
        { status: 400 },
      )
    }

    const addressId = body.address?.id ? String(body.address.id).trim() : null
    const street1 = String(body.address?.street_1 || '').trim()
    const city = String(body.address?.city || '').trim()
    const state = String(body.address?.state || 'CO').trim()
    const zipCode = String(body.address?.zip_code || '').trim()
    if (!addressId && (!street1 || !city || !state || !zipCode)) {
      return NextResponse.json(
        { error: 'Service address must include street, city, and zip code' },
        { status: 400 },
      )
    }

    const lineItems: IncomingLineItem[] = Array.isArray(body.line_items)
      ? body.line_items
      : []
    if (lineItems.length === 0) {
      return NextResponse.json(
        { error: 'At least one service line item is required' },
        { status: 400 },
      )
    }

    const serviceIds = lineItems
      .map((item: IncomingLineItem) => item.service_catalog_item_id)
      .filter(Boolean)

    const { data: services, error: servicesError } = await supabase
      .from('service_catalog_items')
      .select('*')
      .in(
        'id',
        serviceIds.length > 0
          ? serviceIds
          : ['00000000-0000-0000-0000-000000000000'],
      )

    if (servicesError && serviceIds.length > 0) {
      throw servicesError
    }

    const serviceMap = new Map(
      (services || []).map((service) => [service.id, service]),
    )

    const normalizedLineItems: NormalizedLineItem[] = lineItems.map((item) => {
      const service = item.service_catalog_item_id
        ? serviceMap.get(String(item.service_catalog_item_id))
        : null
      const quantity = Number(item.quantity || 1)
      const unitPrice = Number(item.unit_price ?? service?.base_price ?? 0)
      const durationMinutes = Number(
        item.duration_minutes ?? service?.default_duration_minutes ?? 0,
      )
      const bufferMinutes = Number(
        item.buffer_minutes ?? service?.buffer_minutes ?? 0,
      )
      const lineTotal = Number((unitPrice * quantity).toFixed(2))

      return {
        service_catalog_item_id: item.service_catalog_item_id
          ? String(item.service_catalog_item_id)
          : null,
        name_snapshot: String(item.name_snapshot || service?.name || '').trim(),
        quantity,
        unit_price: unitPrice,
        duration_minutes: durationMinutes,
        buffer_minutes: bufferMinutes,
        line_total: lineTotal,
        notes: item.notes ? String(item.notes) : null,
      }
    })

    if (
      normalizedLineItems.some(
        (item: NormalizedLineItem) => !item.name_snapshot,
      )
    ) {
      return NextResponse.json(
        { error: 'Every line item needs a service name' },
        { status: 400 },
      )
    }

    const totalMinutes = normalizedLineItems.reduce(
      (sum: number, item: NormalizedLineItem) =>
        sum +
        calculateLineItemDurationMinutes({
          durationMinutes: item.duration_minutes,
          quantity: item.quantity,
        }),
      0,
    )

    if (totalMinutes <= 0) {
      return NextResponse.json(
        {
          error:
            'At least one selected service needs a duration. Set durations in Operations → Services before booking.',
        },
        { status: 400 },
      )
    }

    const totalMinutesWithBuffer = applyAppointmentBuffer(totalMinutes)

    const quotedSubtotal = normalizedLineItems.reduce(
      (sum: number, item: NormalizedLineItem) => sum + item.line_total,
      0,
    )
    const discountAmount = Math.max(0, Number(body.discount_amount || 0))
    const quotedTotal = Math.max(0, quotedSubtotal - discountAmount)

    const appointmentDate = String(
      body.appointment?.appointment_date || '',
    ).trim()
    const startTime = String(body.appointment?.start_time || '').trim()
    if (!appointmentDate || !startTime) {
      return NextResponse.json(
        { error: 'Appointment date and start time are required' },
        { status: 400 },
      )
    }

    const [templatesResult, overridesResult, appointmentsResult] =
      await Promise.all([
        supabase
          .from('availability_templates')
          .select('*')
          .eq('is_active', true),
        supabase
          .from('availability_overrides')
          .select('*')
          .eq('override_date', appointmentDate),
        supabase
          .from('ops_appointments')
          .select('appointment_date, start_time, end_time, status')
          .eq('appointment_date', appointmentDate),
      ])

    if (templatesResult.error) throw templatesResult.error
    if (overridesResult.error) throw overridesResult.error
    if (appointmentsResult.error) throw appointmentsResult.error

    const slots = getAvailableSlots({
      date: appointmentDate,
      requiredMinutes: totalMinutesWithBuffer,
      templates: templatesResult.data || [],
      overrides: overridesResult.data || [],
      appointments: appointmentsResult.data || [],
      maxResults: 500,
    })

    const normalizedStart = `${startTime}:00`.slice(0, 8)
    const canBookRequestedTime = slots.some(
      (slot) => slot.start_time === normalizedStart,
    )
    if (!canBookRequestedTime) {
      return NextResponse.json(
        {
          error:
            'That time is not available anymore. Pick an open slot and try again.',
        },
        { status: 409 },
      )
    }

    let customerId: string
    const { data: existingCustomer } = await supabase
      .from('ops_customers')
      .select('id')
      .eq('phone', phone)
      .maybeSingle()

    if (existingCustomer) {
      customerId = existingCustomer.id
      const { error: updateCustomerError } = await supabase
        .from('ops_customers')
        .update({
          full_name: fullName,
          first_name: firstName,
          last_name: lastName,
          business_name: businessName,
          email,
          notes: body.customer?.notes ? String(body.customer.notes) : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', customerId)

      if (updateCustomerError) throw updateCustomerError
    } else {
      const { data: customer, error: customerError } = await supabase
        .from('ops_customers')
        .insert({
          full_name: fullName,
          first_name: firstName,
          last_name: lastName,
          business_name: businessName,
          email,
          phone,
          notes: body.customer?.notes ? String(body.customer.notes) : null,
        })
        .select()
        .single()

      if (customerError) throw customerError
      customerId = customer.id
    }

    let address: {
      id: string
      street_1: string
      street_2: string | null
      city: string
      state: string
      zip_code: string
    } | null = null

    if (addressId) {
      const { data: existingAddress, error: existingAddressError } =
        await supabase
          .from('ops_service_addresses')
          .select('*')
          .eq('id', addressId)
          .eq('customer_id', customerId)
          .single()

      if (existingAddressError) throw existingAddressError
      address = existingAddress
    } else {
      const { data: insertedAddress, error: addressError } = await supabase
        .from('ops_service_addresses')
        .insert({
          customer_id: customerId,
          label: body.address?.label
            ? String(body.address.label)
            : 'Service Address',
          street_1: street1,
          street_2: body.address?.street_2
            ? String(body.address.street_2)
            : null,
          city,
          state,
          zip_code: zipCode,
          gate_code: body.address?.gate_code
            ? String(body.address.gate_code)
            : null,
          notes: body.address?.notes ? String(body.address.notes) : null,
        })
        .select()
        .single()

      if (addressError) throw addressError
      address = insertedAddress
    }

    if (!address) {
      throw new Error('Failed to resolve service address')
    }

    const syncStatus = getQuickBooksSyncStatus()
    const { data: appointment, error: appointmentError } = await supabase
      .from('ops_appointments')
      .insert({
        customer_id: customerId,
        service_address_id: address.id,
        lead_id: body.appointment?.lead_id || null,
        conversation_id: body.appointment?.conversation_id || null,
        assigned_staff_user_id:
          body.appointment?.assigned_staff_user_id || null,
        booking_channel: body.appointment?.booking_channel || 'admin',
        source: body.appointment?.source || 'internal',
        lead_source: body.lead_source ? String(body.lead_source) : null,
        status: 'booked',
        payment_status: 'unpaid',
        quickbooks_sync_status: syncStatus,
        appointment_date: appointmentDate,
        start_time: `${startTime}:00`.slice(0, 8),
        end_time: addMinutesToTime(startTime, totalMinutesWithBuffer),
        quoted_total: Number(quotedTotal.toFixed(2)),
        internal_notes: body.appointment?.internal_notes
          ? String(body.appointment.internal_notes)
          : null,
      })
      .select()
      .single()

    if (appointmentError) throw appointmentError

    const appointmentLinesPayload = normalizedLineItems.map(
      (item: NormalizedLineItem) => ({
        appointment_id: appointment.id,
        ...item,
      }),
    )

    const { data: appointmentLines, error: lineError } = await supabase
      .from('ops_appointment_line_items')
      .insert(appointmentLinesPayload)
      .select()

    if (lineError) throw lineError

    const { data: invoice, error: invoiceError } = await supabase
      .from('ops_invoices')
      .insert({
        appointment_id: appointment.id,
        status: 'draft',
        payment_status: 'unpaid',
        subtotal: Number(quotedSubtotal.toFixed(2)),
        discount_amount: Number(discountAmount.toFixed(2)),
        total: Number(quotedTotal.toFixed(2)),
        sync_status: syncStatus,
      })
      .select()
      .single()

    if (invoiceError) throw invoiceError

    const invoiceLinesPayload = (appointmentLines || []).map((item) => ({
      invoice_id: invoice.id,
      appointment_line_item_id: item.id,
      description: item.name_snapshot,
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_total: item.line_total,
    }))

    if (invoiceLinesPayload.length > 0) {
      const { error: invoiceLinesError } = await supabase
        .from('ops_invoice_line_items')
        .insert(invoiceLinesPayload)

      if (invoiceLinesError) throw invoiceLinesError
    }

    await Promise.all([
      supabase.from('ops_appointment_status_events').insert({
        appointment_id: appointment.id,
        from_status: null,
        to_status: 'booked',
        changed_by: access.id,
        notes: 'Appointment created from internal operations dashboard',
      }),
      supabase.from('ops_invoice_status_events').insert({
        invoice_id: invoice.id,
        from_status: null,
        to_status: 'draft',
        changed_by: access.id,
        notes: 'Invoice draft created at booking time',
      }),
      supabase.from('ops_quickbooks_sync_jobs').insert([
        {
          entity_type: 'customer',
          entity_id: customerId,
          status: syncStatus,
          payload: buildQuickBooksCustomerPayload({
            customerId,
            fullName,
            email,
            phone,
            address: {
              street_1: address.street_1,
              street_2: address.street_2,
              city: address.city,
              state: address.state,
              zip_code: address.zip_code,
            },
          }),
        },
        {
          entity_type: 'invoice',
          entity_id: invoice.id,
          status: syncStatus,
          payload: buildQuickBooksInvoicePayload({
            invoiceId: invoice.id,
            customerId,
            serviceDate: appointmentDate,
            subtotal: Number(invoice.subtotal),
            total: Number(invoice.total),
            lineItems: invoiceLinesPayload,
          }),
        },
      ]),
    ])

    const [commsResult, qbResult] = await Promise.allSettled([
      sendOpsLifecycleCommunications({
        event: 'job_scheduled',
        appointmentId: appointment.id,
      }),
      syncAppointmentToQuickBooks(appointment.id),
    ])
    if (commsResult.status === 'rejected') {
      console.error('[ops/appointments][POST] Comms error:', commsResult.reason)
    }
    if (qbResult.status === 'rejected') {
      console.error('[ops/appointments][POST] QB sync error:', qbResult.reason)
    }

    return NextResponse.json(
      {
        appointment,
        invoice,
      },
      { status: 201 },
    )
  } catch (error) {
    console.error('[ops/appointments][POST] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create appointment' },
      { status: 500 },
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'tech',
    ])
    const supabase = createAdminClient()
    const body = await request.json()

    const appointmentId = String(body.appointment_id || '').trim()
    if (!appointmentId) {
      return NextResponse.json(
        { error: 'appointment_id is required' },
        { status: 400 },
      )
    }

    const { data: appointment, error: appointmentError } = await supabase
      .from('ops_appointments')
      .select(
        `
          *,
          ops_customers (
            full_name
          ),
          ops_service_addresses (
            city
          ),
          ops_appointment_line_items (
            name_snapshot,
            quantity,
            unit_price,
            line_total
          ),
          ops_invoices (
            id,
            status,
            payment_status,
            sync_status
          )
        `,
      )
      .eq('id', appointmentId)
      .single()

    if (appointmentError) throw appointmentError

    const nextStatus = body.status ? String(body.status) : appointment.status
    const paymentStatus = body.payment_status
      ? String(body.payment_status)
      : appointment.payment_status
    const nowIso = new Date().toISOString()
    const firstOnMyWayAt =
      (appointment as { on_my_way_at?: string | null }).on_my_way_at ?? null
    const completedAt =
      nextStatus === 'completed' && !appointment.completed_at
        ? nowIso
        : appointment.completed_at
    const onMyWayAt =
      nextStatus === 'on_my_way' && !firstOnMyWayAt ? nowIso : firstOnMyWayAt

    const { error: updateError } = await supabase
      .from('ops_appointments')
      .update({
        status: nextStatus,
        payment_status: paymentStatus,
        internal_notes: body.internal_notes
          ? String(body.internal_notes)
          : appointment.internal_notes,
        completed_at: completedAt,
        on_my_way_at: onMyWayAt,
        updated_at: nowIso,
      })
      .eq('id', appointmentId)

    if (updateError) throw updateError

    if (nextStatus !== appointment.status) {
      const { error: eventError } = await supabase
        .from('ops_appointment_status_events')
        .insert({
          appointment_id: appointmentId,
          from_status: appointment.status,
          to_status: nextStatus,
          changed_by: access.id,
          notes: body.notes ? String(body.notes) : null,
        })

      if (eventError) throw eventError
    }

    const invoice = Array.isArray(appointment.ops_invoices)
      ? appointment.ops_invoices[0]
      : appointment.ops_invoices

    if (invoice) {
      const nextInvoiceStatus =
        nextStatus === 'completed' && invoice.status === 'draft'
          ? 'ready'
          : invoice.status

      const invoiceUpdate = {
        status: nextInvoiceStatus,
        payment_status: paymentStatus,
        sync_status: getQuickBooksSyncStatus(),
        updated_at: new Date().toISOString(),
      }

      const { error: invoiceUpdateError } = await supabase
        .from('ops_invoices')
        .update(invoiceUpdate)
        .eq('id', invoice.id)

      if (invoiceUpdateError) throw invoiceUpdateError

      if (
        nextInvoiceStatus !== invoice.status ||
        paymentStatus !== invoice.payment_status
      ) {
        const { error: invoiceEventError } = await supabase
          .from('ops_invoice_status_events')
          .insert({
            invoice_id: invoice.id,
            from_status: invoice.status,
            to_status: nextInvoiceStatus,
            changed_by: access.id,
            notes:
              nextStatus === 'completed'
                ? 'Job completed; invoice draft marked ready'
                : body.notes
                  ? String(body.notes)
                  : null,
          })

        if (invoiceEventError) throw invoiceEventError
      }

      void syncAppointmentToQuickBooks(appointmentId).catch((qbErr) =>
        console.error('[ops/appointments][PATCH] QB sync:', qbErr),
      )
    }

    if (nextStatus === 'completed') {
      const customer = Array.isArray(appointment.ops_customers)
        ? appointment.ops_customers[0]
        : appointment.ops_customers
      const address = Array.isArray(appointment.ops_service_addresses)
        ? appointment.ops_service_addresses[0]
        : appointment.ops_service_addresses
      const lineItems = Array.isArray(appointment.ops_appointment_line_items)
        ? appointment.ops_appointment_line_items
        : []

      const { error: marketingError } = await supabase
        .from('ops_marketing_post_queue')
        .upsert({
          appointment_id: appointmentId,
          status: 'held',
          payload: {
            customer_name: customer?.full_name || null,
            city: address?.city || null,
            services: lineItems.map(
              (item: { name_snapshot: string }) => item.name_snapshot,
            ),
            total: appointment.quoted_total,
          },
        })

      if (marketingError) throw marketingError
    }

    if (nextStatus !== appointment.status) {
      if (nextStatus === 'on_my_way') {
        await sendOpsLifecycleCommunications({
          event: 'on_my_way',
          appointmentId,
        })
      } else if (nextStatus === 'completed') {
        await sendOpsLifecycleCommunications({
          event: 'job_finished',
          appointmentId,
        })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[ops/appointments][PATCH] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update appointment' },
      { status: 500 },
    )
  }
}
