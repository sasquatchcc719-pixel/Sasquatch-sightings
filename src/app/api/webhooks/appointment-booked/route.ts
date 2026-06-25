import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { sendTelegramNotification } from '@/lib/telegram'

type AppointmentLineItem = {
  name_snapshot: string | null
  quantity: number | string | null
  unit_price: number | string | null
  line_total: number | string | null
  notes: string | null
}

function firstRelated<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function formatTime(value: string | null): string | null {
  if (!value) return null

  return new Date(`2000-01-01T${value}`).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatMoney(value: number | string | null | undefined): string {
  const amount = Number(value ?? 0)
  return `$${amount.toFixed(2)}`
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatLeadSource(params: {
  leadSource: string | null | undefined
  leadSourceDetail: string | null | undefined
}): string {
  const source = String(params.leadSource || '').trim()
  const detail = String(params.leadSourceDetail || '').trim()
  if (!source) return 'Not captured'
  return detail ? `${source} - ${detail}` : source
}

function formatBookingMethod(params: {
  source: string | null | undefined
  bookingChannel: string | null | undefined
}): string {
  const source = String(params.source || '').trim()
  const channel = String(params.bookingChannel || '')
    .trim()
    .replace(/_/g, ' ')
  if (source && channel && source.toLowerCase() !== channel.toLowerCase()) {
    return `${source} (${channel})`
  }
  return source || channel || 'Unknown'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json()

    // Webhook payload from Supabase includes type and record
    const { type, record } = payload

    if (type !== 'INSERT') {
      return NextResponse.json({ success: true, skipped: true })
    }

    const appointmentId = record.id
    const supabase = createAdminClient()

    const fetchAppointment = () =>
      supabase
        .from('ops_appointments')
        .select(
          `
          id,
          appointment_date,
          start_time,
          end_time,
          internal_notes,
          status,
          kind,
          quoted_total,
          lead_source,
          lead_source_detail,
          booking_channel,
          source,
          assigned_staff_user_id,
          ops_customers!ops_appointments_customer_id_fkey (
            full_name,
            phone,
            email
          ),
          ops_service_addresses (
            street_1,
            city,
            state,
            zip_code
          ),
          ops_appointment_line_items (
            name_snapshot,
            quantity,
            unit_price,
            line_total,
            notes
          )
        `,
        )
        .eq('id', appointmentId)
        .single()

    let { data: appointment, error } = await fetchAppointment()

    for (const delay of [250, 500, 1000]) {
      const lineItems = Array.isArray(appointment?.ops_appointment_line_items)
        ? appointment.ops_appointment_line_items
        : []
      if (lineItems.length > 0 || error) break

      await sleep(delay)
      const retry = await fetchAppointment()
      appointment = retry.data
      error = retry.error
    }

    if (error || !appointment) {
      console.error('[appointment-booked] Failed to fetch appointment:', error)
      return NextResponse.json(
        { error: 'Appointment not found' },
        { status: 404 },
      )
    }

    // Skip estimates - they have their own notification in create-ai-style-estimate
    if (appointment.kind === 'estimate') {
      console.log(
        '[appointment-booked] Skipping estimate notification (handled separately)',
      )
      return NextResponse.json({ success: true, skipped: true })
    }

    // Build notification message
    const customer = firstRelated(appointment.ops_customers)
    const address = firstRelated(appointment.ops_service_addresses)
    const lineItems = Array.isArray(appointment.ops_appointment_line_items)
      ? (appointment.ops_appointment_line_items as AppointmentLineItem[])
      : []

    const customerName = customer?.full_name || 'Unknown Customer'
    const customerPhone = customer?.phone || 'No phone'
    const customerEmail = customer?.email || 'No email'
    const addressLine = address
      ? `${address.street_1}, ${address.city}, ${address.state} ${address.zip_code}`
      : 'No address'

    const startTime = formatTime(appointment.start_time) || 'No start time'
    const endTime = formatTime(appointment.end_time)
    const timeSlot = endTime ? `${startTime} - ${endTime}` : startTime
    const dateFormatted = formatDate(appointment.appointment_date)
    const leadSource = formatLeadSource({
      leadSource: appointment.lead_source,
      leadSourceDetail: appointment.lead_source_detail,
    })
    const bookingMethod = formatBookingMethod({
      source: appointment.source,
      bookingChannel: appointment.booking_channel,
    })
    let technicianSchedule = 'Unassigned'
    if (appointment.assigned_staff_user_id) {
      const { data: staffUser, error: staffError } = await supabase
        .from('staff_users')
        .select('display_name')
        .eq('id', appointment.assigned_staff_user_id)
        .maybeSingle()

      if (staffError) {
        console.error('[appointment-booked] Staff lookup failed:', staffError)
      }
      technicianSchedule = staffUser?.display_name || 'Unassigned'
    }
    const servicesList =
      lineItems.length > 0
        ? lineItems
            .map((item) => {
              const quantity = Number(item.quantity || 1)
              const quantityLabel = quantity !== 1 ? `${quantity}x ` : ''
              const name = item.name_snapshot || 'Service'
              const total = formatMoney(item.line_total)
              const notes = item.notes ? ` (${item.notes})` : ''
              return `• ${htmlEscape(quantityLabel)}${htmlEscape(name)} - ${htmlEscape(total)}${htmlEscape(notes)}`
            })
            .join('\n')
        : '• No line items found yet'

    let message = `<b>📅 New Job Booked!</b>\n\n`
    message += `📆 <b>${htmlEscape(dateFormatted)}</b>\n`
    message += `🕐 <b>${htmlEscape(timeSlot)}</b>\n`
    message += `💰 <b>Quoted:</b> ${htmlEscape(formatMoney(appointment.quoted_total))}\n\n`
    message += `📍 <b>Lead source:</b> ${htmlEscape(leadSource)}\n`
    message += `🧭 <b>Booking method:</b> ${htmlEscape(bookingMethod)}\n`
    message += `🧰 <b>Technician schedule:</b> ${htmlEscape(technicianSchedule)}\n\n`
    message += `📋 <b>Line items:</b>\n${servicesList}\n\n`
    message += `👤 ${htmlEscape(customerName)}\n`
    message += `📱 ${htmlEscape(customerPhone)}\n`
    message += `📧 ${htmlEscape(customerEmail)}\n`
    message += `📍 ${htmlEscape(addressLine)}\n`
    message += `🔖 Status: ${htmlEscape(appointment.status)}`

    if (appointment.internal_notes) {
      message += `\n\n📝 ${htmlEscape(appointment.internal_notes)}`
    }

    // Send Telegram notification
    await sendTelegramNotification(message, { parseMode: 'HTML' })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[appointment-booked] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
