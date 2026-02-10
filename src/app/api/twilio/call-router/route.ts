import { NextRequest, NextResponse } from 'next/server'

// Robust Hardcoded Business Hours Logic (Fallback Plan)
// This removes the dependency on the database for the critical path of answering a call.
// Changes to business hours must be made here in code.

const SETTINGS = {
  business_hours_start: 9, // 9 AM
  business_hours_end: 17, // 5 PM
  business_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  // Forwarding to Chuck's Cell with Whisper
  forward_to_number: '+17197498807',
  dial_timeout: 20,
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

    console.log(`[Call Router] Incoming call from: ${callerPhone}`)

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

    // Check business days
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

    let twimlResponse

    const baseUrl = getBaseUrl()
    const afterHoursUrl = `${baseUrl}/api/twilio/call-after-hours`
    const whisperUrl = `${baseUrl}/api/twilio/whisper`

    if (isBusinessHours) {
      console.log(
        `[Call Router] Business hours - forwarding to cell: ${SETTINGS.forward_to_number}`,
      )

      // <Number url="..."> tells Twilio to play TwiML to the callee (you) when you answer
      // BEFORE connecting the caller. This allows for the "Whisper" / Call Screening.
      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="${SETTINGS.dial_timeout}" action="${afterHoursUrl}">
    <Number url="${whisperUrl}">${SETTINGS.forward_to_number}</Number>
  </Dial>
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
