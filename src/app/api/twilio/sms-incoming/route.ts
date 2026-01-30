/**
 * Twilio Inbound SMS Webhook
 * Receives incoming SMS from customers and triggers AI dispatcher
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import {
  generateAIResponse,
  shouldEscalate,
  isAIEnabled,
} from '@/lib/openai-chat'
import { sendCustomerSMS, sendAdminSMS } from '@/lib/twilio'

// Normalize phone number to E.164 format
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return digits.startsWith('+') ? phone : `+${digits}`
}

// Extract customer info from conversation messages
type ExtractedInfo = {
  name: string | null
  location: string | null
  serviceNeeded: string | null
}

function extractCustomerInfo(
  messages: { role: string; content: string }[],
): ExtractedInfo {
  const info: ExtractedInfo = {
    name: null,
    location: null,
    serviceNeeded: null,
  }

  // Get all user messages
  const userMessages = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' ')

  // Extract name - look for patterns like "I'm John", "My name is John", "This is John", "It's Sarah"
  const namePatterns = [
    /(?:my name is|i'm|this is|it's|i am|name's|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /^([A-Z][a-z]+)(?:\s+here|\s+speaking)?[.!]?\s*$/im,
  ]
  for (const pattern of namePatterns) {
    const match = userMessages.match(pattern)
    if (match && match[1]) {
      // Filter out common false positives
      const name = match[1].trim()
      const falsePositives = [
        'Hi',
        'Hello',
        'Hey',
        'Yes',
        'No',
        'Sure',
        'Thanks',
        'Great',
        'Ok',
        'Okay',
      ]
      if (!falsePositives.includes(name)) {
        info.name = name
        break
      }
    }
  }

  // Extract location - look for zip codes, city names, addresses
  const zipMatch = userMessages.match(/\b(80\d{3})\b/) // Colorado zip codes start with 80
  if (zipMatch) {
    info.location = zipMatch[1]
  } else {
    // Look for city/area names
    const cities = [
      'monument',
      'castle rock',
      'larkspur',
      'palmer lake',
      'woodmoor',
      'colorado springs',
      'northgate',
      'briargate',
      'flying horse',
      'gleneagle',
      'black forest',
      'falcon',
      'peyton',
      'elbert',
      "king's deer",
      'tri-lakes',
    ]
    const lowerMessages = userMessages.toLowerCase()
    for (const city of cities) {
      if (lowerMessages.includes(city)) {
        info.location = city
          .split(' ')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ')
        break
      }
    }
  }

  // Extract service needed
  const serviceKeywords = {
    carpet: [
      'carpet',
      'carpets',
      'room',
      'rooms',
      'bedroom',
      'living room',
      'basement',
    ],
    upholstery: [
      'couch',
      'sofa',
      'sectional',
      'loveseat',
      'chair',
      'furniture',
      'upholstery',
      'recliner',
    ],
    tile: ['tile', 'grout', 'floor', 'floors', 'kitchen floor'],
    rug: ['rug', 'rugs', 'area rug'],
    stairs: ['stairs', 'stairway', 'steps'],
    leather: ['leather'],
    pet: ['pet', 'dog', 'cat', 'urine', 'stain', 'odor'],
  }

  const lowerMessages = userMessages.toLowerCase()
  const detectedServices: string[] = []
  for (const [service, keywords] of Object.entries(serviceKeywords)) {
    if (keywords.some((kw) => lowerMessages.includes(kw))) {
      detectedServices.push(service)
    }
  }
  if (detectedServices.length > 0) {
    info.serviceNeeded = detectedServices.join(', ')
  }

  return info
}

// Detect if message indicates they came from a partner NFC card
function detectPartnerMention(message: string): boolean {
  const lowerMessage = message.toLowerCase()
  const partnerPhrases = [
    'found your card',
    'found the card',
    'scanned your card',
    'scanned the card',
    'saw your card',
    'card at',
    'from the barbershop',
    'from the gym',
    'from the coffee',
    'from the bar',
    'at joe',
    'at the salon',
    'at the shop',
    'nfc',
    'tapped',
  ]
  return partnerPhrases.some((phrase) => lowerMessage.includes(phrase))
}

export async function POST(request: NextRequest) {
  try {
    // Parse Twilio webhook data (form-encoded)
    const formData = await request.formData()
    const fromPhone = formData.get('From') as string
    const messageBody = formData.get('Body') as string
    const twilioSid = formData.get('MessageSid') as string

    if (!fromPhone || !messageBody) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 },
      )
    }

    const normalizedPhone = normalizePhone(fromPhone)
    console.log(
      `📱 Inbound SMS from ${fromPhone} → normalized to: ${normalizedPhone}`,
    )
    console.log(`📱 Message: "${messageBody}"`)

    const supabase = createAdminClient()

    // Find or create conversation - look for ANY recent conversation from this phone number
    let { data: conversation, error: fetchError } = await supabase
      .from('conversations')
      .select('*')
      .eq('phone_number', normalizedPhone)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()

    if (conversation) {
      console.log(
        `✅ Found existing conversation: ${conversation.id} with ${conversation.messages.length} messages`,
      )
    } else {
      console.log(`⚠️ No existing conversation found for ${normalizedPhone}`)
    }

    // If no conversation exists at all, create one
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

      // Check if this looks like a partner NFC referral and tag the conversation
      if (detectPartnerMention(messageBody)) {
        console.log(
          `🎯 Partner NFC referral detected in message: "${messageBody}"`,
        )

        // Tag conversation as NFC source - lead will be created once we collect enough info
        await supabase
          .from('conversations')
          .update({ source: 'NFC Card' })
          .eq('id', conversation.id)

        conversation.source = 'NFC Card'
      }
    } else {
      // Reactivate conversation if it was completed or escalated
      if (conversation.status !== 'active') {
        await supabase
          .from('conversations')
          .update({ status: 'active' })
          .eq('id', conversation.id)
        conversation.status = 'active'
        console.log(`🔄 Reactivated conversation: ${conversation.id}`)
      }
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

      console.log(
        '⏸️  AI dispatcher is disabled - message logged but not responded to',
      )

      // Notify admin about incoming message
      await sendAdminSMS(
        `💬 Inbound SMS from ${normalizedPhone}:\n"${messageBody}"\n\n(AI is disabled - manual response needed)`,
        'ai_dispatcher_inbound',
      )

      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        {
          headers: { 'Content-Type': 'text/xml' },
        },
      )
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
        return new NextResponse(
          '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
          {
            headers: { 'Content-Type': 'text/xml' },
          },
        )
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

      // Check if we should create a lead (has enough info and no lead exists yet)
      if (!conversation.lead_id) {
        const extractedInfo = extractCustomerInfo(messages)

        // Create lead if we have name AND (location OR at least 3 message exchanges)
        const hasEnoughExchanges =
          messages.filter((m) => m.role === 'user').length >= 2
        const shouldCreateLead =
          extractedInfo.name && (extractedInfo.location || hasEnoughExchanges)

        if (shouldCreateLead) {
          const leadNotes = [
            extractedInfo.serviceNeeded
              ? `Service: ${extractedInfo.serviceNeeded}`
              : null,
            extractedInfo.location
              ? `Location: ${extractedInfo.location}`
              : null,
            'Source: SMS conversation',
          ]
            .filter(Boolean)
            .join('\n')

          const { data: newLead, error: leadError } = await supabase
            .from('leads')
            .insert({
              phone: normalizedPhone,
              name: extractedInfo.name,
              source: conversation.source === 'NFC Card' ? 'NFC Card' : 'SMS',
              notes: leadNotes,
              status: 'new',
              zip_code: extractedInfo.location?.match(/\d{5}/)
                ? extractedInfo.location
                : null,
            })
            .select()
            .single()

          if (!leadError && newLead) {
            // Link the lead to this conversation
            await supabase
              .from('conversations')
              .update({ lead_id: newLead.id })
              .eq('id', conversation.id)

            console.log(
              `✅ Created lead from conversation: ${newLead.id} (Name: ${extractedInfo.name})`,
            )
          }
        }
      }

      // Send AI response via Twilio
      await sendCustomerSMS(
        normalizedPhone,
        aiResponse,
        conversation.lead_id || undefined,
        'ai_dispatcher',
      )

      // Notify admin if escalated
      if (needsEscalation) {
        await sendAdminSMS(
          `🚨 Customer escalation needed!\nPhone: ${normalizedPhone}\nLast message: "${messageBody}"\n\nAI Response: "${aiResponse}"`,
          'ai_dispatcher_escalation',
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
        'ai_dispatcher_error',
      )
    }

    // Return empty TwiML (we already sent response via sendCustomerSMS)
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      {
        headers: { 'Content-Type': 'text/xml' },
      },
    )
  } catch (error) {
    console.error('Inbound SMS webhook error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
