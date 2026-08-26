import { NextRequest, NextResponse } from 'next/server'
import { getCallRoutingConfig } from '@/lib/twilio/call-routing-config'
import { getForwardNumbers } from '@/lib/twilio/forward-numbers'

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
    const dialCallStatus = formData.get('DialCallStatus') as string
    const callerPhone = formData.get('Caller') || formData.get('From') // Use From/Caller to maintain Caller ID
    const mode = request.nextUrl.searchParams.get('mode')
    const stage = request.nextUrl.searchParams.get('stage')

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

    const baseUrl = getBaseUrl()
    const afterHoursUrl = `${baseUrl}/api/twilio/call-after-hours`

    if (stage === 'secondary') {
      console.log('[Dial Failover] Secondary leg did not answer — voicemail')
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${afterHoursUrl}</Redirect></Response>`,
        {
          status: 200,
          headers: {
            'Content-Type': 'text/xml',
          },
        },
      )
    }

    const routingConfig = await getCallRoutingConfig()
    const [, secondaryForwardNumber] = getForwardNumbers(routingConfig)

    if (!secondaryForwardNumber) {
      console.log(
        '[Dial Failover] No secondary number — redirecting to voicemail',
      )
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${afterHoursUrl}</Redirect></Response>`,
        {
          status: 200,
          headers: {
            'Content-Type': 'text/xml',
          },
        },
      )
    }

    const timeout =
      mode === 'open-line'
        ? routingConfig.openLineTimeoutSeconds
        : mode === 'technical'
          ? routingConfig.ivrTechnicalTimeoutSeconds
          : routingConfig.ivrScheduleTimeoutSeconds
    const browserClient =
      mode === 'technical' ? '\n    <Client>admin_charles</Client>' : ''
    const secondaryActionUrl = `${baseUrl}/api/twilio/dial-failover?stage=secondary`

    console.log(
      '[Dial Failover] Primary leg did not answer — dialing secondary',
    )
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="${timeout}" action="${secondaryActionUrl}" callerId="${callerPhone}" answerOnBridge="true">
    <Number>${secondaryForwardNumber}</Number>${browserClient}
  </Dial>
</Response>`,
      {
        status: 200,
        headers: {
          'Content-Type': 'text/xml',
        },
      },
    )
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
