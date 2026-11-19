import { NextRequest, NextResponse } from 'next/server'
import { validateTwilioInboundRequest } from '@/lib/twilio/inbound-auth'
import { escapeTwiml } from '@/lib/twilio/forward-twiml'
import { queueBaseUrl } from '@/lib/twilio/appointment-queue'
import { getCallRoutingConfig } from '@/lib/twilio/call-routing-config'
import { forwardingExpectedAt } from '@/lib/twilio/phone-health'
import {
  getHarryAccess,
  harryPreviewReady,
  isHarryPreviewCall,
  isHarryMainNumber,
} from '@/lib/twilio/harry-access'
import {
  testProfile,
  previewCallbacksLocal,
} from '@/lib/phone-assistant/preview-profile'
import {
  liveInviteHeader,
  liveInvitePurpose,
  livePreviewEnabled,
} from '@/lib/phone-assistant/live-preview'
import { issueCallToken } from '@/lib/phone-assistant/call-token'
import {
  appendVoiceTranscript,
  beginVoiceSession,
} from '@/lib/phone-assistant/records'

function xml(body: string) {
  return new NextResponse('<Response>' + body + '</Response>', {
    headers: { 'Content-Type': 'text/xml' },
  })
}
const unavailable = '<Say>The phone assistant is unavailable right now.</Say>'

export async function POST(request: NextRequest) {
  const params = Object.fromEntries(
    [...(await request.formData())].map(([k, v]) => [k, String(v)]),
  )
  if (!validateTwilioInboundRequest({ request, form: params }))
    return new Response('Forbidden', { status: 403 })
  const { CallSid: callSid, From: callerPhone, To, DialCallStatus } = params
  if (!/^CA[0-9a-f]{32}$/i.test(callSid || ''))
    return new Response('Invalid call', { status: 400 })
  const step = request.nextUrl.searchParams.get('step')
  const pilot = request.nextUrl.searchParams.get('preview') === '1'
  const voicemail =
    '<Redirect method="POST">/api/twilio/call-after-hours</Redirect>'
  if (step === 'transcript') {
    if (params.TranscriptionEvent === 'transcription-error') {
      console.error(
        '[Phone assistant] Transcription unavailable',
        callSid,
        params.TranscriptionErrorCode,
      )
    }
    if (
      params.TranscriptionEvent === 'transcription-content' &&
      params.Final === 'true'
    ) {
      const sequence = Number(params.SequenceId)
      if (
        !params.SequenceId ||
        !Number.isSafeInteger(sequence) ||
        sequence < 0 ||
        !['inbound_track', 'outbound_track'].includes(params.Track)
      )
        return new Response('Invalid event', { status: 400 })
      const data = JSON.parse(params.TranscriptionData)
      if (typeof data.transcript === 'string' && data.transcript.trim())
        await appendVoiceTranscript({
          callSid,
          sequence,
          role: params.Track === 'inbound_track' ? 'user' : 'assistant',
          content: data.transcript.trim(),
        })
    }
    return new Response(null, { status: 204 })
  }
  if (step === 'ended') {
    if (DialCallStatus === 'completed') return xml('<Hangup/>')
    return xml(unavailable + (pilot ? '<Hangup/>' : voicemail))
  }
  if (step !== 'start' || !isHarryMainNumber(To))
    return new Response('Invalid entry', { status: 403 })
  const keypadPreview =
    pilot && request.nextUrl.searchParams.get('entry') === 'keypad'
  const access = keypadPreview
    ? {
        preview:
          harryPreviewReady() &&
          (await isHarryPreviewCall(callSid, callerPhone)),
        publicEnabled: false,
      }
    : await getHarryAccess(callerPhone)
  if (
    pilot
      ? !access.preview
      : !access.publicEnabled ||
        forwardingExpectedAt(new Date(), await getCallRoutingConfig())
  ) {
    return xml(
      pilot
        ? '<Say>Your private preview has expired.</Say><Hangup/>'
        : voicemail,
    )
  }
  try {
    const project = process.env.HARRY_VOICE_PROJECT_ID?.trim()
    if (!project || !/^proj_[a-zA-Z0-9_-]+$/.test(project))
      throw new Error('Missing project')
    const profile = testProfile(pilot)
    const live = livePreviewEnabled(pilot, request.url, queueBaseUrl())
    if (
      profile !== 'current' &&
      !live &&
      !previewCallbacksLocal(request.url, queueBaseUrl())
    )
      throw new Error('Invalid preview callback origin')
    const invite = issueCallToken(
      callSid,
      live ? liveInvitePurpose(queueBaseUrl()) : 'invite',
    )
    const base = queueBaseUrl() + '/api/twilio/harry-voice'
    const sip =
      'sip:' +
      project +
      '@sip.api.openai.com;transport=tls;secure=true?' +
      (live ? liveInviteHeader : 'X-Sightings-Invite') +
      '=' +
      invite
    await beginVoiceSession({ callSid, callerPhone, pilot })
    const notice = live
      ? 'Thanks for calling the Sasquatch Carpet Cleaning after-hours directory. This is a transcribed test call with Harry, our virtual assistant. Bookings and transfers are simulated.'
      : profile.startsWith('dispatcher-')
        ? 'This call is transcribed.'
        : pilot
          ? 'Private test call. Bookings and transfers are simulated. This call is transcribed.'
          : 'This call with our virtual assistant is transcribed.'
    return xml(
      '<Say>' +
        notice +
        '</Say><Start><Transcription name="harry" track="both_tracks" partialResults="false" statusCallbackUrl="' +
        escapeTwiml(base + '?step=transcript') +
        '"/></Start><Dial timeout="18" timeLimit="2700" action="' +
        escapeTwiml(base + '?step=ended&preview=' + (pilot ? '1' : '0')) +
        '"><Sip>' +
        escapeTwiml(sip) +
        '</Sip></Dial>',
    )
  } catch {
    console.error('[Phone assistant] Could not start session', callSid)
    return xml(unavailable + (pilot ? '<Hangup/>' : voicemail))
  }
}
