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
  address: string | null
  email: string | null
  zipCode: string | null
  serviceNeeded: string | null
}

function extractCustomerInfo(
  messages: { role: string; content: string }[],
): ExtractedInfo {
  const info: ExtractedInfo = {
    name: null,
    address: null,
    email: null,
    zipCode: null,
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

  // Extract email
  const emailMatch = userMessages.match(
    /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/,
  )
  if (emailMatch) {
    info.email = emailMatch[1].toLowerCase()
  }

  // Extract zip code (Colorado zip codes start with 80)
  const zipMatch = userMessages.match(/\b(80\d{3})\b/)
  if (zipMatch) {
    info.zipCode = zipMatch[1]
  }

  // Extract full address - look for street number + street name patterns
  const addressPatterns = [
    // "123 Main Street" or "123 Main St"
    /\b(\d{1,5}\s+[A-Za-z0-9\s]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|court|ct|circle|cir|boulevard|blvd|place|pl)\.?(?:\s*,?\s*(?:apt|apartment|unit|suite|ste|#)\.?\s*\d+[A-Za-z]?)?)/i,
    // "I live at 123 Main St" or "my address is 123 Main"
    /(?:live at|address is|i'm at|located at|we're at)\s+(\d{1,5}\s+[A-Za-z0-9\s,]+)/i,
  ]
  for (const pattern of addressPatterns) {
    const match = userMessages.match(pattern)
    if (match && match[1]) {
      info.address = match[1].trim()
      break
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

        // Try to identify which partner by looking for their name in the message
        const { data: partners } = await supabase
          .from('partners')
          .select('id, location_name, company_name, coupon_code')
          .eq('partner_type', 'location')

        let matchedPartner = null
        const lowerMessage = messageBody.toLowerCase()
        for (const partner of partners || []) {
          const partnerName = (
            partner.location_name ||
            partner.company_name ||
            ''
          ).toLowerCase()
          if (partnerName && lowerMessage.includes(partnerName)) {
            matchedPartner = partner
            break
          }
        }

        // Tag conversation as NFC source with partner info
        await supabase
          .from('conversations')
          .update({
            source: 'NFC Card',
            metadata: matchedPartner
              ? {
                  partner_id: matchedPartner.id,
                  partner_name:
                    matchedPartner.location_name || matchedPartner.company_name,
                  coupon_code: matchedPartner.coupon_code,
                }
              : null,
          })
          .eq('id', conversation.id)

        conversation.source = 'NFC Card'
        if (matchedPartner) {
          console.log(
            `✅ Matched to partner: ${matchedPartner.location_name || matchedPartner.company_name} (code: ${matchedPartner.coupon_code})`,
          )
        }
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
      // Extract partner context if available
      const metadata = (
        conversation as {
          metadata?: { partner_name?: string; coupon_code?: string }
        }
      ).metadata
      const partnerContext = metadata?.coupon_code
        ? {
            partnerName: metadata.partner_name,
            couponCode: metadata.coupon_code,
          }
        : undefined

      aiResponse = await generateAIResponse(
        messageBody,
        messages,
        partnerContext,
      )

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
      // Required: name + address + email (phone is already known from SMS)
      if (!conversation.lead_id) {
        const extractedInfo = extractCustomerInfo(messages)

        // Create lead only when we have all required info
        const hasRequiredInfo =
          extractedInfo.name && extractedInfo.address && extractedInfo.email

        if (hasRequiredInfo) {
          const leadNotes = [
            extractedInfo.serviceNeeded
              ? `Service: ${extractedInfo.serviceNeeded}`
              : null,
            extractedInfo.address ? `Address: ${extractedInfo.address}` : null,
            extractedInfo.zipCode ? `Zip: ${extractedInfo.zipCode}` : null,
            'Source: SMS conversation',
          ]
            .filter(Boolean)
            .join('\n')

          const { data: newLead, error: leadError } = await supabase
            .from('leads')
            .insert({
              phone: normalizedPhone,
              name: extractedInfo.name,
              email: extractedInfo.email,
              source: conversation.source === 'NFC Card' ? 'NFC Card' : 'SMS',
              notes: leadNotes,
              status: 'new',
              zip_code: extractedInfo.zipCode || null,
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
              `✅ Created lead from conversation: ${newLead.id} (Name: ${extractedInfo.name}, Email: ${extractedInfo.email}, Address: ${extractedInfo.address})`,
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
