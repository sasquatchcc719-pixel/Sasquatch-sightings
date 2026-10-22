import { NextRequest, NextResponse } from 'next/server'
import { getCallRoutingConfig } from '@/lib/twilio/call-routing-config'
import { buildForwardDial } from '@/lib/twilio/forward-twiml'
import { buildCallerMenu } from '@/lib/twilio/caller-menu'
import { createAdminClient } from '@/supabase/server'
import { sendOneSignalNotification } from '@/lib/onesignal'
import { validateTwilioInboundRequest } from '@/lib/twilio/inbound-auth'
import { buildAppointmentEnqueue } from '@/lib/twilio/appointment-queue'

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
    if (
      !validateTwilioInboundRequest({
        request,
        form: Object.fromEntries(
          [...formData.entries()].map(([k, v]) => [k, String(v)]),
        ),
      })
    )
      return new NextResponse('Forbidden', { status: 403 })
    const digits = formData.get('Digits') as string
    const callSid = String(formData.get('CallSid') || '')
    const attempt = request.nextUrl.searchParams.get('attempt') === '1' ? 1 : 0
    const callerPhone = formData.get('From') as string
    const isAfterHours =
      request.nextUrl.searchParams.get('context') === 'after-hours'

    console.log(`[IVR Menu] Selection: ${digits} from ${callerPhone}`)

    const baseUrl = getBaseUrl()
    const afterHoursUrl = `${baseUrl}/api/twilio/call-after-hours` // Voicemail

    let twimlResponse

    const validSelection = digits === '2' || (digits === '1' && !isAfterHours)
    const status = validSelection
      ? 'passed'
      : !isAfterHours && attempt === 0
        ? 'pending'
        : 'voicemail'
    try {
      const { error } = await createAdminClient()
        .from('call_logs')
        .update({ caller_screening_status: status })
        .eq('call_sid', callSid)
      if (error)
        console.error('[IVR Menu] Could not save screening result:', error)
    } catch (error) {
      console.error('[IVR Menu] Could not save screening result:', error)
    }
    if (validSelection) {
      const routingConfig = await getCallRoutingConfig()
      sendOneSignalNotification({
        heading: 'Incoming Call',
        content: `${callerPhone} selected option ${digits}`,
        data: {
          type: 'incoming_call',
          phone: callerPhone,
          url: '/admin/phone',
        },
      }).catch((error) =>
        console.error('[IVR Menu] Push notification failed:', error),
      )
      if (digits === '1') {
        const { error } = await createAdminClient()
          .from('call_logs')
          .update({ appointment_queued_at: new Date().toISOString() })
          .eq('call_sid', callSid)
        if (error) throw error
        twimlResponse = buildAppointmentEnqueue(baseUrl)
      } else
        twimlResponse = buildForwardDial({
          config: routingConfig,
          callerPhone,
          callSid,
          baseUrl,
          mode: digits === '2' ? 'water-damage' : 'schedule',
        })
    } else if (!isAfterHours && attempt === 0) {
      twimlResponse = buildCallerMenu({ baseUrl, attempt: 1 })
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

    return new NextResponse('Could not route menu selection', { status: 500 })
  }
}
