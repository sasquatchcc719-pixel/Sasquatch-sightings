import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import twilio from 'twilio'
import { createAdminClient } from '@/supabase/server'
import { writeCallLog } from '@/lib/twilio/call-history'
import { validateTwilioInboundRequest } from '@/lib/twilio/inbound-auth'
import {
  mergeVoicemailCallback,
  resolveVoicemailCaller,
  type VoicemailMessage as ConversationMessage,
} from '@/lib/twilio/voicemail'

/** Twilio may run 120s+; default Vercel timeout would kill the SMS send. */
export const maxDuration = 300

const resend = new Resend(process.env.RESEND_API_KEY)

const voicemailFromEmail =
  process.env.OPS_EMAIL_FROM || 'Sasquatch Voicemail <onboarding@resend.dev>'
const voicemailNotifyEmail =
  process.env.OWNER_ALERT_EMAIL || 'sasquatchcc719@gmail.com'

const VOICEMAIL_CONTEXT_REPLY_DELAY_MS = 120000
const RECENT_REPLY_SUPPRESSION_MS = 15 * 60 * 1000

function hasMeaningfulTranscription(transcriptionText: string | null): boolean {
  const normalized = transcriptionText?.trim().toLowerCase() ?? ''

  if (!normalized) return false

  return ![
    '(no transcription available)',
    'no transcription',
    '(none)',
    'none',
  ].includes(normalized)
}

function getBaseUrl(): string {
  const url = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_URL ||
    'sightings.sasquatchcarpet.com'
  ).trim()
  return url.startsWith('http') ? url : `https://${url}`
}

function getLatestVoicemailTranscription(
  messages: ConversationMessage[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.role !== 'user') continue
    const fromMetadata = message?.metadata?.transcription
    if (
      message?.metadata?.type === 'voicemail' &&
      hasMeaningfulTranscription(fromMetadata ?? null)
    ) {
      return String(fromMetadata).trim()
    }
  }
  return null
}

