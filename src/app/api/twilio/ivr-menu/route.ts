import { NextRequest, NextResponse } from 'next/server'
import { getCallRoutingConfig } from '@/lib/twilio/call-routing-config'
import { buildForwardDial } from '@/lib/twilio/forward-twiml'

function getBaseUrl(): string {
  const url = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_URL ||
    'sightings.sasquatchcarpet.com'
  ).trim()
  return url.startsWith('http') ? url : `https://${url}`
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const digits = formData.get('Digits') as string
    const callerPhone = formData.get('From') as string
    const isAfterHours =
      request.nextUrl.searchParams.get('context') === 'after-hours'
    const routingConfig = await getCallRoutingConfig()

    console.log(`[IVR Menu] Selection: ${digits} from ${callerPhone}`)

    const baseUrl = getBaseUrl()
    const afterHoursUrl = `${baseUrl}/api/twilio/call-after-hours` // Voicemail

    let twimlResponse

    if (!isAfterHours || digits === '2') {
      // Legacy menu callbacks also ring through when a key was not recognized.
      twimlResponse = buildForwardDial({
        config: routingConfig,
        callerPhone,
        callSid: String(formData.get('CallSid') || ''),
        baseUrl,
        mode: digits === '2' ? 'water-damage' : 'schedule',
      })
    } else {
      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${afterHoursUrl}</Redirect></Response>`
    }

    return new NextResponse(twimlResponse, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    })
  } catch (error) {
    console.error('[IVR Menu] Error:', error)

    // Fallback
    const baseUrl = getBaseUrl()
    const afterHoursUrl = `${baseUrl}/api/twilio/call-after-hours`
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${afterHoursUrl}</Redirect></Response>`,
      { status: 200, headers: { 'Content-Type': 'text/xml' } },
    )
  }
}
