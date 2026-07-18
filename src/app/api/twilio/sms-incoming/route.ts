/**
 * Twilio Inbound SMS Webhook
 *
 * No LLM. Logs the inbound text, forwards every message into the Telegram
 * relay (one topic per customer), routes Ranger hiring replies to Ranger, and
 * keeps LSA source/name tracking. Charles answers from the relay; nothing here
 * auto-replies to a customer.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { sendOneSignalNotification } from '@/lib/onesignal'
import twilio from 'twilio'
import { isBlacklisted, notifyBlockedAttempt } from '@/lib/blacklist'
import { logChatMessage } from '@/lib/ai/logging'
import { opsPhoneLookupVariants } from '@/lib/ops/phone'
import { sendLSALeadNotification } from '@/lib/telegram'
import { forwardInboundToRelay } from '@/lib/telegram/relay'
import {
  inboundMessageContent,
  parseTwilioInboundMedia,
  persistInboundMedia,
} from '@/lib/twilio/inbound-media'
import { notifyActiveJobTechOfInboundSms } from '@/lib/twilio/active-job-tech-alert'
import {
  buildApplicantReplyTelegramMessage,
  sendRangerTelegramMessage,
} from '@/lib/ranger/telegram'

export const maxDuration = 60

// Normalize phone number to E.164 format
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return digits.startsWith('+') ? phone : `+${digits}`
}

function mountainDateIso(): string {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Denver',
  })
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

// Google LSA sends distinctive boilerplate in SMS. Any of these patterns
// appearing in a message is a definitive signal that the phone number is
// an LSA relay, even if no other signal is present.
//   1. Lead-prefix: "You have received a new message from a customer via
//      Google Local Services Ads. Customer Name: ..."
//   2. Reply disclaimer: "Replies to this number will be sent to the
//      customer. You can also choose to call the customer through this
//      number (or respond via LSA dashboard: https://g.co/homeservices/...)"
// Both are sent verbatim by Google, so exact/anchored matching is safe.
const LSA_DISCLAIMER_PREFIX_RE =
  /^\s*Replies to this number will be sent to the customer\b/i
const LSA_LEAD_PREFIX_RE =
  /^\s*You have received a new message from a customer via Google Local Services Ads\b/i
const LSA_NOTES_RE = /\[Notes from LSA:/i
const LSA_HOMESERVICES_URL_RE = /g\.co\/homeservices\b/i

function isLsaDisclaimerText(text: string | null | undefined): boolean {
  if (!text) return false
  return LSA_DISCLAIMER_PREFIX_RE.test(text)
}

function isLsaSignalText(text: string | null | undefined): boolean {
  if (!text) return false
  return (
    LSA_DISCLAIMER_PREFIX_RE.test(text) ||
    LSA_LEAD_PREFIX_RE.test(text) ||
    LSA_NOTES_RE.test(text) ||
    LSA_HOMESERVICES_URL_RE.test(text)
  )
}

/**
 * Extract customer name from LSA message prefix.
 * Format: "You have received a new message from a customer via Google Local Services Ads. Customer Name: John Smith, Location: ..."
 * Returns the name if found, null otherwise.
 */
function extractLsaCustomerName(
  text: string | null | undefined,
): string | null {
  if (!text) return null

  // Match "Customer Name: [name]" - capture everything until comma or newline
  const nameMatch = text.match(/Customer Name:\s*([^,\n]+)/i)
  if (nameMatch && nameMatch[1]) {
    const name = nameMatch[1].trim()
    // Return null if name is empty or just whitespace
    return name.length > 0 ? name : null
  }

  return null
}

// Determine conversation source type from message content
type ConversationSource =
  | 'vendor'
  | 'business_card'
  | 'contest'
  | 'inbound'
  | 'lsa'

function sourceTypeToChannelKey(
  sourceType: ConversationSource,
): 'vendor' | 'business_card' | 'contest' | 'inbound' | 'lsa' {
  return sourceType
}

type ConversationMessageRecord = {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: string
  twilio_sid?: string
  sent_by?: string
}

function isAcknowledgmentOnlyMessage(text: string): boolean {
  const lower = text.toLowerCase().trim()
  if (!lower || lower.includes('?')) return false

  const actionSignals = [
    'reschedule',
    'cancel',
    'change',
    'move',
    'different time',
    'later',
    'earlier',
    'running late',
    'access',
    'gate',
    'code',
    'parking',
    'price',
    'cost',
    'invoice',
    'payment',
    'call me',
    'can you',
    'could you',
    'please',
  ]
  if (actionSignals.some((s) => lower.includes(s))) return false

  const ackPhrases = [
    'thanks',
    'thank you',
    'perfect',
    'sounds good',
    'looks good',
    'great',
    'awesome',
    'ok',
    'okay',
    'appreciate it',
    'see you then',
    'got it',
    'confirmed',
  ]
  return ackPhrases.some(
    (phrase) => lower === phrase || lower.startsWith(`${phrase} `),
  )
}

