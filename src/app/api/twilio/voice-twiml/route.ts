import { NextRequest, NextResponse } from 'next/server'
import { validateTwilioInboundRequest } from '@/lib/twilio/inbound-auth'

const twilioPhone = process.env.TWILIO_PHONE_NUMBER || '+17192498791'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const signedParams = Object.fromEntries(
      [...formData.entries()].map(([key, value]) => [key, String(value)]),
    )
    if (!validateTwilioInboundRequest({ request, form: signedParams })) {
      return new NextResponse('Forbidden', { status: 403 })
    }
    const rawTo = formData.get('To') as string

    if (!rawTo) {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>No phone number provided. Goodbye.</Say>
</Response>`
      return new NextResponse(twiml, {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    // Normalize: strip whitespace, ensure E.164 format
    let to = rawTo.trim()
    const digits = to.replace(/\D/g, '')
    if (!to.startsWith('+') && digits.length === 10) {
      to = `+1${digits}`
    } else if (
      !to.startsWith('+') &&
      digits.length === 11 &&
      digits.startsWith('1')
    ) {
      to = `+${digits}`
    }

    if (!/^\+[1-9]\d{7,14}$/.test(to)) {
      return new NextResponse('Invalid phone number', { status: 400 })
    }

    console.log(
      `[voice-twiml] Outbound call to ${to} (raw: ${rawTo}) with callerId ${twilioPhone}`,
    )

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${twilioPhone}" answerOnBridge="true">
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
