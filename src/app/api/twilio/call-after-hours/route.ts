import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'

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

    // Normalize phone to E.164 - strip everything except digits, then add +1
    const digits = callerPhone.replace(/\D/g, '')
    const normalizedPhone =
      digits.length === 10
        ? `+1${digits}`
        : digits.length === 11 && digits.startsWith('1')
          ? `+${digits}`
          : `+${digits}`

    console.log(
      `[Call Handler] Caller: ${normalizedPhone}, Status: ${callStatus}, DialStatus: ${dialCallStatus}, SID: ${callSid}`,
    )

    // Send SMS if:
    // 1. No dialCallStatus (after-hours redirect - no dial happened)
    // 2. Or dialCallStatus indicates call was missed (no-answer, busy, failed)
    const shouldSendSMS =
      !dialCallStatus || !['completed', 'answered'].includes(dialCallStatus)

    if (shouldSendSMS) {
      console.log(
        `[Call Handler] Sending Harry SMS (dialCallStatus: ${dialCallStatus || 'none - after hours'})`,
      )

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
            metadata: { trigger: 'missed_call', call_sid: callSid },
          })
          .select()
          .single()

        if (convoError) {
          console.error(
            '[Call Handler] Error creating conversation:',
            convoError,
          )
          return new NextResponse(
            '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
            {
              status: 200,
              headers: { 'Content-Type': 'text/xml' },
            },
          )
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
            },
          })
          .eq('id', conversationId)
      }

      // Send SMS via Harry
      const harryMessage =
        'Hi! This is Harry from Sasquatch Carpet Cleaning. I saw you just called. How can I help you today?'

      const twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN,
      )

      const sms = await twilioClient.messages.create({
        body: harryMessage,
        to: normalizedPhone,
        from: process.env.TWILIO_PHONE_NUMBER,
      })

      console.log(
        `[Call Handler] SMS sent to ${normalizedPhone}, SID: ${sms.sid}`,
      )

      // Update conversation with Harry's message
      const messages = existingConvo?.messages || []
      messages.push({
        role: 'assistant',
        content: harryMessage,
        timestamp: new Date().toISOString(),
        twilio_sid: sms.sid,
      })

      await supabase
        .from('conversations')
        .update({ messages, updated_at: new Date().toISOString() })
        .eq('id', conversationId)

      // Log to sms_logs
      await supabase.from('sms_logs').insert({
        recipient_phone: normalizedPhone,
        message_type: 'ai_dispatcher',
        message_content: harryMessage,
        status: 'sent',
        twilio_sid: sms.sid,
        sent_at: new Date().toISOString(),
      })
    } else {
      console.log(
        `[Call Handler] Call was answered (${dialCallStatus}) - no SMS needed`,
      )
    }

    // Get the base URL for voicemail callback
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://sasquatch-sightings-git-main-charles-sewells-projects.vercel.app'
    const voicemailUrl = `${baseUrl}/api/twilio/voicemail`

    // Return voicemail TwiML - let caller leave a message
    const voicemailTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">Welcome to Sasquatch Carpet Cleaning. We are currently doing maintenance on our phone system. Please leave a message.</Say>
    <Record maxLength="120" transcribe="true" transcribeCallback="${voicemailUrl}" recordingStatusCallback="${voicemailUrl}" />
    <Say voice="alice">We didn't receive your message. Please try calling back during business hours. Goodbye.</Say>
</Response>`

    console.log('[Call Handler] Returning voicemail TwiML')

    return new NextResponse(voicemailTwiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
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
