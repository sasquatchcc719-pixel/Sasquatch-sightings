/**
 * Twilio SMS Notification Helper
 * Sends SMS notifications to admin and partners
 */

import twilio from 'twilio'

const accountSid = process.env.TWILIO_ACCOUNT_SID
const authToken = process.env.TWILIO_AUTH_TOKEN
const twilioPhone = process.env.TWILIO_PHONE_NUMBER
const adminPhone = process.env.ADMIN_PHONE_NUMBER

let client: ReturnType<typeof twilio> | null = null

// Initialize Twilio client only if credentials are available
if (accountSid && authToken) {
  client = twilio(accountSid, authToken)
}

/**
 * Send SMS to admin (Chuck) for new leads/events
 */
export async function sendAdminSMS(message: string): Promise<void> {
  if (!client || !twilioPhone || !adminPhone) {
    console.warn('Twilio credentials not configured, skipping SMS')
    return
  }

  try {
    const result = await client.messages.create({
      body: message,
      from: twilioPhone,
      to: adminPhone,
    })
    console.log('Admin SMS sent successfully:', result.sid)
  } catch (error) {
    console.error('Failed to send admin SMS:', error)
  }
}

/**
 * Send SMS to partner when they receive a referral
 */
export async function sendPartnerSMS(
  partnerPhone: string,
  message: string
): Promise<void> {
  if (!client || !twilioPhone) {
    console.warn('Twilio credentials not configured, skipping SMS')
    return
  }

  try {
    const result = await client.messages.create({
      body: message,
      from: twilioPhone,
      to: partnerPhone,
    })
    console.log(`Partner SMS sent successfully to ${partnerPhone}:`, result.sid)
  } catch (error) {
    console.error(`Failed to send partner SMS to ${partnerPhone}:`, error)
  }
}
