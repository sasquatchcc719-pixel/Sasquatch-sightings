import { NextRequest, NextResponse } from 'next/server'
import { getCallRoutingConfig } from '@/lib/twilio/call-routing-config'

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
    const routingConfig = await getCallRoutingConfig()

    console.log(`[IVR Menu] Selection: ${digits} from ${callerPhone}`)

    const baseUrl = getBaseUrl()
    const afterHoursUrl = `${baseUrl}/api/twilio/call-after-hours` // Voicemail
    const failoverUrl = `${baseUrl}/api/twilio/dial-failover`

    let twimlResponse

    if (digits === '1') {
      console.log(
        `[IVR Menu] Option 1 -> Dialing primary scheduling number first`,
      )
      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="${routingConfig.ivrScheduleTimeoutSeconds}" action="${failoverUrl}?mode=schedule" callerId="${callerPhone}" answerOnBridge="true">
    <Number>${routingConfig.primaryForwardNumber}</Number>
  </Dial>
</Response>`
    } else if (digits === '2') {
      console.log(
        `[IVR Menu] Option 2 -> Dialing primary technical number first`,
      )
      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="${routingConfig.ivrTechnicalTimeoutSeconds}" action="${failoverUrl}?mode=technical" callerId="${callerPhone}" answerOnBridge="true">
    <Number>${routingConfig.primaryForwardNumber}</Number>
  </Dial>
</Response>`
    } else {
      // Invalid input or Timeout -> Treat as spam/bot or confusion -> Voicemail/Hangup
      // The user wants to filter bots so no input = no service generally.
      // We will redirect to after-hours which typically goes to voicemail.
      console.log(
        `[IVR Menu] No input or invalid input. Redirecting to voicemail flow.`,
      )
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
