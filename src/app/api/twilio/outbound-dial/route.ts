import { NextRequest, NextResponse } from 'next/server'

// Reusing settings from the main router for consistency, primarily the business number to display
// Ideally these settings should be in a shared config file, but for now we follow existing pattern
const SETTINGS = {
  forward_to_number_display: '+17192498791', // Shows as Business Number on Caller ID
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const digits = formData.get('Digits') as string

    console.log(`[Outbound Dial] Received digits to dial: ${digits}`)

    let twimlResponse

    if (digits) {
      // Basic format check - assuming US numbers mostly so 10 or 11 digits
      // But we'll trust the user to type it right for now.
      // We prepend nothing because user was asked to dial 1...
      // Actually, let's just dial whatever they typed.

      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Connecting your call.</Say>
  <Dial callerId="${SETTINGS.forward_to_number_display}">
    ${digits}
  </Dial>
</Response>`
    } else {
      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>I'm sorry, I didn't get that number. Goodbye.</Say>
</Response>`
    }

    return new NextResponse(twimlResponse, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    })
  } catch (error) {
    console.error('[Outbound Dial] Error:', error)

    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>An error occurred while processing your request. Goodbye.</Say>
</Response>`

    return new NextResponse(fallbackTwiml, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    })
  }
}
