import { NextRequest, NextResponse } from 'next/server'
import { getCallRoutingConfig } from '@/lib/twilio/call-routing-config'
import { sendOneSignalNotification } from '@/lib/onesignal'

// Robust Hardcoded Business Hours Logic (Fallback Plan)
// This removes the dependency on the database for the critical path of answering a call.
// Changes to business hours must be made here in code.

const SETTINGS = {
  business_hours_start: 9, // 9 AM
  business_hours_end: 17, // 5 PM
  business_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  // Static fallback values. Dynamic values come from phone_settings.
  forward_to_number_display: '+17192498791', // Shows as Business Number on Caller ID
  timezone: 'America/Denver',
}

function getBaseUrl(): string {
  const url =
    process.env.VERCEL_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'sightings.sasquatchcarpet.com'
  return url.startsWith('http') ? url : `https://${url}`
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const callerPhone = formData.get('From') as string
    const routingConfig = await getCallRoutingConfig()

    console.log(`[Call Router] Incoming call from: ${callerPhone}`)

    // Fire push notification immediately (don't await — must not delay TwiML)
    const displayPhone = callerPhone.replace(
      /^\+1(\d{3})(\d{3})(\d{4})$/,
      '($1) $2-$3',
    )
    sendOneSignalNotification({
      heading: 'Incoming Call',
      content: `${displayPhone || callerPhone} is calling`,
      data: { type: 'incoming_call', phone: callerPhone, url: '/admin/phone' },
    }).catch((err) =>
      console.error('[Call Router] Push notification error:', err),
    )

    // Get current time in Mountain Time
    const now = new Date()

    const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: SETTINGS.timezone,
      weekday: 'long',
    })
    const hourFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: SETTINGS.timezone,
      hour: 'numeric',
      hour12: false,
    })

    const weekdayStr = weekdayFormatter.format(now)
    const hourStr = hourFormatter.format(now).replace(/\D/g, '')
    const hour = parseInt(hourStr, 10) || 0

    const isBusinessDay = SETTINGS.business_days.some(
      (d) => d.toLowerCase() === weekdayStr.toLowerCase(),
    )

    // Check business hours
    const isBusinessHours =
      isBusinessDay &&
      hour >= SETTINGS.business_hours_start &&
      hour < SETTINGS.business_hours_end

    console.log(
      `[Call Router] MT Time: ${weekdayStr} ${hour}:00, isBusinessDay: ${isBusinessDay}, isBusinessHours: ${isBusinessHours}`,
    )

    // Check if the caller is one of the owners (simulring numbers)
    // If so, provide the ability to dial out as the business
    const isOwnerCalling = [
      routingConfig.primaryForwardNumber,
      routingConfig.failoverForwardNumber,
    ].includes(callerPhone)

    let twimlResponse

    const baseUrl = getBaseUrl()
    const afterHoursUrl = `${baseUrl}/api/twilio/call-after-hours`
    const whisperUrl = `${baseUrl}/api/twilio/whisper`
    const outboundDialUrl = `${baseUrl}/api/twilio/outbound-dial`

    if (isOwnerCalling) {
      console.log(
        `[Call Router] Owner calling (${callerPhone}) - initiating outbound dial flow`,
      )
      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather action="${outboundDialUrl}" numDigits="11" timeout="10">
    <Say>Welcome back. Enter the number you wish to call, starting with 1.</Say>
  </Gather>
  <Say>We didn't receive any input. Goodbye.</Say>
</Response>`
    } else if (routingConfig.temporaryOpenLineMode) {
      console.log('[Call Router] Temporary open line mode active - direct ring')
      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="${routingConfig.openLineTimeoutSeconds}" action="${afterHoursUrl}" callerId="${callerPhone}" answerOnBridge="true">
    <Number>${routingConfig.primaryForwardNumber}</Number>
    <Client>admin_charles</Client>
  </Dial>
</Response>`
    } else if (isBusinessHours) {
      // IVR: two keys are the same routing (primary + softphone) — human/bot gate; no key -> voicemail
      const ivrMenuUrl = `${baseUrl}/api/twilio/ivr-menu`

      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather action="${ivrMenuUrl}" numDigits="1" timeout="10">
    <Say>Thank you for calling Sasquatch Carpet Cleaning. To connect your call, press 1 or press 2.</Say>
  </Gather>
  <Redirect method="POST">${afterHoursUrl}</Redirect>
</Response>`
    } else {
      console.log(`[Call Router] After hours - redirecting to voicemail flow`)
      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${afterHoursUrl}</Redirect>
</Response>`
    }

    return new NextResponse(twimlResponse, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    })
  } catch (error) {
    console.error('[Call Router] Error:', error)

    // Fallback to after hours handler on error
    const baseUrl = getBaseUrl()
    const afterHoursUrl = `${baseUrl}/api/twilio/call-after-hours`

    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${afterHoursUrl}</Redirect>
</Response>`

    return new NextResponse(fallbackTwiml, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    })
  }
}
