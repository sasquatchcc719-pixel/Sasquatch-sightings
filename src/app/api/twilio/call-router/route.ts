import { NextRequest, NextResponse } from 'next/server'
import { getCallRoutingConfig } from '@/lib/twilio/call-routing-config'
import { sendOneSignalNotification } from '@/lib/onesignal'
import { isBlacklisted, notifyBlockedAttempt } from '@/lib/blacklist'
import { createAdminClient } from '@/supabase/server'
import { buildForwardDial } from '@/lib/twilio/forward-twiml'
import { buildCallerMenu } from '@/lib/twilio/caller-menu'

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

    if (await isBlacklisted(callerPhone, { throwOnError: true })) {
      try {
        const supabase = createAdminClient()
        const { error } = await supabase.from('call_logs').upsert(
          {
            call_sid: formData.get('CallSid') as string,
            caller_phone: callerPhone,
            outcome: 'blacklisted',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'call_sid' },
        )
        if (error)
          console.error('[Call Router] Could not log blocked call:', error)
        notifyBlockedAttempt(callerPhone, 'call')
      } catch (error) {
        console.error('[Call Router] Could not log blocked call:', error)
      }
      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>',
        { status: 200, headers: { 'Content-Type': 'text/xml' } },
      )
    }

    const routingConfig = await getCallRoutingConfig()

    console.log(`[Call Router] Incoming call from: ${callerPhone}`)

    // Log every non-blacklisted inbound call. The forwarding and voicemail
    // callbacks update this row with the final outcome later.
    const supabaseLog = createAdminClient()
    const { error: logError } = await supabaseLog.from('call_logs').upsert(
      {
        call_sid: formData.get('CallSid') as string,
        caller_phone: callerPhone,
        outcome: 'inbound',
        forwarding_required: true,
        caller_screening_status: routingConfig.temporaryOpenLineMode
          ? 'bypassed'
          : 'pending',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'call_sid', ignoreDuplicates: true },
    )
    if (logError)
      console.error('[Call Router] Could not save inbound call:', logError)

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
    if (routingConfig.temporaryOpenLineMode) {
      // Fire push notification immediately (don't await — must not delay TwiML)
      const displayPhone = callerPhone.replace(
        /^\+1(\d{3})(\d{3})(\d{4})$/,
        '($1) $2-$3',
      )
      sendOneSignalNotification({
        heading: 'Incoming Call',
        content: `${displayPhone || callerPhone} is calling`,
        data: {
          type: 'incoming_call',
          phone: callerPhone,
          url: '/admin/phone',
        },
      }).catch((err) =>
        console.error('[Call Router] Push notification error:', err),
      )

      console.log('[Call Router] Direct primary then secondary forwarding')
      twimlResponse = buildForwardDial({
        config: routingConfig,
        callerPhone,
        callSid: String(formData.get('CallSid') || ''),
        baseUrl,
        mode: 'open-line',
      })
    } else {
      console.log('[Call Router] Caller spam screening menu', {
        afterHours: !isBusinessHours,
      })
      twimlResponse = buildCallerMenu({ baseUrl, afterHours: !isBusinessHours })
    }

    return new NextResponse(twimlResponse, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    })
  } catch (error) {
    console.error('[Call Router] Error:', error)

    // Keep the phone sequence available when logging or configuration fails.
    const baseUrl = getBaseUrl()
    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${baseUrl}/api/twilio/call-fallback</Redirect></Response>`

    return new NextResponse(fallbackTwiml, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    })
  }
}
