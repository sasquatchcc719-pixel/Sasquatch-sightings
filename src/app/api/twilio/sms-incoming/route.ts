/**
 * Twilio Inbound SMS Webhook
 * Receives incoming SMS from customers and triggers AI dispatcher
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { generateAIResponse, shouldEscalate, isAIEnabled } from '@/lib/openai-chat'
import { sendCustomerSMS, sendAdminSMS } from '@/lib/twilio'

// Normalize phone number to E.164 format
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return digits.startsWith('+') ? phone : `+${digits}`
}

export async function POST(request: NextRequest) {
  try {
    // Parse Twilio webhook data (form-encoded)
    const formData = await request.formData()
    const fromPhone = formData.get('From') as string
    const messageBody = formData.get('Body') as string
    const twilioSid = formData.get('MessageSid') as string

    if (!fromPhone || !messageBody) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const normalizedPhone = normalizePhone(fromPhone)
    console.log(`📱 Inbound SMS from ${normalizedPhone}: "${messageBody}"`)

    const supabase = createAdminClient()

    // Find or create conversation
    let { data: conversation, error: fetchError } = await supabase
      .from('conversations')
      .select('*')
      .eq('phone_number', normalizedPhone)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()

    // If no active conversation, create one
    if (fetchError || !conversation) {
      // Try to link to existing lead
      const { data: lead } = await supabase
        .from('leads')
        .select('id, source')
        .eq('phone', normalizedPhone)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      const { data: newConvo, error: createError } = await supabase
        .from('conversations')
        .insert({
          phone_number: normalizedPhone,
          source: lead?.source || 'inbound',
          lead_id: lead?.id || null,
          messages: [],
          ai_enabled: true,
          status: 'active',
        })
        .select()
        .single()

      if (createError) {
        console.error('Failed to create conversation:', createError)
        return NextResponse.json({ error: 'Database error' }, { status: 500 })
      }

      conversation = newConvo
      console.log(`✨ Created new conversation: ${conversation.id}`)
    }

    // Add customer message to conversation history
    const messages = (conversation.messages as any[]) || []
    messages.push({
      role: 'user',
      content: messageBody,
      timestamp: new Date().toISOString(),
      twilio_sid: twilioSid,
    })

    // Check if AI should respond
    const aiShouldRespond = conversation.ai_enabled && isAIEnabled()

    if (!aiShouldRespond) {
      // AI disabled - just log the message, don't respond
      await supabase
        .from('conversations')
        .update({ messages })
        .eq('id', conversation.id)

      console.log('⏸️  AI dispatcher is disabled - message logged but not responded to')
      
      // Notify admin about incoming message
      await sendAdminSMS(
        `💬 Inbound SMS from ${normalizedPhone}:\n"${messageBody}"\n\n(AI is disabled - manual response needed)`,
        'ai_dispatcher_inbound'
      )

      return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    // Generate AI response
    let aiResponse: string
    try {
      aiResponse = await generateAIResponse(messageBody, messages)
      
      if (!aiResponse) {
        // AI returned empty (shouldn't happen, but handle gracefully)
        console.log('⚠️  AI returned empty response')
        await supabase
          .from('conversations')
          .update({ messages })
          .eq('id', conversation.id)
        return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
          headers: { 'Content-Type': 'text/xml' },
        })
      }

      // Add AI response to conversation
      messages.push({
        role: 'assistant',
        content: aiResponse,
        timestamp: new Date().toISOString(),
      })

      // Check if conversation should be escalated
      const needsEscalation = shouldEscalate(aiResponse)
      const newStatus = needsEscalation ? 'escalated' : 'active'

      // Save updated conversation
      await supabase
        .from('conversations')
        .update({
          messages,
          status: newStatus,
        })
        .eq('id', conversation.id)

      // Send AI response via Twilio
      await sendCustomerSMS(
        normalizedPhone,
        aiResponse,
        conversation.lead_id || undefined,
        'ai_dispatcher'
      )

      // Notify admin if escalated
      if (needsEscalation) {
        await sendAdminSMS(
          `🚨 Customer escalation needed!\nPhone: ${normalizedPhone}\nLast message: "${messageBody}"\n\nAI Response: "${aiResponse}"`,
          'ai_dispatcher_escalation'
        )
      }

      console.log(`✅ AI responded to ${normalizedPhone}`)

    } catch (aiError) {
      console.error('AI generation failed:', aiError)
      
      // Update conversation with error
      messages.push({
        role: 'system',
        content: 'ERROR: AI failed to generate response',
        timestamp: new Date().toISOString(),
      })
      
      await supabase
        .from('conversations')
        .update({ messages, status: 'escalated' })
        .eq('id', conversation.id)

      // Notify admin
      await sendAdminSMS(
        `⚠️ AI Dispatcher Error!\nPhone: ${normalizedPhone}\nMessage: "${messageBody}"\n\nError: ${aiError}\n\nPlease respond manually.`,
        'ai_dispatcher_error'
      )
    }

    // Return empty TwiML (we already sent response via sendCustomerSMS)
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    })

  } catch (error) {
    console.error('Inbound SMS webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
