/**
 * Telegram Bot Notification Helper
 * Sends push notifications to Charles's Telegram for admin alerts, job reminders, etc.
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID

interface TelegramMessage {
  text: string
  parse_mode?: 'Markdown' | 'HTML'
  disable_web_page_preview?: boolean
}

/**
 * Send a notification to Charles's Telegram
 */
export async function sendTelegramNotification(
  message: string,
  options?: {
    parseMode?: 'Markdown' | 'HTML'
    disablePreview?: boolean
  },
): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('Telegram credentials not configured, skipping notification')
    return false
  }

  try {
    const body: TelegramMessage = {
      text: message,
    }

    if (options?.parseMode) {
      body.parse_mode = options.parseMode
    }

    if (options?.disablePreview) {
      body.disable_web_page_preview = true
    }

    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          ...body,
        }),
      },
    )

    if (!response.ok) {
      const error = await response.text()
      console.error('Telegram API error:', error)
      return false
    }

    const result = await response.json()
    if (result.ok) {
      console.log('✅ Telegram notification sent successfully')
      return true
    }

    return false
  } catch (error) {
    console.error('Failed to send Telegram notification:', error)
    return false
  }
}

/**
 * Send a new booking notification
 */
export async function sendBookingNotification(params: {
  customerName: string
  phone: string
  appointmentDate: string
  startTime: string
  total: number
  leadSource?: string
  bookingMethod?: string
  technicianSchedule?: string | null
  services: string[]
}): Promise<void> {
  const {
    customerName,
    phone,
    appointmentDate,
    startTime,
    total,
    leadSource,
    bookingMethod,
    technicianSchedule,
    services,
  } = params

  const date = new Date(appointmentDate).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

  const servicesList = services.join('\n• ')
  const source = leadSource ? `\n📍 Lead source: ${leadSource}` : ''
  const booking = bookingMethod ? `\n🧭 Booking method: ${bookingMethod}` : ''
  const technician = technicianSchedule
    ? `\n🧰 Technician schedule: ${technicianSchedule}`
    : ''

  const message = `🎉 *NEW BOOKING*

👤 ${customerName}
📞 ${phone}
📅 ${date} at ${startTime}
💰 $${total.toFixed(2)}${source}${booking}${technician}

📋 Services:
• ${servicesList}`

  await sendTelegramNotification(message, { parseMode: 'Markdown' })
}

/**
 * Send a job reminder 30 minutes before start time
 */
export async function sendJobReminder(params: {
  customerName: string
  address: string
  startTime: string
  appointmentId: string
}): Promise<void> {
  const { customerName, address, startTime, appointmentId } = params

  const message = `⏰ *JOB IN 30 MINUTES*

👤 ${customerName}
📍 ${address}
🕐 ${startTime}

[View Details](https://sightings.sasquatchcarpet.com/admin/operations/appointments/${appointmentId})`

  await sendTelegramNotification(message, { parseMode: 'Markdown' })
}

/**
 * Send LSA lead alert
 */
export async function sendLSALeadNotification(params: {
  customerName?: string
  phone: string
  message: string
}): Promise<void> {
  const { customerName, phone, message: customerMessage } = params

  const name = customerName ? `${customerName}\n` : ''
  const text = `🔔 *GOOGLE LSA LEAD*

${name}📞 ${phone}

💬 "${customerMessage}"`

  await sendTelegramNotification(text, { parseMode: 'Markdown' })
}

/**
 * Send cancellation request alert
 */
export async function sendCancellationAlert(params: {
  customerName: string
  phone: string
  message: string
}): Promise<void> {
  const { customerName, phone, message } = params

  const text = `🚨 *CANCELLATION REQUEST*

👤 ${customerName}
📞 ${phone}

💬 "${message}"

⚠️ Harry did NOT cancel - needs your manual review.`

  await sendTelegramNotification(text, { parseMode: 'Markdown' })
}

/**
 * Send generic admin alert
 */
export async function sendAdminAlert(
  title: string,
  details: string,
): Promise<void> {
  const message = `📢 *${title}*

${details}`

  await sendTelegramNotification(message, { parseMode: 'Markdown' })
}

/**
 * Schedule a Telegram reminder for 30 minutes before a job.
 * Uses a simple setTimeout approach - for production, consider a job queue.
 */
export function scheduleJobReminder(params: {
  appointmentDate: string
  startTime: string
  customerName: string
  address: string
  appointmentId: string
}): void {
  const { appointmentDate, startTime, customerName, address, appointmentId } =
    params

  try {
    // Parse appointment time
    const [hours, minutes] = startTime.split(':').map(Number)
    const jobTime = new Date(appointmentDate)
    jobTime.setHours(hours, minutes, 0, 0)

    // Calculate 30 minutes before
    const reminderTime = new Date(jobTime.getTime() - 30 * 60 * 1000)

    // Only schedule if in the future
    const now = new Date()
    if (reminderTime <= now) {
      console.log(
        `[Telegram] Skipping reminder for ${appointmentId} - already passed`,
      )
      return
    }

    const delay = reminderTime.getTime() - now.getTime()

    // Node.js setTimeout has a max delay of ~24.8 days
    // For appointments further out, we'd need a job queue
    const MAX_TIMEOUT = 2147483647 // Max 32-bit signed int
    if (delay > MAX_TIMEOUT) {
      console.log(
        `[Telegram] Appointment ${appointmentId} too far in future for setTimeout`,
      )
      return
    }

    setTimeout(() => {
      void sendJobReminder({
        customerName,
        address,
        startTime,
        appointmentId,
      })
    }, delay)

    console.log(
      `[Telegram] Scheduled reminder for ${appointmentId} at ${reminderTime.toISOString()}`,
    )
  } catch (error) {
    console.error('[Telegram] Failed to schedule job reminder:', error)
  }
}