function isSmsReactionOnlyMessage(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  if (/^[❤️❤👍👎🔥😂🤣😍🥰👏🙌💯✅☑️✔️⭐️✨\s]+$/u.test(trimmed)) {
    return true
  }

  const reactionVerbs = [
    'Liked',
    'Loved',
    'Disliked',
    'Laughed at',
    'Emphasized',
    'Questioned',
  ]
  const quoteChars = String.raw`["“”'‘’]`
  const quotedReaction = new RegExp(
    `^(?:${reactionVerbs.join('|')})\\s+${quoteChars}[\\s\\S]+${quoteChars}\\.?$`,
    'i',
  )
  if (quotedReaction.test(trimmed)) return true

  const attachmentReaction = new RegExp(
    `^(?:${reactionVerbs.join('|')})\\s+(?:an?|the)\\s+(?:image|photo|picture|video|attachment)\\.?$`,
    'i',
  )
  return attachmentReaction.test(trimmed)
}

async function syncRecentOutboundContext(params: {
  messages: ConversationMessageRecord[]
  customerPhone: string
  businessNumber: string | null
}): Promise<ConversationMessageRecord[]> {
  const { messages, customerPhone, businessNumber } = params
  if (!businessNumber) return messages
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return messages
  }

  try {
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN,
    )

    // Pull recent outbound messages from the same business number to this customer.
    // This captures manual app sends (Talky, etc.) so Harry gets full context.
    const outboundMessages = await twilioClient.messages.list({
      from: businessNumber,
      to: customerPhone,
      limit: 20,
    })

    if (!outboundMessages.length) return messages

    const existingTwilioSids = new Set(
      messages
        .map((m) => String(m?.twilio_sid || '').trim())
        .filter((sid) => sid.length > 0),
    )

    const additions = outboundMessages
      .filter((m) => {
        if (!m.sid || existingTwilioSids.has(m.sid)) return false
        // Keep only sent outbound traffic.
        return m.direction?.startsWith('outbound') ?? false
      })
      .map((m) => ({
        role: 'assistant' as const,
        content: String(m.body || ''),
        timestamp:
          (m.dateSent || m.dateCreated || new Date()).toISOString?.() ||
          new Date().toISOString(),
        twilio_sid: m.sid,
        sent_by: 'admin_external',
      }))
      .filter((m) => m.content.length > 0)

    if (!additions.length) return messages

    additions.sort((a, b) => {
      const t1 = Date.parse(String(a.timestamp || ''))
      const t2 = Date.parse(String(b.timestamp || ''))
      return t1 - t2
    })

    return [...messages, ...additions]
  } catch (error) {
    console.error('[SMS] Failed to sync outbound context:', error)
    return messages
  }
}

