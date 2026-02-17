import { NextRequest, NextResponse } from 'next/server'

// Robust Hardcoded Business Hours Logic (Fallback Plan)
// This removes the dependency on the database for the critical path of answering a call.
// Changes to business hours must be made here in code.

const SETTINGS = {
  business_hours_start: 9, // 9 AM
  business_hours_end: 17, // 5 PM
  business_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  // Forwarding to Chuck and Wife with Whisper
  forward_to_numbers: ['+17197498807', '+17206447577'],
  forward_to_number_display: '+17192498791', // Shows as Business Number on Caller ID
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
    const isOwnerCalling = SETTINGS.forward_to_numbers.includes(callerPhone)

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
    } else if (isBusinessHours) {
      console.log(
        `[Call Router] Business hours - forwarding to: ${SETTINGS.forward_to_numbers.join(', ')}`,
      )

      // Build <Number> nouns for each phone
      // Removed url="..." to remove "Whisper" / Call Screening
      const numberElements = SETTINGS.forward_to_numbers
        .map((num) => `    <Number>${num}</Number>`)
        .join('\n')

      // callerId changed to callerPhone (incoming caller) per user request
      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="${SETTINGS.dial_timeout}" action="${afterHoursUrl}" callerId="${callerPhone}">
${numberElements}
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
