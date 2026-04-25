import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import twilio from 'twilio'
import {
  getHarryControlSnapshot,
  isHarryChannelEnabled,
  isHarryFunctionEnabled,
} from '@/lib/harry/control'

/** Twilio may run 120s+; default Vercel timeout would kill Harry before SMS. */
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

function shouldEmailVoicemail(
  transcriptionText: string | null,
  recordingDuration: string | null,
): boolean {
  const durationSeconds = Number(recordingDuration ?? '0')

  return (
    hasMeaningfulTranscription(transcriptionText) ||
    durationSeconds >= MIN_VOICEMAIL_EMAIL_DURATION_SECONDS
  )
}

function getBaseUrl(): string {
  const url =
    process.env.VERCEL_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'sightings.sasquatchcarpet.com'
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
    'Hi! This is Harry from Sasquatch Carpet Cleaning. Thanks for your voicemail.'

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

    // Add or merge voicemail (Twilio may POST recording first, transcription later — same RecordingSid)
    let messages = (existingConvo?.messages || []) as ConversationMessage[]
    const voicemailMeta = {
      type: 'voicemail' as const,
      recording_url: audioUrl,
      recording_sid: recordingSid,
      duration: recordingDuration,
      transcription: transcriptionText,
    }
    if (conversationId && recordingSid) {
      const idx = messages.findIndex(
        (m) =>
          m?.role === 'user' &&
          m?.metadata?.type === 'voicemail' &&
          m?.metadata?.recording_sid === recordingSid,
      )
      const line = `[VOICEMAIL - ${recordingDuration}s] ${transcriptionText || '(No transcription available)'}`
      if (idx >= 0) {
        const prev = messages[idx]
        messages[idx] = {
          ...prev,
          content: line,
          metadata: { ...prev.metadata, ...voicemailMeta },
        }
      } else {
        messages.push({
          role: 'user',
          content: line,
          timestamp: new Date().toISOString(),
          metadata: voicemailMeta,
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
      const controlSnapshot = await getHarryControlSnapshot()
      // Same bar as SMS Harry: inbound intake + main channel + auto-reply.
      // Not tied to "missed call SMS" — that toggle only affects call-after-hours dial callbacks.
      const canRunVoicemailAutoReply =
        isHarryFunctionEnabled(controlSnapshot, 'global_enabled') &&
        isHarryFunctionEnabled(
          controlSnapshot,
          'inbound_channel_intake_enabled',
        ) &&
        isHarryFunctionEnabled(controlSnapshot, 'auto_reply_enabled') &&
        isHarryChannelEnabled(controlSnapshot, 'inbound')

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

          const harryMessage = buildVoicemailAutoReply(latestTranscript)

          const twilioClient = twilio(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_AUTH_TOKEN,
          )

          const sms = await twilioClient.messages.create({
            body: harryMessage,
            to: normalizedPhone,
            from: process.env.TWILIO_PHONE_NUMBER,
          })

          const nextMessages = [...latestMessages]
          nextMessages.push({
            role: 'assistant',
            content: harryMessage,
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
            message_content: harryMessage,
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

    if (shouldEmailVoicemail(transcriptionText, recordingDuration)) {
      try {
        await resend.emails.send({
          from: voicemailFromEmail,
          to: voicemailNotifyEmail,
          subject: `🎤 New Voicemail from ${normalizedPhone}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #166534;">New Voicemail Received</h2>
              
              <div style="background: #f0fdf4; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p style="margin: 0 0 8px 0;"><strong>📞 From:</strong> <a href="tel:${normalizedPhone}">${normalizedPhone}</a></p>
                <p style="margin: 0 0 8px 0;"><strong>⏱️ Duration:</strong> ${recordingDuration} seconds</p>
                <p style="margin: 0;"><strong>🕐 Time:</strong> ${timestamp}</p>
              </div>
              
              <h3 style="color: #166534;">Transcription</h3>
              <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p style="margin: 0; white-space: pre-wrap;">${transcriptionText || '(No transcription available)'}</p>
              </div>
              
              <div style="margin: 24px 0;">
                <a href="${audioUrl}" style="display: inline-block; background: #166534; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
                  🔊 Listen to Voicemail
                </a>
              </div>
              
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
        '[Voicemail] Skipping email for likely junk voicemail:',
        JSON.stringify({
          from: normalizedPhone,
          duration: recordingDuration,
          transcription: transcriptionText || '(none)',
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
