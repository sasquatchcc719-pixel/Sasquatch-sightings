/**
 * Cron job to send 30-minute appointment reminders.
 * Charles receives Telegram for every job; David receives a phone push only
 * when he is the assigned technician.
 * Runs every 5 minutes and checks for upcoming jobs
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { sendTelegramNotification } from '@/lib/telegram'
import { sendDavidJobReminderPush } from '@/lib/ops/job-reminder-push'

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

  // Use Mountain Time (Colorado Springs timezone)
  const now = new Date()
  const nowMountain = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/Denver' }),
  )

  console.log(
    '[job-reminders] Current time (Mountain):',
    nowMountain.toLocaleTimeString(),
  )

  const thirtyMinutesFromNow = new Date(nowMountain.getTime() + 30 * 60 * 1000)
  const thirtyFiveMinutesFromNow = new Date(
    nowMountain.getTime() + 35 * 60 * 1000,
  )

  // Get today's date in Mountain Time
  const todayDate = nowMountain.toLocaleDateString('en-CA') // YYYY-MM-DD format

  console.log('[job-reminders] Looking for appointments on:', todayDate)
  console.log(
    '[job-reminders] Time window:',
    thirtyMinutesFromNow.toLocaleTimeString(),
    'to',
    thirtyFiveMinutesFromNow.toLocaleTimeString(),
  )

  // Find appointments starting in 30-35 minutes
  const { data: upcomingAppointments, error } = await supabase
    .from('ops_appointments')
    .select(
      `
      id,
      appointment_date,
      start_time,
      end_time,
      assigned_staff_user_id,
      internal_notes,
      status,
      ops_customers!ops_appointments_customer_id_fkey (
        full_name,
        phone
      ),
      ops_service_addresses (
        street_1,
        city,
        state,
        zip_code
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
    console.log('[job-reminders] No appointments found for today')
    return { sent: 0, message: 'No appointments today' }
  }

  console.log(
    '[job-reminders] Found',
    upcomingAppointments.length,
    'appointments',
  )

  let sent = 0
  let davidPushSent = 0

  for (const appt of upcomingAppointments) {
    // Parse the appointment start time and create a proper Date object
    const [hours, minutes] = appt.start_time.split(':').map(Number)

    // Create appointment datetime in Mountain Time
    const apptDateTime = new Date(nowMountain)
    apptDateTime.setHours(hours, minutes, 0, 0)

    console.log(
      `[job-reminders] Checking appt ${appt.id} at ${appt.start_time}:`,
      apptDateTime.toLocaleTimeString(),
      '| Window:',
      thirtyMinutesFromNow.toLocaleTimeString(),
      '-',
      thirtyFiveMinutesFromNow.toLocaleTimeString(),
    )

    // Check if appointment is in the 30-35 minute window
    const inWindow =
      apptDateTime >= thirtyMinutesFromNow &&
      apptDateTime < thirtyFiveMinutesFromNow

    console.log(
      `[job-reminders] Appt ${appt.id} in window?`,
      inWindow,
      '| apptTime:',
      apptDateTime.getTime(),
      '| windowStart:',
      thirtyMinutesFromNow.getTime(),
      '| windowEnd:',
      thirtyFiveMinutesFromNow.getTime(),
    )

    if (inWindow) {
      const telegramReminderKey = `reminder_${appt.id}_${todayDate}`
      const davidPushReminderKey = `david_push_reminder_${appt.id}_${todayDate}`
      const { data: existingReminders, error: reminderLookupError } =
        await supabase
          .from('system_settings')
          .select('key')
          .in('key', [telegramReminderKey, davidPushReminderKey])
      if (reminderLookupError) {
        console.error(
          `[job-reminders] Failed to read receipts for appt ${appt.id}:`,
          reminderLookupError,
        )
        continue
      }
      const sentKeys = new Set(
        (existingReminders || []).map((reminder) => reminder.key),
      )

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
        ? `${address.street_1}, ${address.city}, ${address.state} ${address.zip_code}`
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

      if (!sentKeys.has(telegramReminderKey)) {
        const telegramSent = await sendTelegramNotification(message, {
          parseMode: 'Markdown',
        })
        if (telegramSent) {
          await supabase.from('system_settings').upsert({
            key: telegramReminderKey,
            value: JSON.stringify({ sent_at: new Date().toISOString() }),
            updated_at: new Date().toISOString(),
          })
          sent++
        }
      }

      if (!sentKeys.has(davidPushReminderKey)) {
        const pushSent = await sendDavidJobReminderPush({
          supabase,
          appointmentId: appt.id,
          appointmentDate: todayDate,
          assignedStaffUserId: appt.assigned_staff_user_id,
          customerName,
          address: addressLine,
          timeLabel: timeFormatted,
        })
        if (pushSent) {
          await supabase.from('system_settings').upsert({
            key: davidPushReminderKey,
            value: JSON.stringify({ sent_at: new Date().toISOString() }),
            updated_at: new Date().toISOString(),
          })
          davidPushSent++
        }
      }

      console.log(
        `[job-reminders] Processed reminders for appt ${appt.id}: telegram=${sentKeys.has(telegramReminderKey) ? 'already sent' : 'checked'}, david_push=${sentKeys.has(davidPushReminderKey) ? 'already sent' : 'checked'}`,
      )
    }
  }

  return {
    sent,
    telegram_sent: sent,
    david_push_sent: davidPushSent,
    total_checked: upcomingAppointments.length,
  }
}
