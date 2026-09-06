import { NextRequest, NextResponse } from 'next/server'
import { getCallRoutingConfig } from '@/lib/twilio/call-routing-config'
import { sendOneSignalNotification } from '@/lib/onesignal'
import { isBlacklisted, notifyBlockedAttempt } from '@/lib/blacklist'
import { createAdminClient } from '@/supabase/server'

const SETTINGS = {
  // Static fallback values. Dynamic values come from phone_settings.
  forward_to_number_display: '+17192498791', // Shows as Business Number on Caller ID
  timezone: 'America/Denver',
}

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
    const callerPhone = formData.get('From') as string

    if (await isBlacklisted(callerPhone)) {
      const supabase = createAdminClient()
      supabase
        .from('call_logs')
        .upsert(
          {
            call_sid: formData.get('CallSid') as string,
            caller_phone: callerPhone,
            outcome: 'blacklisted',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'call_sid' },
        )
        .then()
      notifyBlockedAttempt(callerPhone, 'call')
      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>',
        { status: 200, headers: { 'Content-Type': 'text/xml' } },
      )
    }

    const routingConfig = await getCallRoutingConfig()

    console.log(`[Call Router] Incoming call from: ${callerPhone}`)

    // Log every non-blacklisted inbound call — outcome updated later at call-after-hours
    const supabaseLog = createAdminClient()
    supabaseLog
      .from('call_logs')
      .upsert(
        {
          call_sid: formData.get('CallSid') as string,
          caller_phone: callerPhone,
          outcome: 'inbound',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'call_sid' },
      )
      .then()

    // Fire push notification immediately (don't await — must not delay TwiML)
    const displayPhone = callerPhone.replace(
      /^\+1(\d{3})(\d{3})(\d{4})$/,
      '($1) $2-$3',
    )
    sendOneSignalNotification({
      heading: 'Incoming Call',
      content: `${displayPhone || callerPhone} is calling`,
      data: { type: 'incoming_call', phone: callerPhone, url: '/admin/phone' },
    }).catch((err) =>
      console.error('[Call Router] Push notification error:', err),
    )

    // Get current time in Mountain Time
    const now = new Date()

    const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: SETTINGS.timezone,
      weekday: 'long',
    })
    const hourFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: SETTINGS.timezone,
      hour: 'numeric',
      hour12: false,
    })

    const weekdayStr = weekdayFormatter.format(now)
    const hourStr = hourFormatter.format(now).replace(/\D/g, '')
    const hour = parseInt(hourStr, 10) || 0

    const isBusinessDay = routingConfig.businessDays.some(
      (d) => d.toLowerCase() === weekdayStr.toLowerCase(),
    )

    // Check business hours
    const isBusinessHours =
      isBusinessDay &&
      hour >= routingConfig.businessHoursStart &&
      hour < routingConfig.businessHoursEnd

    console.log(
      `[Call Router] MT Time: ${weekdayStr} ${hour}:00, isBusinessDay: ${isBusinessDay}, isBusinessHours: ${isBusinessHours}`,
    )

    let twimlResponse

    const baseUrl = getBaseUrl()
    const afterHoursUrl = `${baseUrl}/api/twilio/call-after-hours`
    const ivrMenuUrl = `${baseUrl}/api/twilio/ivr-menu`
    const failoverUrl = `${baseUrl}/api/twilio/dial-failover?mode=open-line`

    if (routingConfig.temporaryOpenLineMode) {
      console.log(
        '[Call Router] Temporary open line mode active - dialing primary first',
      )
      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="${routingConfig.openLineTimeoutSeconds}" action="${failoverUrl}" callerId="${callerPhone}" answerOnBridge="true">
    <Number>${routingConfig.primaryForwardNumber}</Number>
  </Dial>
</Response>`
    } else if (isBusinessHours) {
      console.log('[Call Router] Business hours - IVR menu')
      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather action="${ivrMenuUrl}" numDigits="1" timeout="10">
    <Say>Thank you for calling Sasquatch Carpet Cleaning. To book or change an appointment, press 1. For active water damage, a burst pipe, or flooding, press 2.</Say>
  </Gather>
  <Redirect method="POST">${afterHoursUrl}</Redirect>
</Response>`
    } else {
      console.log(
        '[Call Router] After hours - water-damage option then voicemail',
      )
      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather action="${ivrMenuUrl}?context=after-hours" numDigits="1" timeout="10">
    <Say>Thank you for calling Sasquatch Carpet Cleaning. If you have active water damage, a burst pipe, or flooding, press 2 now. For anything else, stay on the line to leave a message.</Say>
  </Gather>
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
    console.error('[Call Router] Error:', error)

    // Fallback to after hours handler on error
    const baseUrl = getBaseUrl()
    const afterHoursUrl = `${baseUrl}/api/twilio/call-after-hours`

    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${afterHoursUrl}</Redirect>
</Response>`

    return new NextResponse(fallbackTwiml, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    })
  }
}
