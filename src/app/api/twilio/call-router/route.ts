import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    // Get the caller's phone number from Twilio
    const formData = await request.formData()
    const callerPhone = formData.get('From') as string

    console.log(`[Call Router] Incoming call from: ${callerPhone}`)

    // Get current time in Mountain Time (Monument, CO)
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    })

    const parts = formatter.formatToParts(now)
    const weekday = parts.find((p) => p.type === 'weekday')?.value
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0')

    console.log(`[Call Router] Current time: ${weekday} ${hour}:00 MT`)

    // Check if it's business hours (Mon-Fri, 9 AM - 5 PM MT)
    const isWeekday = weekday && !['Sat', 'Sun'].includes(weekday)
    const isBusinessHours = isWeekday && hour >= 9 && hour < 17

    // TwiML Bin URLs (get these from Twilio Console)
    const businessHoursBinUrl =
      'https://handler.twilio.com/twiml/EH87817d9c8f7bb5f8ee4b97328c09165f' // Business Hours - Ring Both
    const afterHoursBinUrl =
      'https://handler.twilio.com/twiml/EH4adc3314b00c71ef083679491bd5e8da' // After Hours - Harry SMS

    let twimlResponse

    if (isBusinessHours) {
      console.log(
        `[Call Router] Business hours - redirecting to ring both phones`,
      )
      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect>${businessHoursBinUrl}</Redirect>
</Response>`
    } else {
      console.log(`[Call Router] After hours - redirecting to Harry SMS`)
      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect>${afterHoursBinUrl}</Redirect>
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
