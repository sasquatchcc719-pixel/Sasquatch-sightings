import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import { createAdminClient } from '@/supabase/server'
import {
  classifyCallOutcome,
  parseDialCallDuration,
  wasForwardedCallHandled,
} from '@/lib/twilio/call-outcome'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(request: NextRequest) {
  try {
    // Parse form data from Twilio
    const formData = await request.formData()
    const callerPhone = formData.get('From') as string
    const callSid = formData.get('CallSid') as string
    const callStatus = formData.get('CallStatus') as string
    const dialCallStatus = formData.get('DialCallStatus') as string
    const recordingSid = formData.get('RecordingSid') as string
    const normalizedDialCallStatus = String(dialCallStatus || '')
      .trim()
      .toLowerCase()
    const dialCallDuration = parseDialCallDuration(
      formData.get('DialCallDuration') || formData.get('CallDuration'),
    )
    const forwardedCallWasHandled = wasForwardedCallHandled(
      normalizedDialCallStatus,
      dialCallDuration,
    )

    if (!callerPhone) {
      console.error('[Call Handler] Missing caller phone number')
      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        {
          status: 200,
          headers: { 'Content-Type': 'text/xml' },
        },
      )
    }

    // A <Record> without an explicit action posts back to the current URL.
    // Older TwiML did that, so terminate any late recording callbacks instead
    // of re-running missed-call SMS and starting another recording.
    if (recordingSid) {
      console.log(
        `[Call Handler] Ignoring recording callback ${recordingSid} for call ${callSid}`,
      )
      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        {
          status: 200,
          headers: { 'Content-Type': 'text/xml' },
        },
      )
    }

    // Normalize phone to E.164 - strip everything except digits, then add +1
    const digits = callerPhone.replace(/\D/g, '')
    const normalizedPhone =
      digits.length === 10
        ? `+1${digits}`
        : digits.length === 11 && digits.startsWith('1')
          ? `+${digits}`
          : `+${digits}`

    console.log(
      `[Call Handler] Caller: ${normalizedPhone}, Status: ${callStatus}, DialStatus: ${dialCallStatus}, DialDuration: ${dialCallDuration ?? 'unknown'}s, SID: ${callSid}`,
    )

    // Update call_logs with final outcome — fire-and-forget, never block TwiML
    if (callSid) {
      const callOutcome = classifyCallOutcome(
        normalizedDialCallStatus,
        dialCallDuration,
      )
      const supabaseLog = createAdminClient()
      supabaseLog
        .from('call_logs')
        .upsert(
          {
            call_sid: callSid,
            caller_phone: normalizedPhone,
            outcome: callOutcome,
            duration_seconds: dialCallDuration,
            raw_dial_status: dialCallStatus || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'call_sid' },
        )
        .then()
    }

    // Deterministic missed-call auto-text (no LLM). Off by default; set
    // MISSED_CALL_AUTO_SMS_ENABLED=true to send it. The caller's reply lands
    // in the Telegram relay, where Charles answers by hand.
    const canSendMissedCallSms =
      process.env.MISSED_CALL_AUTO_SMS_ENABLED === 'true'

    // Send the missed-call text any time this handler owns a non-answered call.
    // After-hours/LSA fallback redirects often arrive without DialCallStatus,
    // so missing status is treated as a missed/voicemail call here.
    // Very short completed forwarding legs are commonly carrier voicemail or
    // another automated pickup, not a person actually handling the caller.
    const shouldSendSMS = canSendMissedCallSms && !forwardedCallWasHandled

    if (shouldSendSMS) {
      console.log(
        `[Call Handler] Sending missed-call SMS (dialCallStatus: ${dialCallStatus || 'none - after hours'}, dialCallDuration: ${dialCallDuration ?? 'unknown'}s)`,
      )

      try {
        if (!callSid) {
          throw new Error('Missing CallSid; refusing duplicate-unsafe SMS send')
        }

        const missedCallMessageType = `missed_call_auto_reply:${callSid}`
        const missedCallMessage =
          "Hi! This is Sasquatch Carpet Cleaning — we saw you just called and couldn't catch you. How can we help? Text us right here, or call us back at (719) 249-8791."

        // Claim this call before sending. The partial unique index on
        // message_type makes retries and concurrent Twilio callbacks harmless.
        const { data: claim, error: claimError } = await supabase
          .from('sms_logs')
          .insert({
            recipient_phone: normalizedPhone,
            message_type: missedCallMessageType,
            message_content: missedCallMessage,
            status: 'queued',
            sent_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (claimError?.code === '23505') {
          console.log(
            `[Call Handler] Missed-call SMS already claimed for ${callSid}; skipping duplicate`,
          )
          return await buildVoicemailResponse()
        }
        if (claimError || !claim) {
          throw claimError || new Error('Could not claim missed-call SMS')
        }

        // Find or create conversation for this phone number
        const { data: existingConvo } = await supabase
          .from('conversations')
          .select('*')
          .eq('phone_number', normalizedPhone)
          .eq('source', 'inbound')
          .eq('status', 'active')
          .single()

        let conversationId = existingConvo?.id

        if (!existingConvo) {
          // Create new conversation
          const { data: newConvo, error: convoError } = await supabase
            .from('conversations')
            .insert({
              phone_number: normalizedPhone,
              source: 'inbound',
              status: 'active',
              ai_enabled: true,
              messages: [],
              metadata: {
                trigger: 'missed_call',
                call_sid: callSid,
                dial_call_status: normalizedDialCallStatus || null,
                dial_call_duration_seconds: dialCallDuration,
              },
            })
            .select()
            .single()

          if (convoError) {
            throw convoError
          }

          conversationId = newConvo.id
        } else {
          // Update existing conversation with call metadata
          await supabase
            .from('conversations')
            .update({
              metadata: {
                ...existingConvo.metadata,
                last_missed_call: new Date().toISOString(),
                call_sid: callSid,
                dial_call_status: normalizedDialCallStatus || null,
                dial_call_duration_seconds: dialCallDuration,
              },
            })
            .eq('id', conversationId)
        }

        const twilioClient = twilio(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN,
        )

        const sms = await twilioClient.messages.create({
          body: missedCallMessage,
          to: normalizedPhone,
          from: process.env.TWILIO_PHONE_NUMBER,
        })

        console.log(
          `[Call Handler] SMS sent to ${normalizedPhone}, SID: ${sms.sid}`,
        )

        // Record the outbound missed-call text on the conversation thread
        const messages = existingConvo?.messages || []
        messages.push({
          role: 'assistant',
          content: missedCallMessage,
          timestamp: new Date().toISOString(),
          twilio_sid: sms.sid,
          metadata: {
            type: 'missed_call_sms',
            dial_call_status: normalizedDialCallStatus || null,
            dial_call_duration_seconds: dialCallDuration,
          },
        })

        await supabase
          .from('conversations')
          .update({ messages, updated_at: new Date().toISOString() })
          .eq('id', conversationId)

        await supabase
          .from('sms_logs')
          .update({
            status: 'sent',
            twilio_sid: sms.sid,
            sent_at: new Date().toISOString(),
          })
          .eq('id', claim.id)
      } catch (smsError) {
        console.error(
          '[Call Handler] Failed to send missed-call SMS:',
          smsError,
        )
        if (callSid) {
          await supabase
            .from('sms_logs')
            .update({
              status: 'failed',
              message_content:
                'Missed-call SMS failed before it could be sent.',
            })
            .eq('message_type', `missed_call_auto_reply:${callSid}`)
        }
      }
    } else {
      console.log(
        `[Call Handler] SMS suppressed — shouldSendSMS=${shouldSendSMS}, canSendMissedCallSms=${canSendMissedCallSms}, dialCallStatus=${dialCallStatus}, dialCallDuration=${dialCallDuration ?? 'unknown'}s`,
      )
    }

    return await buildVoicemailResponse()
  } catch (error) {
    console.error('[Call Handler] Error:', error)
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      },
    )
  }
}

