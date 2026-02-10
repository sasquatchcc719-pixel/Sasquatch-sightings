/**
 * Twilio Function: Business Hours Router
 *
 * This code is intended to be hosted on Twilio Functions (Serverless).
 * It handles the "Is it business hours?" logic directly on Twilio's infrastructure,
 * removing the dependency on your own server/database for the critical path of
 * answering a call.
 *
 * SETUP:
 * 1. Go to Twilio Console > Functions and Assets > Services
 * 2. Create a Service (e.g. "sasquatch-router")
 * 3. Add a Function (e.g. "/call-router")
 * 4. Paste this code.
 * 5. Add Environment Variables (optional, defaults provided in code):
 *    - BUSINESS_HOURS_START (e.g. 9)
 *    - BUSINESS_HOURS_END (e.g. 17)
 *    - TIMEZONE (e.g. America/Denver)
 *    - SIP_DOMAIN (e.g. sasquatch-cc.sip.twilio.com)
 *    - AFTER_HOURS_URL (e.g. https://sightings.sasquatchcarpet.com/api/twilio/call-after-hours)
 * 6. Save and Deploy.
 * 7. Point your Phone Number's Voice URL to this Function URL.
 */

exports.handler = function (context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse()

  // --- Configuration ---
  // You can set these in the Twilio Console > Functions > Configure, or rely on defaults here.
  const TIMEZONE = context.TIMEZONE || 'America/Denver'
  const START_HOUR = parseInt(context.BUSINESS_HOURS_START || '9', 10)
  const END_HOUR = parseInt(context.BUSINESS_HOURS_END || '17', 10) // 5 PM
  const BUSINESS_DAYS = (
    context.BUSINESS_DAYS || 'Monday,Tuesday,Wednesday,Thursday,Friday'
  ).split(',')
  const AFTER_HOURS_URL =
    context.AFTER_HOURS_URL ||
    'https://sightings.sasquatchcarpet.com/api/twilio/call-after-hours'
  const SIP_DOMAIN = context.SIP_DOMAIN || 'sasquatch-cc.sip.twilio.com'
  // List of SIP endpoints to ring
  const SIP_ENDPOINTS = (context.SIP_ENDPOINTS || 'chuck').split(',')
  const DIAL_TIMEOUT = parseInt(context.DIAL_TIMEOUT || '20', 10)

  // --- Logic ---

  // Get current time in local timezone
  const now = new Date()

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: 'numeric',
    hour12: false,
    weekday: 'long',
  })

  // Format parts to easily check day and hour
  const parts = formatter.formatToParts(now)
  const getPart = (type) => parts.find((p) => p.type === type).value

  const weekday = getPart('weekday') // e.g. "Monday"
  const hour = parseInt(getPart('hour'), 10) // e.g. 14 for 2 PM

  // Check if today is a business day
  const isBusinessDay = BUSINESS_DAYS.some(
    (d) => d.trim().toLowerCase() === weekday.toLowerCase(),
  )

  // Check if current hour is within range [START, END)
  // e.g. if 9-17, then 9:00 is yes, 16:59 is yes, 17:00 is no.
  const isBusinessHours = isBusinessDay && hour >= START_HOUR && hour < END_HOUR

  console.log(`Time (${TIMEZONE}): ${weekday} ${hour}:00`)
  console.log(`Is Business Hours? ${isBusinessHours ? 'YES' : 'NO'}`)

  if (isBusinessHours) {
    const dial = twiml.dial({
      timeout: DIAL_TIMEOUT,
      action: AFTER_HOURS_URL, // If no one answers or busy, go to app's voicemail handler
      method: 'POST',
    })

    // Add SIP endpoints
    SIP_ENDPOINTS.forEach((endpoint) => {
      dial.sip(`sip:${endpoint.trim()}@${SIP_DOMAIN}`)
    })
  } else {
    // After hours: Redirect to the app's after-hours handler (Voicemail/SMS)
    twiml.redirect(
      {
        method: 'POST',
      },
      AFTER_HOURS_URL,
    )
  }

  return callback(null, twiml)
}
