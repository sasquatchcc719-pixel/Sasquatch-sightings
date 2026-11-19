import { NextRequest, NextResponse } from 'next/server'
import { getCallRoutingConfig } from '@/lib/twilio/call-routing-config'
import { buildForwardDial, escapeTwiml } from '@/lib/twilio/forward-twiml'
import {
  getHarryAccess,
  harryPreviewReady,
  isHarryPreviewCall,
  isHarryMainNumber,
} from '@/lib/twilio/harry-access'
import {
  buildCallerMenu,
  buildHarryDirectory,
  type HarryMenuContext,
} from '@/lib/twilio/caller-menu'
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

async function harryMenuResponse(
  request: NextRequest,
  form: FormData,
  context: HarryMenuContext,
) {
  const baseUrl = getBaseUrl()
  const callerPhone = String(form.get('From') || '')
  const digits = String(form.get('Digits') || '')
  const callSid = String(form.get('CallSid') || '')
  const preview = context === 'harry-preview'
  const flood = request.nextUrl.searchParams.get('flood')
  const twiml = (body: string) =>
    new NextResponse(body, { headers: { 'Content-Type': 'text/xml' } })
  const end = (message: string) =>
    twiml(`<Response><Say>${message}</Say><Hangup/></Response>`)
  const redirect = (url: string) =>
    twiml(
      `<Response><Redirect method="POST">${escapeTwiml(url)}</Redirect></Response>`,
    )
  const voicemail = () =>
    preview
      ? end(
          'This is where a caller could leave a message. Your private preview has ended.',
        )
      : redirect(`${baseUrl}/api/twilio/call-after-hours`)
  if (!isHarryMainNumber(String(form.get('To') || '')))
    return end('This directory is unavailable.')
  const access = await getHarryAccess(callerPhone)
  if (preview && !access.preview) {
    // A keypad tester can reach this confirmation from an active pilot call.
    if (!flood || !(await isHarryPreviewCall(callSid, callerPhone)))
      return end('Your private preview has ended.')
  }
  if (flood === 'prompt' || (!flood && digits === '2')) {
    return twiml(buildHarryDirectory(baseUrl, context, true))
  }
  if (flood === 'confirm' && digits === '1') {
    if (preview)
      return end(
        'The emergency transfer was simulated. Your private preview has ended.',
      )
    const config = await getCallRoutingConfig()
    const { error } = await createAdminClient()
      .from('call_logs')
      .update({
        caller_screening_status: 'passed',
        forwarding_required: true,
      })
      .eq('call_sid', callSid)
    if (error)
      console.error(
        '[Harry Directory] Could not log confirmed emergency:',
        error.code,
      )
    return twiml(
      buildForwardDial({
        config,
        callerPhone,
        callSid,
        baseUrl,
        mode: 'water-damage',
        secondary: true,
      }),
    )
  }
  if (flood || digits !== '1' || (!preview && !access.publicEnabled))
    return voicemail()
  return redirect(
    `${baseUrl}/api/twilio/harry-voice?step=start&preview=${preview ? '1' : '0'}`,
  )
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
    const context = request.nextUrl.searchParams.get('context')
    if (
      formData.get('Digits') === '3' &&
      !request.nextUrl.searchParams.has('flood') &&
      isHarryMainNumber(String(formData.get('To') || '')) &&
      harryPreviewReady()
    ) {
      // Suppress missed-call follow-ups even when the tester hangs up during the redirect.
      const { error } = await createAdminClient()
        .from('call_logs')
        .update({ voice_preview: true, forwarding_required: false })
        .eq('call_sid', String(formData.get('CallSid') || ''))
        .eq('caller_phone', String(formData.get('From') || ''))
        .select('call_sid')
        .single()
      if (error)
        return new NextResponse(
          '<Response><Say>The test call is unavailable right now.</Say><Hangup/></Response>',
          { headers: { 'Content-Type': 'text/xml' } },
        )
      const destination =
        getBaseUrl() +
        '/api/twilio/harry-voice?step=start&preview=1&entry=keypad'
      return new NextResponse(
        '<Response><Redirect method="POST">' +
          escapeTwiml(destination) +
          '</Redirect></Response>',
        { headers: { 'Content-Type': 'text/xml' } },
      )
    }
    if (context === 'harry-preview' || context === 'harry-public') {
      return await harryMenuResponse(request, formData, context)
    }
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

    const validSelection = digits === '1' || (!isAfterHours && digits === '2')
    const status = validSelection
      ? 'passed'
      : isAfterHours || attempt === 1
        ? 'voicemail'
        : 'pending'
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
      if (digits === '2') {
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
          mode: 'water-damage',
          secondary: true,
        })
    } else if (!isAfterHours && attempt === 0) {
      twimlResponse = buildCallerMenu({
        baseUrl,
        afterHours: isAfterHours,
        attempt: 1,
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

    return new NextResponse('Could not route menu selection', { status: 500 })
  }
}
