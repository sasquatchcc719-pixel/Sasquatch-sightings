/**
 * Cron job to send Telegram notifications to Charles 30 minutes before appointments
 * Runs every 5 minutes and checks for upcoming jobs
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { sendToCharles } from '@/lib/harry-command-bot'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await sendUpcomingJobReminders()
    return NextResponse.json({
      success: true,
      result,
    })
  } catch (error) {
    console.error('[cron/job-reminders] Error:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to send reminders',
      },
      { status: 500 },
    )
  }
}

async function sendUpcomingJobReminders() {
  const supabase = createAdminClient()
  const now = new Date()
  const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60 * 1000)
  const thirtyFiveMinutesFromNow = new Date(now.getTime() + 35 * 60 * 1000)

  // Get today's date in YYYY-MM-DD format
  const todayDate = now.toISOString().split('T')[0]

  // Find appointments starting in 30-35 minutes
  const { data: upcomingAppointments, error } = await supabase
    .from('ops_appointments')
    .select(
      `
      id,
      appointment_date,
      start_time,
      end_time,
      internal_notes,
      status,
      ops_customers!ops_appointments_customer_id_fkey (
        full_name,
        phone
      ),
      ops_service_addresses (
        street,
        city,
        state,
        zip
      )
    `,
    )
    .eq('appointment_date', todayDate)
    .in('status', ['booked', 'pending_approval'])
    .order('start_time', { ascending: true })

  if (error) {
    console.error('[job-reminders] Failed to fetch appointments:', error)
    return { sent: 0, error: error.message }
  }

  if (!upcomingAppointments || upcomingAppointments.length === 0) {
    return { sent: 0, message: 'No appointments today' }
  }

  let sent = 0

  for (const appt of upcomingAppointments) {
    // Parse the appointment start time
    const [hours, minutes] = appt.start_time.split(':').map(Number)
    const apptDateTime = new Date(now)
    apptDateTime.setHours(hours, minutes, 0, 0)

    // Check if appointment is in the 30-35 minute window
    if (
      apptDateTime > thirtyMinutesFromNow &&
      apptDateTime <= thirtyFiveMinutesFromNow
    ) {
      // Check if we've already sent a reminder for this appointment today
      const reminderKey = `reminder_${appt.id}_${todayDate}`
      const { data: existingReminder } = await supabase
        .from('settings')
        .select('value')
        .eq('key', reminderKey)
        .maybeSingle()

      if (existingReminder) {
        // Already sent reminder for this appointment
        continue
      }

      // Build notification message
      const customer = Array.isArray(appt.ops_customers)
        ? appt.ops_customers[0]
        : appt.ops_customers
      const address = Array.isArray(appt.ops_service_addresses)
        ? appt.ops_service_addresses[0]
        : appt.ops_service_addresses

      const customerName = customer?.full_name || 'Unknown Customer'
      const customerPhone = customer?.phone || 'No phone'
      const addressLine = address
        ? `${address.street}, ${address.city}, ${address.state} ${address.zip}`
        : 'No address'

      const timeFormatted = new Date(
        `2000-01-01 ${appt.start_time}`,
      ).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })

      let message = `⏰ *Job in 30 minutes*\n\n`
      message += `🕐 ${timeFormatted}\n`
      message += `👤 ${customerName}\n`
      message += `📱 ${customerPhone}\n`
      message += `📍 ${addressLine}`

      if (appt.internal_notes) {
        message += `\n\n📝 ${appt.internal_notes}`
      }

      // Send Telegram notification
      await sendToCharles(message, { parseMode: 'Markdown' })

      // Mark as sent
      await supabase.from('settings').upsert({
        key: reminderKey,
        value: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })

      sent++
    }
  }

  return { sent, total_checked: upcomingAppointments.length }
}
