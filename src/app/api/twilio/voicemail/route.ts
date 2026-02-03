import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()

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

    // Add voicemail to conversation messages
    if (conversationId) {
      const messages = existingConvo?.messages || []
      messages.push({
        role: 'user',
        content: `[VOICEMAIL - ${recordingDuration}s] ${transcriptionText || '(No transcription available)'}`,
        timestamp: new Date().toISOString(),
        metadata: {
          type: 'voicemail',
          recording_url: audioUrl,
          recording_sid: recordingSid,
          duration: recordingDuration,
          transcription: transcriptionText,
        },
      })

      await supabase
        .from('conversations')
        .update({
          messages,
          status: 'escalated', // Mark as escalated so you see it
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
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

    try {
      await resend.emails.send({
        from: 'Sasquatch Voicemail <onboarding@resend.dev>',
        to: 'sasquatchcc719@gmail.com',
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
              View in admin: <a href="https://sasquatch-sightings-git-main-charles-sewells-projects.vercel.app/admin/conversations?source=phone">Phone Calls</a>
            </p>
          </div>
        `,
      })
      console.log('[Voicemail] Email sent to sasquatchcc719@gmail.com')
    } catch (emailError) {
      console.error('[Voicemail] Failed to send email:', emailError)
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
