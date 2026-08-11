import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  buildQuickBooksCustomerPayload,
  getQuickBooksSyncStatus,
} from '@/lib/quickbooks'
import {
  applyAppointmentBuffer,
  calculateAppointmentDurationFromTotal,
} from '@/lib/ops/availability'
import { findAppointmentConflict } from '@/lib/ops/availability-bundle'
import { sendOpsLifecycleCommunications } from '@/lib/ops/communications'
import { enrollCustomerInDrip } from '@/lib/ops/drip-campaign'
import { cancelReactivationForCustomer } from '@/lib/ops/reactivation-campaign'
import { suppressPostJobReviewRequest } from '@/lib/ops/review-requests'
import { syncAppointmentToQuickBooks } from '@/lib/quickbooks-api'
import { ensureCustomerQuickBooksSyncJob } from '@/lib/ops/quickbooks-sync-jobs'
import { scheduleJobReminder } from '@/lib/onesignal'
import { normalizeOpsPhone, opsPhoneLookupVariants } from '@/lib/ops/phone'
import { resolveServiceAddress } from '@/lib/ops/addresses'
import {
  leadSourceUpdatePayload,
  normalizeLeadSourceForWrite,
} from '@/lib/server/lead-sources'

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
    const phone = normalizeOpsPhone(String(body.customer?.phone || '').trim())
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

    const quotedSubtotal = normalizedLineItems.reduce(
      (sum: number, item: NormalizedLineItem) => sum + item.line_total,
      0,
    )
    const discountAmount = Math.max(0, Number(body.discount_amount || 0))
    const quotedTotal = Math.max(0, quotedSubtotal - discountAmount)

    // Calculate duration based on dollar amount (simple tier system)
    // $0-300 = 2hr, $301-600 = 3hr, $601+ = 4hr
    const appointmentDuration =
      calculateAppointmentDurationFromTotal(quotedSubtotal)
    const totalMinutesWithBuffer = applyAppointmentBuffer(appointmentDuration)

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

    // The block this job will actually occupy is sized by the dollar subtotal
    // above, which can grow after a time was picked (add line items to a $250
    // 2-hour job and it becomes a $700 4-hour job). Re-check the *final* window
    // against the assigned tech's calendar so a longer job can't be written on
    // top of their next appointment. Admins can still override deliberately by
    // sending allow_conflict — this only stops the silent case.
    const assignedStaffUserId = body.appointment?.assigned_staff_user_id
      ? String(body.appointment.assigned_staff_user_id)
      : undefined
    // Only guard when a tech is actually assigned — an unassigned job checked
    // against every tech's calendar would refuse times that are genuinely open
    // for somebody.
    if (assignedStaffUserId && body.allow_conflict !== true) {
      const conflict = await findAppointmentConflict(supabase, {
        date: appointmentDate,
        startTime: startTime,
        endTime: addMinutesToTime(startTime, totalMinutesWithBuffer),
        staffUserId: assignedStaffUserId,
      })
      if (conflict) {
        return NextResponse.json(
          {
            error: `This job needs ${totalMinutesWithBuffer / 60} hours, which runs into an existing ${conflict.start_time.slice(0, 5)}–${conflict.end_time.slice(0, 5)} appointment. Pick another time, or resubmit with allow_conflict to book it anyway.`,
            conflict,
          },
          { status: 409 },
        )
      }
    }

    let customerId: string
    const bodyCustomerId = body.customer_id
      ? String(body.customer_id).trim()
      : null

    const applyCustomerUpdate = async (id: string) => {
      const { error: updateCustomerError } = await supabase
        .from('ops_customers')
        .update({
          full_name: fullName,
          first_name: firstName,
          last_name: lastName,
          business_name: businessName,
          email,
          phone,
          notes: body.customer?.notes ? String(body.customer.notes) : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (updateCustomerError) throw updateCustomerError
    }

    if (bodyCustomerId) {
      const { data: byId, error: byIdError } = await supabase
        .from('ops_customers')
        .select('id')
        .eq('id', bodyCustomerId)
        .maybeSingle()
      if (byIdError) throw byIdError
      if (!byId) {
        return NextResponse.json(
          {
            error:
              'That customer record was not found. Search again or clear the selection.',
          },
          { status: 400 },
        )
      }
      customerId = byId.id
      await applyCustomerUpdate(customerId)
    } else {
      const variants = opsPhoneLookupVariants(
        String(body.customer?.phone || ''),
      )
      const { data: matches, error: matchError } = await supabase
        .from('ops_customers')
        .select('id')
        .in('phone', variants)
        .order('updated_at', { ascending: false })
        .limit(1)
      if (matchError) throw matchError
      const existingCustomer = matches?.[0]

      if (existingCustomer) {
        customerId = existingCustomer.id
        await applyCustomerUpdate(customerId)
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
      const inlineAddress = {
        label: body.address?.label
          ? String(body.address.label)
          : 'Service Address',
        street_1: street1,
        street_2: body.address?.street_2 ? String(body.address.street_2) : null,
        city,
        state,
        zip_code: zipCode,
        gate_code: body.address?.gate_code
          ? String(body.address.gate_code)
          : null,
        notes: body.address?.notes ? String(body.address.notes) : null,
      }
      address = await resolveServiceAddress(supabase, customerId, inlineAddress)
    }

    if (!address) {
      throw new Error('Failed to resolve service address')
    }

    const normalizedLeadSource = await normalizeLeadSourceForWrite({
      supabase,
      sourceKey: body.lead_source_key,
      legacyValue: body.lead_source,
      detail: body.lead_source_detail,
      requireActive: true,
      requirePublic: false,
      allowMissingDetail: true,
    })
    if (!normalizedLeadSource.ok) {
      return NextResponse.json(
        { error: normalizedLeadSource.error },
        { status: 400 },
      )
    }

    const syncStatus = getQuickBooksSyncStatus()
    const appointmentKind =
      body.appointment?.kind === 'estimate' ? 'estimate' : 'service'
    const isEstimate = appointmentKind === 'estimate'
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
        ...leadSourceUpdatePayload(normalizedLeadSource.source),
        status: 'booked',
        payment_status: 'unpaid',
        kind: appointmentKind,
        estimate_status: isEstimate ? 'draft' : null,
        // Estimates never sync to QuickBooks; 'held' is the allowed
        // "do not sync" value on the ops_appointments CHECK constraint.
        quickbooks_sync_status: isEstimate ? 'held' : syncStatus,
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
    if (!isEstimate) {
      await cancelReactivationForCustomer(customerId, 'booked_job')
    }

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

    // Estimates skip invoice generation entirely. They still get an appointment
    // status event so the calendar audit trail is intact.
    let invoice: {
      id: string
      subtotal: number
      total: number
    } | null = null

    if (!isEstimate) {
      const { data: insertedInvoice, error: invoiceError } = await supabase
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
      invoice = insertedInvoice

      const invoiceLinesPayload = (appointmentLines || []).map((item) => ({
        invoice_id: invoice!.id,
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
          invoice_id: invoice!.id,
          from_status: null,
          to_status: 'draft',
          changed_by: access.id,
          notes: 'Invoice draft created at booking time',
        }),
        ensureCustomerQuickBooksSyncJob(
          supabase,
          customerId,
          buildQuickBooksCustomerPayload({
            customerId,
            fullName,
            businessName: businessName || null,
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
        ),
      ])

      const [commsResult, qbResult] = await Promise.allSettled([
        sendOpsLifecycleCommunications({
          event: 'job_scheduled',
          appointmentId: appointment.id,
        }),
        syncAppointmentToQuickBooks(appointment.id),
        scheduleJobReminder({
          appointmentId: appointment.id,
          appointmentDate: appointmentDate,
          startTime: `${startTime}:00`.slice(0, 8),
          customerName: fullName,
          address: `${address.street_1}, ${address.city}`,
        }),
      ])
      if (commsResult.status === 'rejected') {
        console.error(
          '[ops/appointments][POST] Comms error:',
          commsResult.reason,
        )
      }
      if (qbResult.status === 'rejected') {
        console.error(
          '[ops/appointments][POST] QB sync error:',
          qbResult.reason,
        )
      }
    } else {
      // Estimate path: still log a status event so the timeline shows creation,
      // but no invoice, QB sync, lifecycle comms, or reminder.
      await supabase.from('ops_appointment_status_events').insert({
        appointment_id: appointment.id,
        from_status: null,
        to_status: 'booked',
        changed_by: access.id,
        notes: 'Estimate (measuring visit) created',
      })
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
          ops_customers!ops_appointments_customer_id_fkey (
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
    const skipCustomerCommunications =
      body.skip_customer_communications === true
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

    if (nextStatus !== appointment.status && !skipCustomerCommunications) {
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
        // Same as PATCH /appointments/[id]: start post-job drip for one-off jobs
        // (not tied to a recurring series). `enrollCustomerInDrip` no-ops if no email / opted out.
        const recurringTid = (
          appointment as { recurring_template_id?: string | null }
        ).recurring_template_id
        if (!recurringTid) {
          void enrollCustomerInDrip(appointmentId).catch((err) =>
            console.error('[drip] enrollment error:', err),
          )
        }
      }
    }

    if (
      nextStatus !== appointment.status &&
      nextStatus === 'completed' &&
      skipCustomerCommunications
    ) {
      await suppressPostJobReviewRequest(
        supabase,
        appointmentId,
        'manual quiet close - post-job communications skipped',
      )
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