async function determineSourceType(
  message: string,
  supabase: ReturnType<typeof createAdminClient>,
  phoneNumber?: string,
): Promise<{
  sourceType: ConversationSource
  matchedPartner: {
    id: string
    location_name: string | null
    company_name: string | null
    coupon_code: string | null
  } | null
}> {
  // LSA detection: strongest signal first.
  // 1. The current message carries an LSA signal (lead-prefix, reply
  //    disclaimer, "[Notes from LSA:" tag, or g.co/homeservices URL).
  if (isLsaSignalText(message)) {
    return { sourceType: 'lsa', matchedPartner: null }
  }

  // 2. We've seen an LSA conversation from this phone before, OR any prior
  //    message from this phone carried an LSA signal. Google routes every
  //    LSA lead through a relay number, so once a phone is known to be LSA
  //    it stays LSA.
  if (phoneNumber) {
    const { data: priorConvos } = await supabase
      .from('conversations')
      .select('source, messages')
      .eq('phone_number', phoneNumber)
      .order('updated_at', { ascending: false })
      .limit(5)

    for (const c of priorConvos || []) {
      if (c.source === 'Google LSA' || c.source === 'lsa') {
        return { sourceType: 'lsa', matchedPartner: null }
      }
      const msgs = Array.isArray(c.messages) ? c.messages : []
      for (const m of msgs) {
        if (isLsaSignalText((m as { content?: string })?.content)) {
          return { sourceType: 'lsa', matchedPartner: null }
        }
      }
    }
  }

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
    const fromPhone = String(formData.get('From') || '').trim()
    const toNumber = String(formData.get('To') || '').trim() // number they texted (866 vs 719) – reply from this so thread stays correct
    const rawMessageBody = String(formData.get('Body') || '').trim()
    const inboundMedia = parseTwilioInboundMedia(formData)
    const messageBody = inboundMessageContent(rawMessageBody, inboundMedia)
    const twilioSid = String(formData.get('MessageSid') || '').trim()

    if (!fromPhone || !twilioSid || !messageBody) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 },
      )
    }

    const normalizedPhone = normalizePhone(fromPhone)

    if (await isBlacklisted(normalizedPhone)) {
      notifyBlockedAttempt(fromPhone, 'SMS')
      return emptyTwiml
    }

    console.log(
      `📱 Inbound SMS from ${fromPhone} → normalized to: ${normalizedPhone}`,
    )
    console.log(`📱 Message: "${messageBody}"`)

    const supabase = createAdminClient()

    // ── Nextdoor notification intercept ──────────────────────────────────────
    // Nextdoor texts us when someone messages us on their platform.
    // We want to log it and get a push notification; nothing auto-replies.
    const nextdoorLinkMatch = messageBody.match(
      /nextdoor\.com\/inbox\/chat\/([^\s?]+)/,
    )
    if (
      nextdoorLinkMatch ||
      messageBody.toLowerCase().includes('nextdoor.com')
    ) {
      console.log('📍 Nextdoor notification intercepted')

      // Store in DB
      await supabase.from('nextdoor_notifications').insert({
        raw_message: messageBody,
        chat_url: nextdoorLinkMatch
          ? `https://nextdoor.com/inbox/chat/${nextdoorLinkMatch[1]}`
          : null,
        received_at: new Date().toISOString(),
      })

      // Fire push notification to admin
      await sendOneSignalNotification({
        heading: '📍 New Nextdoor Message',
        content: 'Someone messaged you on Nextdoor. Tap to open.',
        data: {
          type: 'nextdoor_notification',
          chat_url: nextdoorLinkMatch
            ? `https://nextdoor.com/inbox/chat/${nextdoorLinkMatch[1]}`
            : 'https://nextdoor.com/messaging/',
        },
      })

      return emptyTwiml
    }
    // ─────────────────────────────────────────────────────────────────────────

    const { sourceType, matchedPartner } = await determineSourceType(
      rawMessageBody,
      supabase,
      normalizedPhone,
    )

    const channelKey = sourceTypeToChannelKey(sourceType)

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
      lsa: 'Google LSA',
    }
    const dbSource = sourceMap[sourceType]

    // LSA customer name tracking for relay number detection
    let lsaCustomerName: string | null = null

    // If this phone is an LSA relay, promote any prior 'inbound' conversations
    // to 'Google LSA'. Google sends the customer's real message first and the
    // disclaimer second, so the first message typically lands in a brand-new
    // 'inbound' conversation before we know it's LSA. Once we know, migrate it.
    if (sourceType === 'lsa') {
      lsaCustomerName = extractLsaCustomerName(messageBody)
      console.log(
        `[LSA] Customer name in message: ${lsaCustomerName || '(not found)'}`,
      )

      const { data: strandedInbound } = await supabase
        .from('conversations')
        .select('id')
        .eq('phone_number', normalizedPhone)
        .eq('source', 'inbound')

      if (strandedInbound && strandedInbound.length > 0) {
        console.log(
          `[LSA] Promoting ${strandedInbound.length} prior inbound conversation(s) from ${normalizedPhone} to Google LSA`,
        )
        await supabase
          .from('conversations')
          .update({ source: 'Google LSA' })
          .in(
            'id',
            strandedInbound.map((c) => c.id),
          )
      }
    }

    // Link a known scheduled ops customer to the conversation (no AI).
    const opsPhoneVariants = opsPhoneLookupVariants(normalizedPhone)
    const { data: opsCustomerMatch } = await supabase
      .from('ops_customers')
      .select('id')
      .in('phone', opsPhoneVariants)
      .maybeSingle()
    const isOpsCustomer = !!opsCustomerMatch

    if (opsCustomerMatch?.id) {
      // Reconcile retained MMS from before this phone was known as a customer.
      await supabase
        .from('ops_customer_media')
        .update({ customer_id: opsCustomerMatch.id })
        .eq('sender_phone', normalizedPhone)
        .is('customer_id', null)
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
        `✅ Found existing ${dbSource} conversation: ${conversation.id}`,
      )
      if (conversation.status !== 'active') {
        await supabase
          .from('conversations')
          .update({ status: 'active' })
          .eq('id', conversation.id)
        conversation.status = 'active'
      }
      if (isOpsCustomer && !conversation.ops_customer_id) {
        await supabase
          .from('conversations')
          .update({ ops_customer_id: opsCustomerMatch!.id })
          .eq('id', conversation.id)
        conversation.ops_customer_id = opsCustomerMatch!.id
      }

      if (sourceType === 'lsa' && lsaCustomerName) {
        const currentMetadata =
          (conversation.metadata as Record<string, unknown>) || {}
        if (currentMetadata.lsa_customer_name !== lsaCustomerName) {
          await supabase
            .from('conversations')
            .update({
              metadata: {
                ...currentMetadata,
                lsa_customer_name: lsaCustomerName,
              },
            })
            .eq('id', conversation.id)
          conversation.metadata = {
            ...currentMetadata,
            lsa_customer_name: lsaCustomerName,
          }
        }
      }
    } else {
      console.log(
        `⚠️ No existing ${dbSource} conversation found for ${normalizedPhone}`,
      )

      // Create new conversation for this source type
      let conversationMetadata: Record<string, unknown> | null = null

      if (sourceType === 'vendor' && matchedPartner) {
        conversationMetadata = {
          partner_id: matchedPartner.id,
          partner_name:
            matchedPartner.location_name || matchedPartner.company_name,
          coupon_code: matchedPartner.coupon_code,
        }
      } else if (sourceType === 'lsa' && lsaCustomerName) {
        conversationMetadata = {
          lsa_customer_name: lsaCustomerName,
        }
      }

      const { data: newConvo, error: createError } = await supabase
        .from('conversations')
        .insert({
          phone_number: normalizedPhone,
          source: dbSource,
          lead_id: null,
          messages: [],
          ai_enabled: true,
          ops_customer_id: isOpsCustomer ? opsCustomerMatch!.id : null,
          status: 'active',
          metadata: conversationMetadata,
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

      // Inbound conversation alerts are sent after dedupe below so retries do not double-notify.
    }

    // Start from current history.
    let messages = ((conversation.messages as any[]) ||
      []) as ConversationMessageRecord[]

    // Pull recent manual outbound (Talky, etc.) so the stored thread + relay
    // contact history stay complete.
    const inferredBusinessNumber = toNumber
      ? normalizePhone(toNumber)
      : process.env.TWILIO_PHONE_NUMBER || null
    messages = await syncRecentOutboundContext({
      messages,
      customerPhone: normalizedPhone,
      businessNumber: inferredBusinessNumber,
    })

    const linkedCustomerId =
      (conversation.ops_customer_id as string | null) ||
      opsCustomerMatch?.id ||
      null
    let storedMedia: Awaited<ReturnType<typeof persistInboundMedia>> = []
    if (inboundMedia.length > 0) {
      try {
        storedMedia = await persistInboundMedia({
          supabase,
          conversationId: conversation.id,
          customerId: linkedCustomerId,
          senderPhone: normalizedPhone,
          businessNumber: toNumber || null,
          twilioMessageSid: twilioSid,
          media: inboundMedia,
        })
      } catch (mediaError) {
        // Never reject the Twilio webhook after Twilio has delivered the MMS.
        // The source media remains recoverable in Twilio when ingestion fails.
        console.error('[MMS] Failed to persist inbound media:', mediaError)
      }
    }

    // Deduplicate: Check if we've already processed this Twilio message
    const alreadyProcessed = messages.some(
      (m) => m.twilio_sid && m.twilio_sid === twilioSid,
    )
    if (alreadyProcessed) {
      console.log(
        `⚠️  Duplicate message detected (SID: ${twilioSid}) - skipping processing`,
      )
      return emptyTwiml
    }

    // ── Telegram relay ───────────────────────────────────────────────────────
    // Forward every inbound message into the customer's Telegram topic. Stored
    // MMS media is sent as native Telegram media with classification buttons.
    await forwardInboundToRelay({
      supabase,
      phone: normalizedPhone,
      message: messageBody,
      businessNumber: toNumber || null,
      isLsa: sourceType === 'lsa',
      today: mountainDateIso(),
      media: storedMedia,
    })
    // ─────────────────────────────────────────────────────────────────────────

    // LSA disclaimer filter: Google Local Services Ads sends every inbound as
    // TWO SMS — the customer's actual message, then a "Replies to this number
    // will be sent to the customer..." boilerplate. We log the boilerplate for
    // context but don't forward/notify on it as a real message.
    const isLsaDisclaimer = isLsaDisclaimerText(messageBody)
    const isSmsReaction = isSmsReactionOnlyMessage(messageBody)

    // If this reply is from a customer whose job a tech is actively on the way
    // to, ping the shared team Telegram so the assigned tech sees it directly
    // (e.g. building-access directions) instead of waiting on a manual relay.
    if (linkedCustomerId && !isLsaDisclaimer && !isSmsReaction) {
      await notifyActiveJobTechOfInboundSms({
        supabase,
        customerId: linkedCustomerId,
        messageBody,
        mediaCount: storedMedia.filter((item) => item.status === 'available')
          .length,
      })
    }

    // Add customer message to conversation history
    messages.push({
      role: 'user',
      content: messageBody,
      timestamp: new Date().toISOString(),
      twilio_sid: twilioSid,
    })

    // Unified observability: mirror inbound SMS to ai_chat_logs.
    await logChatMessage({
      agent: 'inbound_sms',
      channel: 'sms',
      sessionId: conversation.id,
      fromIdentity: normalizedPhone,
      role: 'user',
      content: messageBody,
      metadata: {
        twilio_sid: twilioSid,
        to_number: toNumber || null,
        channel_key: channelKey,
        media_count: inboundMedia.length,
        stored_media_count: storedMedia.filter(
          (item) => item.status === 'available',
        ).length,
        is_lsa_disclaimer: isLsaDisclaimer,
        is_sms_reaction: isSmsReaction,
      },
    })

    if (isLsaDisclaimer) {
      console.log(
        `[SMS] LSA disclaimer detected — saving to history but skipping AI response`,
      )
      await supabase
        .from('conversations')
        .update({ messages, updated_at: new Date().toISOString() })
        .eq('id', conversation.id)
      return emptyTwiml
    }

    if (isSmsReaction) {
      console.log('[SMS] Reaction-only inbound detected, no reply sent')
      await supabase
        .from('conversations')
        .update({ messages, updated_at: new Date().toISOString() })
        .eq('id', conversation.id)
      return emptyTwiml
    }

    if (sourceType === 'lsa') {
      void sendLSALeadNotification({
        customerName: lsaCustomerName || undefined,
        phone: normalizedPhone,
        message: messageBody,
      })
    }

    // Persist the user message immediately so Twilio webhook retries see the
    // twilio_sid and hit the dedup check above.
    await supabase
      .from('conversations')
      .update({ messages, updated_at: new Date().toISOString() })
      .eq('id', conversation.id)

    const conversationMetadata =
      (conversation.metadata as Record<string, unknown> | null) || {}
    const rangerApplicantId =
      typeof conversationMetadata.ranger_applicant_id === 'string'
        ? conversationMetadata.ranger_applicant_id
        : null

    if (conversationMetadata.ranger_hiring && rangerApplicantId) {
      const { data: rangerApplicant } = await supabase
        .from('ranger_applicants')
        .select('*')
        .eq('id', rangerApplicantId)
        .maybeSingle()

      if (rangerApplicant) {
        await supabase.from('ranger_messages').insert({
          applicant_id: rangerApplicantId,
          channel: 'sms',
          direction: 'inbound',
          subject: null,
          body: messageBody,
          external_message_id: twilioSid,
          status: 'logged',
          metadata: {
            from: normalizedPhone,
            to: toNumber || null,
            conversationId: conversation.id,
            handledBy: 'sms_webhook',
          },
        })

        await supabase.from('ranger_tasks').insert({
          applicant_id: rangerApplicantId,
          task_type: 'parse_gmail_reply',
          status: 'pending',
          priority: 'high',
          payload: {
            channel: 'sms',
            messageId: twilioSid,
            body: messageBody,
          },
        })

        await supabase.from('ranger_audit_events').insert({
          applicant_id: rangerApplicantId,
          actor: 'sms-webhook',
          event_type: 'sms_reply_queued',
          event_summary:
            'Received a Ranger hiring SMS reply and queued it for Ranger.',
          payload: { twilioSid, conversationId: conversation.id },
        })

        await sendRangerTelegramMessage({
          text: buildApplicantReplyTelegramMessage({
            applicant: rangerApplicant,
            subject: 'SMS reply',
            body: messageBody,
          }),
        })
      }

      console.log(
        `[Ranger SMS] Routed applicant reply ${twilioSid} to Ranger applicant ${rangerApplicantId}.`,
      )
      return emptyTwiml
    }

    if (isAcknowledgmentOnlyMessage(messageBody)) {
      console.log('[SMS] Acknowledgment-only inbound detected, no reply sent')
      return emptyTwiml
    }

    // No auto-reply — Charles answers from the Telegram relay.
    return emptyTwiml
  } catch (error) {
    console.error('Inbound SMS webhook error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
