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
 * Send a photo with a caption. Telegram fetches the URL itself, so the image
 * must be publicly reachable (Supabase `job-images` public URLs are).
 *
 * Captions are hard-capped at 1024 characters by the API — anything longer is
 * rejected outright, so it is truncated here rather than silently failing.
 */
export async function sendTelegramPhoto(
  photoUrl: string,
  caption?: string,
): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('Telegram credentials not configured, skipping photo')
    return false
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          photo: photoUrl,
          caption: caption ? caption.slice(0, 1024) : undefined,
        }),
      },
    )

    if (!response.ok) {
      console.error('Telegram sendPhoto error:', await response.text())
      return false
    }
    const result = await response.json()
    return result.ok === true
  } catch (error) {
    console.error('Failed to send Telegram photo:', error)
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
    // Always show the year — a recurring job generated a year out is
    // indistinguishable from one this week without it.
    year: 'numeric',
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

// ── Scout (website chat) alerts ────────────────────────────────────────────────

const SCOUT_LOGS_URL = 'https://sightings.sasquatchcarpet.com/admin/scout/logs'
const TELEGRAM_MAX_CHARS = 4_096

/** Deep link that opens this session's transcript directly. */
function scoutTranscriptUrl(sessionId: string): string {
  return `${SCOUT_LOGS_URL}?session=${encodeURIComponent(sessionId)}`
}

/**
 * Scout alerts quote raw customer text (names, addresses, their own messages),
 * which regularly contains `_`, `*` and `[`. Telegram rejects the whole request
 * when Markdown doesn't parse, so these deliberately send as PLAIN TEXT — a
 * dropped booking-failure alert is exactly the outage we're trying to close.
 */
async function sendScoutAlert(lines: Array<string | null>): Promise<boolean> {
  const text = lines.filter((l) => l !== null).join('\n')
  return sendTelegramNotification(text.slice(0, TELEGRAM_MAX_CHARS))
}

export type ScoutBookingAttemptContext = {
  sessionId: string
  customerName?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  requestedDate?: string | null
  requestedTime?: string | null
  errors?: string[]
  lastCustomerMessage?: string | null
}

function contactLines(ctx: ScoutBookingAttemptContext): Array<string | null> {
  return [
    ctx.customerName ? `👤 ${ctx.customerName}` : null,
    ctx.phone ? `📞 ${ctx.phone}` : null,
    ctx.email ? `✉️ ${ctx.email}` : null,
    ctx.address ? `📍 ${ctx.address}` : null,
    ctx.requestedDate
      ? `📅 Wanted: ${ctx.requestedDate}${ctx.requestedTime ? ` at ${ctx.requestedTime}` : ''}`
      : null,
  ]
}

/**
 * Scout told a customer they were booked when no booking tool ever succeeded.
 * This is the highest-severity Scout failure: the customer walks away believing
 * they have an appointment that does not exist.
 */
export async function sendScoutPhantomBookingAlert(
  ctx: ScoutBookingAttemptContext & { claimedText?: string | null },
): Promise<boolean> {
  return sendScoutAlert([
    '🚨 SCOUT CLAIMED A BOOKING THAT NEVER HAPPENED',
    '',
    'Scout told a website visitor they were booked, but no booking was',
    'created. The customer has been sent a correction and told you will',
    'follow up. CALL THEM.',
    '',
    ...contactLines(ctx),
    ...(ctx.errors?.length
      ? ['', 'Why booking failed:', ...ctx.errors.map((e) => `• ${e}`)]
      : ['', 'Scout never even attempted a booking tool call.']),
    ctx.lastCustomerMessage
      ? `\nTheir last message:\n"${ctx.lastCustomerMessage}"`
      : null,
    ctx.claimedText ? `\nWhat Scout wrongly said:\n"${ctx.claimedText}"` : null,
    '',
    `Transcript: ${scoutTranscriptUrl(ctx.sessionId)}`,
    `Session: ${ctx.sessionId}`,
  ])
}

/**
 * A booking tool returned an error. Scout was honest with the customer, but a
 * lead is stalled mid-booking and needs a human.
 */
export async function sendScoutBookingFailureAlert(
  ctx: ScoutBookingAttemptContext,
): Promise<boolean> {
  return sendScoutAlert([
    '⚠️ SCOUT COULD NOT COMPLETE A BOOKING',
    '',
    'A website visitor tried to book and the booking tool failed. Scout did',
    'NOT claim it worked, but this lead is stuck.',
    '',
    ...contactLines(ctx),
    ...(ctx.errors?.length
      ? ['', 'Errors:', ...ctx.errors.map((e) => `• ${e}`)]
      : []),
    ctx.lastCustomerMessage
      ? `\nTheir last message:\n"${ctx.lastCustomerMessage}"`
      : null,
    '',
    `Transcript: ${scoutTranscriptUrl(ctx.sessionId)}`,
    `Session: ${ctx.sessionId}`,
  ])
}

/**
 * Scout escalated on purpose via notify_charles. Mirrors the Resend email to
 * Telegram so it lands on the phone, not just the inbox.
 */
export async function sendScoutEscalationAlert(params: {
  reason: string
  customerName?: string | null
  phone?: string | null
  notes?: string | null
}): Promise<boolean> {
  return sendScoutAlert([
    '🔔 SCOUT NEEDS YOU',
    '',
    `Reason: ${params.reason}`,
    params.customerName ? `👤 ${params.customerName}` : null,
    params.phone ? `📞 ${params.phone}` : null,
    params.notes ? `\nNotes:\n${params.notes}` : null,
    '',
    `Transcript: ${SCOUT_LOGS_URL}`,
  ])
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
