import { NextRequest, NextResponse } from 'next/server'
import { getCallRoutingConfig } from '@/lib/twilio/call-routing-config'
import { getForwardNumbers } from '@/lib/twilio/forward-numbers'
import { buildForwardDial } from '@/lib/twilio/forward-twiml'
import { validateTwilioInboundRequest } from '@/lib/twilio/inbound-auth'
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

    const screened = request.nextUrl.searchParams.get('screened') === '1'
    if (
      screened &&
      !validateTwilioInboundRequest({
        request,
        form: Object.fromEntries(
          [...formData.entries()].map(([k, v]) => [k, String(v)]),
        ),
      })
    )
      return new NextResponse('Forbidden', { status: 403 })
    let accepted = !screened
    if (screened && dialCallStatus === 'completed') {
      const bridged = String(formData.get('DialBridged') || '')
      if (bridged === 'true' || bridged === 'false')
        accepted = bridged === 'true'
      else {
        try {
          const { data, error } = await createAdminClient()
            .from('call_logs')
            .select('forwarding_accepted_at')
            .eq('call_sid', callSid)
            .maybeSingle()
          if (error)
            console.error('[Dial Failover] Acceptance read failed:', error)
          accepted = Boolean(data?.forwarding_accepted_at)
        } catch (error) {
          console.error('[Dial Failover] Acceptance read failed:', error)
          accepted = false
        }
      }
    }
    const callOutcome = accepted
      ? classifyCallOutcome(dialCallStatus)
      : 'no-answer'
    if (dialCallStatus === 'canceled')
      return new NextResponse('<Response><Hangup/></Response>', {
        headers: { 'Content-Type': 'text/xml' },
      })

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
        accepted: screened,
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

    const twiml = screened
      ? buildForwardDial({
          config: routingConfig,
          callerPhone,
          callSid,
          baseUrl,
          mode: mode || 'schedule',
          secondary: true,
        })
      : `<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="${mode === 'open-line' ? routingConfig.openLineTimeoutSeconds : isWaterDamageMode ? routingConfig.ivrTechnicalTimeoutSeconds : routingConfig.ivrScheduleTimeoutSeconds}" action="${baseUrl}/api/twilio/dial-failover?stage=secondary" callerId="${callerPhone}" answerOnBridge="true"><Number>${secondaryForwardNumber}</Number>${isWaterDamageMode ? '<Client>admin_charles</Client>' : ''}</Dial></Response>`
    return new NextResponse(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
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

async function updateCallLog(params: {
  callSid: string
  callerPhone: string
  outcome: 'answered' | 'no-answer'
  accepted?: boolean
  dialCallStatus: string
  dialCallDuration: number | null
}): Promise<void> {
  if (!params.callSid) return

  try {
    await writeCallLog(createAdminClient(), {
      call_sid: params.callSid,
      ...(params.callerPhone ? { caller_phone: params.callerPhone } : {}),
      outcome: params.outcome,
      ...(params.accepted
        ? {
            forwarding_required: true,
            forwarding_accepted_at: new Date().toISOString(),
          }
        : {}),
      duration_seconds: params.dialCallDuration,
      raw_dial_status: params.dialCallStatus || null,
    })
  } catch (error) {
    // A logging failure must never prevent Twilio from completing the call
    // routing response.
    console.error('[Dial Failover] Call log update error:', error)
  }
}
