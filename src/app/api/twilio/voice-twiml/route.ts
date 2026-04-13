import { NextRequest, NextResponse } from 'next/server'

const twilioPhone = process.env.TWILIO_PHONE_NUMBER || '+17192498791'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const to = formData.get('To') as string

    if (!to) {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>No phone number provided. Goodbye.</Say>
</Response>`
      return new NextResponse(twiml, {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    console.log(
      `[voice-twiml] Outbound call to ${to} with callerId ${twilioPhone}`,
    )

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${twilioPhone}">
    <Number>${to}</Number>
  </Dial>
</Response>`

    return new NextResponse(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  } catch (error) {
    console.error('[voice-twiml] Error:', error)

    const fallback = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>An error occurred. Goodbye.</Say>
</Response>`

    return new NextResponse(fallback, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  }
}
