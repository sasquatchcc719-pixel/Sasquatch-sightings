import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    // Get the caller's phone number from Twilio
    const formData = await request.formData()
    const callerPhone = formData.get('From') as string

    console.log(`[Call Router] Incoming call from: ${callerPhone}`)

    // Get current time in Mountain Time (Monument, CO)
    const now = new Date()

    // Use separate formatters for reliable parsing
    const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      weekday: 'long',
    })
    const hourFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      hour: 'numeric',
      hour12: false,
    })

    const weekdayStr = weekdayFormatter.format(now)
    const hourStr = hourFormatter.format(now).replace(/\D/g, '') // Strip non-digits
    const hour = parseInt(hourStr) || 0

    // Weekdays only (not Saturday/Sunday)
    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
    const isWeekday = weekdays.includes(weekdayStr)

    // Business hours: 9 AM - 5 PM (hour >= 9 and hour < 17)
    const isBusinessHours = isWeekday && hour >= 9 && hour < 17

    console.log(
      `[Call Router] MT Time: ${weekdayStr} ${hour}:00, isWeekday: ${isWeekday}, isBusinessHours: ${isBusinessHours}`,
    )
    console.log(
      `[Call Router] Raw values - weekdayStr: "${weekdayStr}", hourStr: "${hourStr}"`,
    )
    console.log(`[Call Router] Current UTC: ${now.toISOString()}`)

    let twimlResponse

    if (isBusinessHours) {
      console.log(`[Call Router] Business hours - ring both phones`)
      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="20" action="https://sasquatch-sightings-git-main-charles-sewells-projects.vercel.app/api/twilio/call-after-hours">
    <Sip>sip:chuck@sasquatch-cc.sip.us1.twilio.com</Sip>
    <Sip>sip:wife@sasquatch-cc.sip.us1.twilio.com</Sip>
  </Dial>
</Response>`
    } else {
      console.log(`[Call Router] After hours - play message and send SMS`)
      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">https://sasquatch-sightings-git-main-charles-sewells-projects.vercel.app/api/twilio/call-after-hours</Redirect>
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

    // Fallback: redirect to after hours if something goes wrong
    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>We're experiencing technical difficulties. Please try again later.</Say>
  <Hangup/>
</Response>`

    return new NextResponse(fallbackTwiml, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    })
  }
}
