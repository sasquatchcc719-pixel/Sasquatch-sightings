/**
 * Twilio SMS Notification Helper
 * Sends SMS notifications to admin and partners
 */

import twilio from 'twilio'
import { createAdminClient } from '@/supabase/server'
import { isBlacklisted, notifyBlockedAttempt } from '@/lib/blacklist'

const accountSid = process.env.TWILIO_ACCOUNT_SID
const authToken = process.env.TWILIO_AUTH_TOKEN
const twilioPhone = process.env.TWILIO_PHONE_NUMBER
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
const adminPhone = process.env.ADMIN_PHONE_NUMBER

let client: ReturnType<typeof twilio> | null = null

// Initialize Twilio client only if credentials are available
if (accountSid && authToken) {
  client = twilio(accountSid, authToken)
}

export function normalizeSmsBody(message: string): string {
  return message
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Log SMS to database for tracking and history
 */
async function logSMS(params: {
  leadId?: string
  partnerId?: string
  recipientPhone: string
  messageType: string
  messageContent: string
  twilioSid?: string
  status?: string
}): Promise<void> {
  try {
    const supabase = createAdminClient()
    await supabase.from('sms_logs').insert({
      lead_id: params.leadId || null,
      partner_id: params.partnerId || null,
      recipient_phone: params.recipientPhone,
      message_type: params.messageType,
      message_content: params.messageContent,
      twilio_sid: params.twilioSid || null,
      status: params.status || 'sent',
    })
  } catch (error) {
    console.error('Failed to log SMS:', error)
    // Don't throw - logging failure shouldn't break SMS sending
  }
}

/**
 * Send SMS to admin (Charles) for new leads/events
 */
export async function sendAdminSMS(
  message: string,
  messageType: string = 'admin_alert',
): Promise<void> {
  if (!client || !twilioPhone || !adminPhone) {
    console.warn('Twilio credentials not configured, skipping SMS')
    return
  }

  const normalizedMessage = normalizeSmsBody(message)

  try {
    const result = await client.messages.create({
      body: normalizedMessage,
      from: twilioPhone,
      to: adminPhone,
    })
    console.log('Admin SMS sent successfully:', result.sid)

    // Log the SMS
    await logSMS({
      recipientPhone: adminPhone,
      messageType,
      messageContent: normalizedMessage,
      twilioSid: result.sid,
    })
  } catch (error) {
    console.error('Failed to send admin SMS:', error)

    // Log the failure
    await logSMS({
      recipientPhone: adminPhone,
      messageType,
      messageContent: normalizedMessage,
      status: 'failed',
    })
  }
}

/**
 * Send SMS to partner when they receive a referral
 */
export async function sendPartnerSMS(
  partnerPhone: string,
  message: string,
  partnerId?: string,
  messageType: string = 'partner_notification',
): Promise<void> {
  if (!client || !twilioPhone) {
    console.warn('Twilio credentials not configured, skipping SMS')
    return
  }

  const normalizedMessage = normalizeSmsBody(message)

  try {
    const result = await client.messages.create({
      body: normalizedMessage,
      from: twilioPhone,
      to: partnerPhone,
    })
    console.log(`Partner SMS sent successfully to ${partnerPhone}:`, result.sid)

    // Log the SMS
    await logSMS({
      partnerId,
      recipientPhone: partnerPhone,
      messageType,
      messageContent: normalizedMessage,
      twilioSid: result.sid,
    })
  } catch (error) {
    console.error(`Failed to send partner SMS to ${partnerPhone}:`, error)

    // Log the failure
    await logSMS({
      partnerId,
      recipientPhone: partnerPhone,
      messageType,
      messageContent: normalizedMessage,
      status: 'failed',
    })
  }
}

/** Normalize a user-entered US phone number to E.164, or null if invalid. */
export function normalizeUsPhoneInput(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

/** Normalize US phone to E.164 for Twilio */
function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}

/**
 * Send SMS to customer (contest entries, referrals, nurture sequences).
 * Optional fromNumber: use when replying to inbound so the reply comes from the number they texted (keeps thread on 866 vs 719).
 */
export async function sendCustomerSMS(
  customerPhone: string,
  message: string,
  leadId?: string,
  messageType: string = 'customer_notification',
  fromNumber?: string,
): Promise<void> {
  const normalizedMessage = normalizeSmsBody(message)

  try {
    await sendCustomerSMSWithResult(
      customerPhone,
      normalizedMessage,
      leadId,
      messageType,
      fromNumber,
    )
  } catch (error) {
    console.error(
      `Failed to send customer SMS to ${toE164(customerPhone)}:`,
      error,
    )

    await logSMS({
      leadId,
      recipientPhone: toE164(customerPhone),
      messageType,
      messageContent: normalizedMessage,
      status: 'failed',
    })
  }
}

/**
 * Send SMS to customer and require a Twilio SID. Use this for approval flows
 * where the caller must know whether a message actually went out.
 */
export async function sendCustomerSMSWithResult(
  customerPhone: string,
  message: string,
  leadId?: string,
  messageType: string = 'customer_notification',
  fromNumber?: string,
): Promise<{ sid: string; to: string; from: string }> {
  if (!client || (!twilioPhone && !messagingServiceSid)) {
    throw new Error(
      `Twilio credentials not configured (SID=${!!accountSid}, token=${!!authToken}, from=${!!twilioPhone}, messagingService=${!!messagingServiceSid})`,
    )
  }

  const normalizedMessage = normalizeSmsBody(message)
  const toPhone = toE164(customerPhone)
  const from = fromNumber ? toE164(fromNumber) : twilioPhone
  const useMessagingService = !fromNumber && !!messagingServiceSid
  const sender = useMessagingService ? messagingServiceSid : from
  if (!sender) {
    throw new Error('Twilio sender is not configured')
  }

  if (await isBlacklisted(toPhone)) {
    notifyBlockedAttempt(toPhone, 'outbound SMS')
    throw new Error('Suppressed: customer is blacklisted')
  }

  console.log(`📤 SENDING SMS: From=${sender} To=${toPhone}`)
  console.log(`   Message: ${normalizedMessage.substring(0, 50)}...`)

  const result = await client.messages.create(
    useMessagingService
      ? {
          body: normalizedMessage,
          messagingServiceSid,
          to: toPhone,
        }
      : {
          body: normalizedMessage,
          from: sender,
          to: toPhone,
        },
  )

  if (!result.sid) {
    throw new Error('Twilio did not return a message SID')
  }

  console.log(
    `✅ Customer SMS sent successfully to ${toPhone} SID=${result.sid}`,
  )

  await logSMS({
    leadId,
    recipientPhone: toPhone,
    messageType,
    messageContent: normalizedMessage,
    twilioSid: result.sid,
  })

  return {
    sid: result.sid,
    to: toPhone,
    from: sender,
  }
}
