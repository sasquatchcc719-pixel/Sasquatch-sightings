import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import twilio from 'twilio'
import { createAdminClient } from '@/supabase/server'
import { writeCallLog } from '@/lib/twilio/call-history'
import { validateTwilioInboundRequest } from '@/lib/twilio/inbound-auth'
import {
  mergeVoicemailCallback,
  resolveVoicemailCaller,
  hasMeaningfulTranscription,
} from '@/lib/twilio/voicemail'
import { buildVoicemailEmail } from '@/lib/twilio/voicemail-email'
import { sendVoicemailHarryFollowUp } from '@/lib/twilio/voicemail-follow-up'

/** Allow time for transcript email plus Harry's tailored follow-up generation. */
export const maxDuration = 300

const resend = new Resend(process.env.RESEND_API_KEY)

const voicemailFromEmail =
  process.env.OPS_EMAIL_FROM || 'Sasquatch Voicemail <onboarding@resend.dev>'
const voicemailNotifyEmail =
  process.env.OWNER_ALERT_EMAIL || 'sasquatchcc719@gmail.com'

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
    const params = Object.fromEntries(
      [...formData.entries()].map(([key, value]) => [key, String(value)]),
    )
    if (!validateTwilioInboundRequest({ request, form: params }))
      return new NextResponse('Forbidden', { status: 403 })

    const recordingSid = params.RecordingSid
    const callSid = params.CallSid
    if (
      !/^CA[0-9a-f]{32}$/i.test(callSid || '') ||
      !/^RE[0-9a-f]{32}$/i.test(recordingSid || '')
    )
      return new NextResponse('Invalid call or recording SID', { status: 400 })

    const supabase = createAdminClient()
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN,
    )
    const normalizedPhone = await resolveVoicemailCaller(
      supabase,
      twilioClient,
      callSid,
      params.From || null,
    )
    if (!normalizedPhone)
      return new NextResponse('Could not identify voicemail caller', {
        status: 422,
      })

    const adminBaseUrl = getBaseUrl()
    const recordingUrl = params.RecordingUrl || null
    const recordingDuration = params.RecordingDuration || null
    const transcriptionText = params.TranscriptionText || null
    const audioUrl = recordingUrl
      ? recordingUrl.replace(/\.(mp3|wav)$/, '') + '.mp3'
      : null
    const callback = {
      phone: normalizedPhone,
      callSid,
      recordingSid,
      audioUrl,
      duration: recordingDuration,
      transcription: transcriptionText,
      completed: params.RecordingStatus === 'completed',
    }
    const merged = await mergeVoicemailCallback(supabase, callback)
    const metadata = merged.voicemail.metadata!
    const mergedAudioUrl = metadata.recording_url
    const mergedDuration = metadata.duration
    const mergedTranscription = metadata.transcription
    const hasRecording = Boolean(
      mergedAudioUrl &&
      (Number(mergedDuration) > 0 ||
        hasMeaningfulTranscription(mergedTranscription ?? null)),
    )
    await writeCallLog(supabase, {
      call_sid: callSid,
      caller_phone: normalizedPhone,
      outcome: hasRecording ? 'voicemail' : 'no-answer',
      ...(hasRecording && Number(mergedDuration) > 0
        ? { duration_seconds: Number(mergedDuration) }
        : {}),
      ...(hasRecording && mergedAudioUrl
        ? { recording_url: mergedAudioUrl }
        : {}),
      ...(mergedTranscription ? { transcription: mergedTranscription } : {}),
    })

    // Wait for the transcript and send one complete, duplicate-safe email.
    const transcriptEmailText = metadata.transcription_email_text
    let transcriptEmailId = metadata.transcription_email_id
    if (hasMeaningfulTranscription(transcriptEmailText) && !transcriptEmailId) {
      const { data: delivery, error: deliveryError } = await resend.emails.send(
        {
          from: voicemailFromEmail,
          to: voicemailNotifyEmail,
          ...buildVoicemailEmail({
            phone: normalizedPhone,
            transcript: transcriptEmailText,
            conversationUrl: `${adminBaseUrl}/admin/conversations?source=phone`,
          }),
        },
        { idempotencyKey: `voicemail-transcription-v2/${recordingSid}` },
      )
      if (deliveryError || !delivery?.id)
        throw new Error(
          deliveryError?.message ||
            'Email provider did not accept the voicemail transcription',
        )
      await mergeVoicemailCallback(supabase, callback, true, delivery.id)
      transcriptEmailId = delivery.id
      console.log(
        '[Voicemail] Transcription notification accepted:',
        delivery.id,
      )
    }

    // Email is the durable owner notification. Only after it is accepted does
    // Harry read the same transcript and send one duplicate-safe customer SMS.
    if (transcriptEmailId && hasMeaningfulTranscription(transcriptEmailText)) {
      await sendVoicemailHarryFollowUp({
        db: supabase,
        recordingSid,
        phone: normalizedPhone,
        transcript: transcriptEmailText,
      })
    }

    // Log to sms_logs for tracking (using it as general message log)
    await supabase.from('sms_logs').insert({
      recipient_phone: normalizedPhone,
      message_type: 'voicemail_received',
      message_content: `Voicemail (${recordingDuration}s): ${transcriptionText || 'No transcription'} | Audio: ${audioUrl}`,
      status: 'received',
      twilio_sid: recordingSid,
      sent_at: new Date().toISOString(),
    })

    console.log('========================================')
    console.log('🎤 NEW VOICEMAIL RECEIVED')
    console.log(`📞 From: ${normalizedPhone}`)
    console.log(`⏱️  Duration: ${recordingDuration} seconds`)
    console.log(`📝 Transcription: ${transcriptionText || '(none)'}`)
    console.log(`🔊 Audio: ${audioUrl}`)
    console.log('========================================')

    // Return empty TwiML
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      },
    )
  } catch (error) {
    console.error('[Voicemail] Error:', error)
    return new NextResponse('Could not process voicemail callback', {
      status: 500,
    })
  }
}
