import { NextRequest, NextResponse } from 'next/server'
import { getCallRoutingConfig } from '@/lib/twilio/call-routing-config'

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
    const dialCallStatus = formData.get('DialCallStatus') as string
    const callerPhone = formData.get('Caller') || formData.get('From') // Use From/Caller to maintain Caller ID

    // Check query params for next destination logic if we want generic
    // const searchParams = request.nextUrl.searchParams
    // const next = searchParams.get('next')

    console.log(`[Dial Failover] Status: ${dialCallStatus}`)

    // If the call was completed (answered), we don't need to do anything else.
    // Twilio will naturally end the call when the parties hang up.
    if (dialCallStatus === 'completed' || dialCallStatus === 'answered') {
      return new NextResponse('<Response><Hangup/></Response>', {
        status: 200,
        headers: {
          'Content-Type': 'text/xml',
        },
      })
    }

    // If no answer, busy, or failed, proceed to dial Chuck
    console.log(
      `[Dial Failover] Primary leg failed/unanswered. Dialing Chuck...`,
    )
    const routingConfig = await getCallRoutingConfig()

    const baseUrl = getBaseUrl()
    const afterHoursUrl = `${baseUrl}/api/twilio/call-after-hours`

    // Dial Chuck + browser simultaneously
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="${routingConfig.ivrTechnicalTimeoutSeconds}" action="${afterHoursUrl}" callerId="${callerPhone}" answerOnBridge="true">
    <Number>${routingConfig.primaryForwardNumber}</Number>
    <Client>admin_charles</Client>
  </Dial>
</Response>`

    return new NextResponse(twimlResponse, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    })
  } catch (error) {
    console.error('[Dial Failover] Error:', error)

    const baseUrl = getBaseUrl()
    const afterHoursUrl = `${baseUrl}/api/twilio/call-after-hours`

    // Fallback to voicemail on error
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${afterHoursUrl}</Redirect></Response>`,
      {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      },
    )
  }
}
