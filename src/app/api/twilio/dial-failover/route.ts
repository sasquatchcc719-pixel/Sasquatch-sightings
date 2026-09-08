import { NextRequest, NextResponse } from 'next/server'
import { getCallRoutingConfig } from '@/lib/twilio/call-routing-config'
import { getForwardNumbers } from '@/lib/twilio/forward-numbers'
import {
  classifyCallOutcome,
  parseDialCallDuration,
} from '@/lib/twilio/call-outcome'
import { createAdminClient } from '@/supabase/server'
import { writeCallLog } from '@/lib/twilio/call-history'

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
    const callSid = String(formData.get('CallSid') || '').trim()
    const dialCallStatus = String(formData.get('DialCallStatus') || '')
      .trim()
      .toLowerCase()
    const dialCallDuration = parseDialCallDuration(
      formData.get('DialCallDuration') || formData.get('CallDuration'),
    )
    const callerPhone = String(
      formData.get('Caller') || formData.get('From') || '',
    ).trim() // Use From/Caller to maintain Caller ID
    const mode = request.nextUrl.searchParams.get('mode')
    const stage = request.nextUrl.searchParams.get('stage')

    const callOutcome = classifyCallOutcome(dialCallStatus)

    console.log(
      `[Dial Failover] Status: ${dialCallStatus || 'unknown'}, Duration: ${dialCallDuration ?? 'unknown'}s, Stage: ${stage || 'primary'}`,
    )

    // Any completed leg connected. Duration cannot distinguish a short human
    // conversation from carrier voicemail and must not trigger a second dial.
    if (callOutcome === 'answered') {
      await updateCallLog({
        callSid,
        callerPhone,
        outcome: 'answered',
        dialCallStatus,
        dialCallDuration,
      })
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
      await updateCallLog({
        callSid,
        callerPhone,
        outcome: 'no-answer',
        dialCallStatus,
        dialCallDuration,
      })
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
    const isWaterDamageMode = mode === 'water-damage' || mode === 'technical'

    if (!secondaryForwardNumber) {
      console.log(
        '[Dial Failover] No secondary number — redirecting to voicemail',
      )
      await updateCallLog({
        callSid,
        callerPhone,
        outcome: 'no-answer',
        dialCallStatus,
        dialCallDuration,
      })
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
        : isWaterDamageMode
          ? routingConfig.ivrTechnicalTimeoutSeconds
          : routingConfig.ivrScheduleTimeoutSeconds
    const browserClient = isWaterDamageMode
      ? '\n    <Client>admin_charles</Client>'
      : ''
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

async function updateCallLog(params: {
  callSid: string
  callerPhone: string
  outcome: 'answered' | 'no-answer'
  dialCallStatus: string
  dialCallDuration: number | null
}): Promise<void> {
  if (!params.callSid) return

  try {
    await writeCallLog(createAdminClient(), {
      call_sid: params.callSid,
      ...(params.callerPhone ? { caller_phone: params.callerPhone } : {}),
      outcome: params.outcome,
      duration_seconds: params.dialCallDuration,
      raw_dial_status: params.dialCallStatus || null,
    })
  } catch (error) {
    // A logging failure must never prevent Twilio from completing the call
    // routing response.
    console.error('[Dial Failover] Call log update error:', error)
  }
}
