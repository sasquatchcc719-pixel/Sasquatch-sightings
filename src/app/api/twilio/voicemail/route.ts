import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import twilio from 'twilio'
import { createAdminClient } from '@/supabase/server'

/** Twilio may run 120s+; default Vercel timeout would kill the SMS send. */
export const maxDuration = 300

const resend = new Resend(process.env.RESEND_API_KEY)

const voicemailFromEmail =
  process.env.OPS_EMAIL_FROM || 'Sasquatch Voicemail <onboarding@resend.dev>'
const voicemailNotifyEmail =
  process.env.OWNER_ALERT_EMAIL || 'sasquatchcc719@gmail.com'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const MIN_VOICEMAIL_EMAIL_DURATION_SECONDS = 5
const VOICEMAIL_CONTEXT_REPLY_DELAY_MS = 120000
const RECENT_REPLY_SUPPRESSION_MS = 15 * 60 * 1000

type ConversationMessage = {
  role?: string
  content?: string
  timestamp?: string
  twilio_sid?: string
  metadata?: {
    type?: string
    transcription?: string | null
    recording_url?: string | null
    recording_sid?: string | null
    duration?: string | null
    voicemail_harry_reply_for?: string | null
    email_sent?: boolean
  } | null
}

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
    const adminBaseUrl = getBaseUrl()

    // Twilio sends these fields
    const recordingUrl = formData.get('RecordingUrl') as string
    const recordingSid = formData.get('RecordingSid') as string
    const transcriptionText = formData.get('TranscriptionText') as string
    const callerPhone = formData.get('From') as string
    const callSid = formData.get('CallSid') as string
    const recordingDuration = formData.get('RecordingDuration') as string
    // Only the transcribe callback carries TranscriptionStatus (completed |
    // failed). The earlier recording/status callbacks don't — we use this to
    // send a single notification once transcription has finished.
    const transcriptionStatus = formData.get('TranscriptionStatus') as
      | string
      | null

    console.log('[Voicemail] Received:', {
      from: callerPhone,
      duration: recordingDuration,
      hasTranscription: !!transcriptionText,
      recordingSid,
    })

    // Normalize phone number
    const digits = callerPhone?.replace(/\D/g, '') || ''
    const normalizedPhone =
      digits.length === 10
        ? `+1${digits}`
        : digits.length === 11 && digits.startsWith('1')
          ? `+${digits}`
          : `+${digits}`

    // The actual audio file URL (add .mp3 to get downloadable file)
    const audioUrl = recordingUrl ? `${recordingUrl}.mp3` : null

    // Create or find conversation for this caller
    const { data: existingConvo } = await supabase
      .from('conversations')
      .select('*')
      .eq('phone_number', normalizedPhone)
      .eq('source', 'inbound')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()

    let conversationId = existingConvo?.id

    if (!existingConvo) {
      const { data: newConvo, error: convoError } = await supabase
        .from('conversations')
        .insert({
          phone_number: normalizedPhone,
          source: 'inbound',
          status: 'active',
          ai_enabled: true,
          messages: [],
          metadata: { trigger: 'voicemail', call_sid: callSid },
        })
        .select()
        .single()

      if (!convoError && newConvo) {
        conversationId = newConvo.id
      }
    }

    // Add or merge voicemail. Twilio hits this endpoint more than once for a
    // single voicemail — the recording/status callbacks first (duration, no
    // transcript), then the transcribe callback later (transcript, no
    // duration). Merge by RecordingSid, always keeping the best-known value so
    // a later callback never clobbers good data with a blank.
    const messages = (existingConvo?.messages || []) as ConversationMessage[]
    const priorVoicemail = recordingSid
      ? messages.find(
          (m) =>
            m?.role === 'user' &&
            m?.metadata?.type === 'voicemail' &&
            m?.metadata?.recording_sid === recordingSid,
        )
      : undefined

    const mergedTranscription =
      transcriptionText || priorVoicemail?.metadata?.transcription || null
    const mergedDuration =
      recordingDuration || priorVoicemail?.metadata?.duration || null
    const mergedAudioUrl =
      audioUrl || priorVoicemail?.metadata?.recording_url || null
    const alreadyEmailed = priorVoicemail?.metadata?.email_sent === true

    // Notify exactly once, when transcription has finished (success or
    // failure). Only the transcribe callback sets TranscriptionStatus, so the
    // earlier recording callbacks are skipped — this is what kills the old
    // "blank first email" duplicate.
    const isTranscriptionCallback = transcriptionStatus != null
    const willEmail = isTranscriptionCallback && !alreadyEmailed

    if (conversationId && recordingSid) {
      const line = `[VOICEMAIL - ${mergedDuration ?? '?'}s] ${mergedTranscription || '(No transcription available)'}`
      const mergedMeta = {
        type: 'voicemail' as const,
        recording_url: mergedAudioUrl,
        recording_sid: recordingSid,
        duration: mergedDuration,
        transcription: mergedTranscription,
        email_sent: alreadyEmailed || willEmail,
      }
      if (priorVoicemail) {
        priorVoicemail.content = line
        priorVoicemail.metadata = { ...priorVoicemail.metadata, ...mergedMeta }
      } else {
        messages.push({
          role: 'user',
          content: line,
          timestamp: new Date().toISOString(),
          metadata: mergedMeta,
        })
      }

      await supabase
        .from('conversations')
        .update({
          messages,
          status: 'escalated', // Mark as escalated so you see it
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
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

    // Update call_logs with voicemail recording details — fire-and-forget
    if (callSid) {
      const supabaseLog = createAdminClient()
      supabaseLog
        .from('call_logs')
        .upsert(
          {
            call_sid: callSid,
            caller_phone: normalizedPhone,
            outcome: 'voicemail',
            recording_url: audioUrl || null,
            transcription: transcriptionText || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'call_sid' },
        )
        .then()
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

    // Send email notification
    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'America/Denver',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })

    if (willEmail) {
      // Decide what actually happened: a real message, a recording we can't
      // transcribe, or a caller who reached voicemail and left nothing.
      const hasTranscript = hasMeaningfulTranscription(mergedTranscription)
      const durationSeconds = Number(mergedDuration ?? '0')
      const leftAMessage =
        hasTranscript || durationSeconds >= MIN_VOICEMAIL_EMAIL_DURATION_SECONDS
      const durationLabel = mergedDuration ? `${mergedDuration} seconds` : '—'

      const transcriptionBlock = hasTranscript
        ? `
              <h3 style="color: #166534;">Transcription</h3>
              <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p style="margin: 0; white-space: pre-wrap;">${mergedTranscription}</p>
              </div>`
        : leftAMessage
          ? `
              <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p style="margin: 0; color: #6b7280;">A message was left, but no transcription is available. Tap below to listen.</p>
              </div>`
          : `
              <div style="background: #fef3c7; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p style="margin: 0; color: #92400e;">The caller reached your voicemail but did not leave a message.</p>
              </div>`

      const listenBlock = mergedAudioUrl
        ? `
              <div style="margin: 24px 0;">
                <a href="${mergedAudioUrl}" style="display: inline-block; background: #166534; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
                  🔊 Listen to Voicemail
                </a>
              </div>`
        : ''

      try {
        await resend.emails.send({
          from: voicemailFromEmail,
          to: voicemailNotifyEmail,
          subject: leftAMessage
            ? `🎤 New Voicemail from ${normalizedPhone}`
            : `📞 Missed call (no message) from ${normalizedPhone}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #166534;">${leftAMessage ? 'New Voicemail Received' : 'Missed Call — No Message Left'}</h2>

              <div style="background: #f0fdf4; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p style="margin: 0 0 8px 0;"><strong>📞 From:</strong> <a href="tel:${normalizedPhone}">${normalizedPhone}</a></p>
                <p style="margin: 0 0 8px 0;"><strong>⏱️ Duration:</strong> ${durationLabel}</p>
                <p style="margin: 0;"><strong>🕐 Time:</strong> ${timestamp}</p>
              </div>
              ${transcriptionBlock}
              ${listenBlock}
              <p style="color: #6b7280; font-size: 14px;">
                View in admin: <a href="${adminBaseUrl}/admin/conversations?source=phone">Phone Calls</a>
              </p>
            </div>
          `,
        })
        console.log(`[Voicemail] Email sent to ${voicemailNotifyEmail}`)
      } catch (emailError) {
        console.error('[Voicemail] Failed to send email:', emailError)
      }
    } else {
      console.log(
        '[Voicemail] No email this callback:',
        JSON.stringify({
          from: normalizedPhone,
          isTranscriptionCallback,
          alreadyEmailed,
          duration: mergedDuration ?? '(none)',
          transcription: mergedTranscription || '(none)',
        }),
      )
    }

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
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      },
    )
  }
}
