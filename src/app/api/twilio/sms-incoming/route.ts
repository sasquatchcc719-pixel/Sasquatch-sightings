/**
 * Twilio Inbound SMS Webhook
 * Receives incoming SMS from customers and triggers AI dispatcher
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { Resend } from 'resend'
import {
  generateAIResponse,
  shouldEscalate,
  isAIEnabled,
} from '@/lib/openai-chat'
import {
  containsKnownBookingLink,
  getHarryControlSnapshot,
  getHarryActiveBookingUrl,
  isHarryChannelEnabled,
  isHarryFunctionEnabled,
  rewriteBookingLinks,
} from '@/lib/harry/control'
import { buildSmsSlotOffer } from '@/lib/ops/sms-booking'
import { sendCustomerSMS, sendAdminSMS } from '@/lib/twilio'

const resend = new Resend(process.env.RESEND_API_KEY)

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

  // Only use USER messages (not assistant/bot) so we never treat the bot's text as customer info
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

// Detect if message indicates they came from an NFC card
function detectNFCMention(message: string): boolean {
  const lowerMessage = message.toLowerCase()
  const nfcPhrases = [
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
    'business card',
  ]
  return nfcPhrases.some((phrase) => lowerMessage.includes(phrase))
}

// Detect contest-related messages
function detectContestMention(message: string): boolean {
  const lowerMessage = message.toLowerCase()
  const contestPhrases = [
    'sasquatch',
    'bigfoot',
    'sighting',
    'spotted',
    'contest',
    'saw one',
    'seen one',
  ]
  return contestPhrases.some((phrase) => lowerMessage.includes(phrase))
}

// Determine conversation source type from message content
type ConversationSource = 'vendor' | 'business_card' | 'contest' | 'inbound'

function sourceTypeToChannelKey(
  sourceType: ConversationSource,
): 'vendor' | 'business_card' | 'contest' | 'inbound' {
  return sourceType
}

async function determineSourceType(
  message: string,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<{
  sourceType: ConversationSource
  matchedPartner: {
    id: string
    location_name: string | null
    company_name: string | null
    coupon_code: string | null
  } | null
}> {
  const isNFC = detectNFCMention(message)
  const isContest = detectContestMention(message)

  // If NFC detected, check if it's a vendor card or personal business card
  if (isNFC) {
    const { data: partners } = await supabase
      .from('partners')
      .select('id, location_name, company_name, coupon_code')
      .eq('partner_type', 'location')

    const lowerMessage = message.toLowerCase()
    for (const partner of partners || []) {
      const partnerName = (
        partner.location_name ||
        partner.company_name ||
        ''
      ).toLowerCase()
      if (partnerName && lowerMessage.includes(partnerName)) {
        return { sourceType: 'vendor', matchedPartner: partner }
      }
    }

    // NFC detected but no partner match = personal business card
    return { sourceType: 'business_card', matchedPartner: null }
  }

  if (isContest) {
    return { sourceType: 'contest', matchedPartner: null }
  }

  return { sourceType: 'inbound', matchedPartner: null }
}

export async function POST(request: NextRequest) {
  try {
    const emptyTwiml = new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      {
        headers: { 'Content-Type': 'text/xml' },
      },
    )

    // Parse Twilio webhook data (form-encoded)
    const formData = await request.formData()
    const fromPhone = formData.get('From') as string
    const toNumber = formData.get('To') as string // number they texted (866 vs 719) – reply from this so thread stays correct
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

    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'America/Denver',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })

    function escapeHtml(s: string): string {
      return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    }

    async function sendInboundEmail(aiReply: string | null) {
      const safeBody = escapeHtml(messageBody)
      const safeReply = aiReply ? escapeHtml(aiReply) : ''
      try {
        await resend.emails.send({
          from: 'Sasquatch SMS <onboarding@resend.dev>',
          to: 'sasquatchcc719@gmail.com',
          subject: `📱 New SMS from ${normalizedPhone}`,
          html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #166534;">New Text Message Received</h2>
            <div style="background: #f0fdf4; border-radius: 8px; padding: 16px; margin: 16px 0;">
              <p style="margin: 0 0 8px 0;"><strong>📞 From:</strong> <a href="tel:${normalizedPhone}">${normalizedPhone}</a></p>
              <p style="margin: 0;"><strong>🕐 Time:</strong> ${timestamp}</p>
            </div>
            <h3 style="color: #166534;">Customer said</h3>
            <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0;">
              <p style="margin: 0; white-space: pre-wrap;">${safeBody}</p>
            </div>
            ${
              safeReply
                ? `
            <h3 style="color: #166534;">Harry replied</h3>
            <div style="background: #ecfdf5; border-radius: 8px; padding: 16px; margin: 16px 0;">
              <p style="margin: 0; white-space: pre-wrap;">${safeReply}</p>
            </div>
            `
                : `
            <p style="color: #6b7280; font-size: 14px;">AI did not respond (disabled or error). Manual response may be needed.</p>
            `
            }
            <p style="color: #6b7280; font-size: 14px;">
              View in admin: <a href="https://sightings.sasquatchcarpet.com/admin/conversations?source=inbound">Conversations</a>
            </p>
          </div>
        `,
        })
        console.log('📧 Email notification sent to sasquatchcc719@gmail.com')
      } catch (emailError) {
        console.error('❌ Failed to send email notification:', emailError)
      }
    }

    const supabase = createAdminClient()

    // First, determine the source type from this message
    const { sourceType, matchedPartner } = await determineSourceType(
      messageBody,
      supabase,
    )
    const controlSnapshot = await getHarryControlSnapshot()
    const channelKey = sourceTypeToChannelKey(sourceType)
    const isHarryGlobalEnabled = isHarryFunctionEnabled(
      controlSnapshot,
      'global_enabled',
    )
    const isInboundIntakeEnabled = isHarryFunctionEnabled(
      controlSnapshot,
      'inbound_channel_intake_enabled',
    )
    const isChannelEnabled = isHarryChannelEnabled(controlSnapshot, channelKey)
    const shouldProcessInbound =
      isHarryGlobalEnabled && isInboundIntakeEnabled && isChannelEnabled
    const canSendAutoReply = isHarryFunctionEnabled(
      controlSnapshot,
      'auto_reply_enabled',
    )
    const canSendBookingOffers = isHarryFunctionEnabled(
      controlSnapshot,
      'booking_offers_enabled',
    )
    const activeBookingUrl = getHarryActiveBookingUrl(controlSnapshot)
    const canCreateLeads = isHarryFunctionEnabled(
      controlSnapshot,
      'auto_create_leads_enabled',
    )
    const canSendEscalationAlerts = isHarryFunctionEnabled(
      controlSnapshot,
      'escalation_alerts_enabled',
    )
    const canSendInboundEmails = isHarryFunctionEnabled(
      controlSnapshot,
      'inbound_email_notifications_enabled',
    )

    console.log(`📋 Detected source type: ${sourceType}`)
    if (matchedPartner) {
      console.log(
        `🏪 Matched vendor: ${matchedPartner.location_name || matchedPartner.company_name}`,
      )
    }

    // Map source type to database source value
    const sourceMap: Record<ConversationSource, string> = {
      vendor: 'NFC Card',
      business_card: 'Business Card',
      contest: 'Contest',
      inbound: 'inbound',
    }
    const dbSource = sourceMap[sourceType]

    if (!shouldProcessInbound) {
      console.log(
        `[Harry Control] Inbound processing disabled (source: ${sourceType}, global: ${isHarryGlobalEnabled}, intake: ${isInboundIntakeEnabled}, channel: ${isChannelEnabled})`,
      )
      return emptyTwiml
    }

    const maybeSendInboundEmail = async (aiReply: string | null) => {
      if (!canSendInboundEmails) return
      await sendInboundEmail(aiReply)
    }

    // Find existing conversation with SAME phone AND SAME source type
    let { data: conversation, error: fetchError } = await supabase
      .from('conversations')
      .select('*')
      .eq('phone_number', normalizedPhone)
      .eq('source', dbSource)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()

    if (conversation) {
      console.log(
        `✅ Found existing ${dbSource} conversation: ${conversation.id} with ${conversation.messages.length} messages`,
      )
      // Reactivate if needed
      if (conversation.status !== 'active') {
        await supabase
          .from('conversations')
          .update({ status: 'active' })
          .eq('id', conversation.id)
        conversation.status = 'active'
        console.log(`🔄 Reactivated conversation: ${conversation.id}`)
      }
    } else {
      console.log(
        `⚠️ No existing ${dbSource} conversation found for ${normalizedPhone}`,
      )

      // Create new conversation for this source type
      const { data: newConvo, error: createError } = await supabase
        .from('conversations')
        .insert({
          phone_number: normalizedPhone,
          source: dbSource,
          lead_id: null,
          messages: [],
          ai_enabled: true,
          status: 'active',
          metadata:
            sourceType === 'vendor' && matchedPartner
              ? {
                  partner_id: matchedPartner.id,
                  partner_name:
                    matchedPartner.location_name || matchedPartner.company_name,
                  coupon_code: matchedPartner.coupon_code,
                }
              : null,
        })
        .select()
        .single()

      if (createError) {
        console.error('Failed to create conversation:', createError)
        return NextResponse.json({ error: 'Database error' }, { status: 500 })
      }

      conversation = newConvo
      console.log(`✨ Created new ${dbSource} conversation: ${conversation.id}`)

      if (matchedPartner) {
        console.log(
          `✅ Tagged with vendor: ${matchedPartner.location_name || matchedPartner.company_name} (code: ${matchedPartner.coupon_code})`,
        )
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
    const aiShouldRespond =
      conversation.ai_enabled && isAIEnabled() && canSendAutoReply

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
      if (canSendEscalationAlerts) {
        await sendAdminSMS(
          `💬 Inbound SMS from ${normalizedPhone}:\n"${messageBody}"\n\n(AI is disabled - manual response needed)`,
          'ai_dispatcher_inbound',
        )
      }

      await maybeSendInboundEmail(null)

      return emptyTwiml
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
        channelKey,
        activeBookingUrl,
      )

      if (!aiResponse) {
        // AI returned empty (shouldn't happen, but handle gracefully)
        console.log('⚠️  AI returned empty response')
        await supabase
          .from('conversations')
          .update({ messages })
          .eq('id', conversation.id)
        await maybeSendInboundEmail(null)
        return emptyTwiml
      }

      // HARD GATE: Never send the booking link without first+last name, email, and full address (street + zip).
      // Extraction uses only USER messages (not the bot's), so "name given early" is from their own texts.
      const extractedInfo = extractCustomerInfo(messages)
      const hasFullName =
        extractedInfo.name && extractedInfo.name.trim().split(/\s+/).length >= 2
      const hasFullAddress = extractedInfo.address && extractedInfo.zipCode
      const hasRequiredInfo =
        hasFullName && hasFullAddress && extractedInfo.email
      if (containsKnownBookingLink(aiResponse) && !canSendBookingOffers) {
        aiResponse =
          'I can still help with your quote here. Our team will follow up directly to handle booking options.'
      }
      if (
        containsKnownBookingLink(aiResponse) &&
        !hasRequiredInfo &&
        canSendBookingOffers
      ) {
        const missing: string[] = []
        if (!hasFullName)
          missing.push(extractedInfo.name ? 'last name' : 'first and last name')
        if (!extractedInfo.email) missing.push('email')
        if (!hasFullAddress)
          missing.push(
            extractedInfo.address
              ? 'city and zip'
              : 'full address including city and zip',
          )
        // Ask only for what's missing so we don't repeat "give me everything" when we already have most of it
        if (!hasFullName && !extractedInfo.name) {
          aiResponse =
            "To get you on the calendar I need your first and last name, email, and full address (street, city, and zip). What's your full name?"
        } else if (!hasFullName && extractedInfo.name) {
          aiResponse = "What's your last name?"
        } else if (!extractedInfo.email) {
          aiResponse = "What's your email so we can send confirmation?"
        } else if (!extractedInfo.address) {
          aiResponse = "What's your full address (street, city, and zip)?"
        } else if (!extractedInfo.zipCode) {
          aiResponse = "What's your zip code?"
        } else {
          aiResponse =
            "To get you on the calendar I need your first and last name, email, and full address (street, city, and zip). What's your full name?"
        }
        console.log(
          `[SMS] Booking link blocked: missing ${missing.join(', ')}. Extracted: name=${extractedInfo.name ?? 'null'}, email=${extractedInfo.email ? '***' : 'null'}, address=${extractedInfo.address ?? 'null'}, zip=${extractedInfo.zipCode ?? 'null'}. Sent info request instead.`,
        )
      }

      if (
        containsKnownBookingLink(aiResponse) &&
        hasRequiredInfo &&
        canSendBookingOffers
      ) {
        const slotOffer = await buildSmsSlotOffer({
          supabase,
          serviceNeeded: extractedInfo.serviceNeeded,
        })

        if (slotOffer) {
          aiResponse = slotOffer
        }
      }

      if (canSendBookingOffers && containsKnownBookingLink(aiResponse)) {
        aiResponse = rewriteBookingLinks(aiResponse, activeBookingUrl)
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
      // Required: first+last name, full address (street + zip), email (same as booking-link gate)
      if (!conversation.lead_id && canCreateLeads) {
        const hasFullNameForLead =
          extractedInfo.name &&
          extractedInfo.name.trim().split(/\s+/).length >= 2
        const hasFullAddressForLead =
          extractedInfo.address && extractedInfo.zipCode
        const hasRequiredInfoForLead =
          hasFullNameForLead && hasFullAddressForLead && extractedInfo.email

        if (hasRequiredInfoForLead) {
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
              source: conversation.source, // Use the conversation's source directly
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

      // Send AI response from the same number they texted (866 vs 719) so reply appears in the right thread
      await sendCustomerSMS(
        normalizedPhone,
        aiResponse,
        conversation.lead_id || undefined,
        'ai_dispatcher',
        toNumber || undefined,
      )

      await maybeSendInboundEmail(aiResponse)

      // Notify admin if escalated
      if (needsEscalation && canSendEscalationAlerts) {
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
      if (canSendEscalationAlerts) {
        await sendAdminSMS(
          `⚠️ AI Dispatcher Error!\nPhone: ${normalizedPhone}\nMessage: "${messageBody}"\n\nError: ${aiError}\n\nPlease respond manually.`,
          'ai_dispatcher_error',
        )
      }

      await maybeSendInboundEmail(null)
    }

    // Return empty TwiML (we already sent response via sendCustomerSMS)
    return emptyTwiml
  } catch (error) {
    console.error('Inbound SMS webhook error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
