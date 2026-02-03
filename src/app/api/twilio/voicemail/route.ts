import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

    // Send notification to admin (using existing admin SMS function would require the setup we're waiting on)
    // For now, log it prominently
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