async function buildVoicemailResponse(): Promise<NextResponse> {
  // Fetch phone settings from database for voicemail
  let voicemailMessage =
    "Thanks for calling Sasquatch Carpet Cleaning. You've either reached us after business hours or we're currently assisting other customers. You can book immediately at sasquatch carpet dot com and add any questions to the notes. Or leave a message after the beep and we'll get back to you as soon as possible."
  let voicemailVoice = 'Polly.Joanna-Neural'

  try {
    const { data: phoneSettings } = await supabase
      .from('phone_settings')
      .select('voicemail_message, voicemail_voice')
      .limit(1)
      .single()

    if (phoneSettings) {
      voicemailMessage = phoneSettings.voicemail_message
      voicemailVoice = phoneSettings.voicemail_voice
    }
  } catch (dbError) {
    console.error(
      '[Call Handler] Failed to fetch voicemail settings, using defaults:',
      dbError,
    )
  }

  // Base URL for callbacks (this deployment; avoid hardcoded git branch URL)
  const url = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_URL ||
    'sightings.sasquatchcarpet.com'
  ).trim()
  const baseUrl = url.startsWith('http') ? url : `https://${url}`
  const voicemailUrl = `${baseUrl}/api/twilio/voicemail`

  // Return voicemail TwiML - let caller leave a message
  const voicemailTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="${voicemailVoice}">${voicemailMessage}</Say>
    <Record maxLength="120" action="${voicemailUrl}" method="POST" transcribe="true" transcribeCallback="${voicemailUrl}" recordingStatusCallback="${voicemailUrl}" />
    <Say voice="${voicemailVoice}">We didn't receive your message. Please try calling back during business hours. Goodbye.</Say>
</Response>`

  console.log('[Call Handler] Returning voicemail TwiML')

  return new NextResponse(voicemailTwiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}