function buildVoicemailAutoReply(latestTranscript: string | null): string {
  // Keep replies concise and natural; never quote transcript text back.
  const base =
    'Hi! This is Sasquatch Carpet Cleaning. Thanks for your voicemail.'

  if (!latestTranscript) {
    return `${base} I can help by text, or Charles can call you back shortly.`
  }

  const normalized = latestTranscript.toLowerCase()
  const mentionsFutureWork =
    normalized.includes('downstairs') ||
    normalized.includes('few weeks') ||
    normalized.includes('next month') ||
    normalized.includes('later this month')
  const mentionsPositiveFeedback =
    normalized.includes('pleased') ||
    normalized.includes('loved') ||
    normalized.includes('great') ||
    normalized.includes('thank')

  if (mentionsFutureWork) {
    return `${base} No rush at all. When you're ready to schedule, just reply here and we'll get you booked.`
  }

  if (mentionsPositiveFeedback) {
    return `${base} We really appreciate the kind feedback. If you'd like, Charles can call you back, or we can handle everything right here by text.`
  }

  return `${base} I can help by text, or Charles can call you back shortly.`
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
    const conversationId = merged.conversation_id
    const messages = merged.messages
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

    // Recording completion must alert the owner even if transcription never
    // arrives. The payload stays identical on retries and transcript updates,
    // so simultaneous callbacks share the provider's idempotency key.
    if (
      metadata.recording_completed &&
      mergedAudioUrl &&
      !metadata.email_sent
    ) {
      const { data: delivery, error: deliveryError } = await resend.emails.send(
        {
          from: voicemailFromEmail,
          to: voicemailNotifyEmail,
          subject: `New voicemail recording from ${normalizedPhone}`,
          html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #166534;">New voicemail recording</h2>
            <p>From: <a href="tel:${normalizedPhone}">${normalizedPhone}</a></p>
            <p>A voicemail recording is available. Short recordings can still contain a message; listen to confirm.</p>
            <p><a href="${adminBaseUrl}/admin/conversations?source=phone">Listen and view the caller's conversation</a></p>
            <p>A transcription will appear there when available.</p>
            <p style="color: #6b7280; font-size: 12px;">Recording: ${recordingSid}</p>
          </div>
        `,
        },
        { idempotencyKey: `voicemail-recording/${recordingSid}` },
      )
      if (deliveryError || !delivery?.id)
        throw new Error(
          deliveryError?.message || 'Email provider did not confirm delivery',
        )
      // Mark only after the provider accepted it. If this save fails, the same
      // key makes a retried completion safe rather than suppressing the alert.
      await mergeVoicemailCallback(supabase, callback, true)
      console.log('[Voicemail] Recording notification accepted:', delivery.id)
    }

    // Context-aware voicemail reply:
    // Wait briefly for transcription callback data, then send a reply that references
    // what the caller said. We skip if transcription isn't meaningful.
    try {
      // Deterministic voicemail follow-up text (no LLM). Shares the
      // MISSED_CALL_AUTO_SMS_ENABLED switch; off by default. Replies land in
      // the Telegram relay where Charles answers.
      const canRunVoicemailAutoReply =
        process.env.MISSED_CALL_AUTO_SMS_ENABLED === 'true'

      if (canRunVoicemailAutoReply && conversationId) {
        await new Promise((resolve) =>
          setTimeout(resolve, VOICEMAIL_CONTEXT_REPLY_DELAY_MS),
        )

        const { data: refreshedConvo } = await supabase
          .from('conversations')
          .select('messages')
          .eq('id', conversationId)
          .single()

        const latestMessages = (refreshedConvo?.messages ||
          messages ||
          []) as ConversationMessage[]
        const now = Date.now()
        const hasRecentVoicemailReply = latestMessages.some((message) => {
          if (message?.role !== 'assistant') return false
          const ts = Date.parse(String(message?.timestamp || ''))
          if (!Number.isFinite(ts)) return false
          return now - ts < RECENT_REPLY_SUPPRESSION_MS
        })

        // Also suppress if call-after-hours already sent a missed-call SMS
        const hasRecentMissedCallSms = latestMessages.some((message) => {
          if (message?.role !== 'assistant') return false
          const ts = Date.parse(String(message?.timestamp || ''))
          if (!Number.isFinite(ts)) return false
          return now - ts < 5 * 60 * 1000 // within last 5 minutes
        })

        if (!hasRecentVoicemailReply && !hasRecentMissedCallSms) {
          const latestTranscript =
            getLatestVoicemailTranscription(latestMessages) ||
            (hasMeaningfulTranscription(transcriptionText)
              ? String(transcriptionText).trim()
              : null)

          const voicemailReply = buildVoicemailAutoReply(latestTranscript)

          const twilioClient = twilio(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_AUTH_TOKEN,
          )

          const sms = await twilioClient.messages.create({
            body: voicemailReply,
            to: normalizedPhone,
            from: process.env.TWILIO_PHONE_NUMBER,
          })

          const nextMessages = [...latestMessages]
          nextMessages.push({
            role: 'assistant',
            content: voicemailReply,
            timestamp: new Date().toISOString(),
            twilio_sid: sms.sid,
          })

          await supabase
            .from('conversations')
            .update({
              messages: nextMessages,
              updated_at: new Date().toISOString(),
            })
            .eq('id', conversationId)

          await supabase.from('sms_logs').insert({
            recipient_phone: normalizedPhone,
            message_type: 'ai_dispatcher',
            message_content: voicemailReply,
            status: 'sent',
            twilio_sid: sms.sid,
            sent_at: new Date().toISOString(),
          })
        }
      }
    } catch (fallbackSmsError) {
      console.error(
        '[Voicemail] Failed after-hours SMS fallback:',
        fallbackSmsError,
      )
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
