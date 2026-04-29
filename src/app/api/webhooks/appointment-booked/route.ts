import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { sendTelegramNotification } from '@/lib/telegram'

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

    // Fetch full appointment details with customer and address
    const { data: appointment, error } = await supabase
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
        )
      `,
      )
      .eq('id', appointmentId)
      .single()

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
    const customer = Array.isArray(appointment.ops_customers)
      ? appointment.ops_customers[0]
      : appointment.ops_customers
    const address = Array.isArray(appointment.ops_service_addresses)
      ? appointment.ops_service_addresses[0]
      : appointment.ops_service_addresses

    const customerName = customer?.full_name || 'Unknown Customer'
    const customerPhone = customer?.phone || 'No phone'
    const customerEmail = customer?.email || 'No email'
    const addressLine = address
      ? `${address.street_1}, ${address.city}, ${address.state} ${address.zip_code}`
      : 'No address'

    const timeFormatted = new Date(
      `2000-01-01 ${appointment.start_time}`,
    ).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })

    const dateFormatted = new Date(
      appointment.appointment_date,
    ).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })

    let message = `📅 *New Job Booked!*\n\n`
    message += `📆 ${dateFormatted} at ${timeFormatted}\n`
    message += `👤 ${customerName}\n`
    message += `📱 ${customerPhone}\n`
    message += `📧 ${customerEmail}\n`
    message += `📍 ${addressLine}\n`
    message += `🔖 Status: ${appointment.status}`

    if (appointment.internal_notes) {
      message += `\n\n📝 ${appointment.internal_notes}`
    }

    // Send Telegram notification
    await sendTelegramNotification(message, { parseMode: 'Markdown' })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[appointment-booked] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
