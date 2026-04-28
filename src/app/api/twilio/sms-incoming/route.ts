/**
 * Twilio Inbound SMS Webhook
 * Receives incoming SMS from customers and triggers AI dispatcher
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { Resend } from 'resend'
import { sendOneSignalNotification } from '@/lib/onesignal'
import twilio from 'twilio'
import {
  generateAIResponse,
  shouldEscalate,
  isAIEnabled,
} from '@/lib/openai-chat'
import {
  getHarryControlSnapshot,
  isHarryChannelEnabled,
  isHarryFunctionEnabled,
} from '@/lib/harry/control'
import { sendCustomerSMS, sendAdminSMS } from '@/lib/twilio'
import { logChatMessage } from '@/lib/ai/logging'
import { opsPhoneLookupVariants } from '@/lib/ops/phone'
import { sendCancellationAlert, sendLSALeadNotification } from '@/lib/telegram'
import { notifyNewCustomerMessage } from '@/lib/harry-command-bot'

const resend = new Resend(process.env.RESEND_API_KEY)

// Normalize phone number to E.164 format
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return digits.startsWith('+') ? phone : `+${digits}`
}

function firstNameFromCustomer(
  customer: { first_name?: string | null; full_name?: string | null } | null,
): string | null {
  const explicitFirst = customer?.first_name?.trim()
  if (explicitFirst) return explicitFirst

  const fullNameFirst = customer?.full_name?.trim().split(/\s+/)[0]
  return fullNameFirst || null
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
  const userLines = messages
    .filter((m) => m.role === 'user')
    .flatMap((m) =>
      String(m.content || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    )

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

  // Fallback: detect name in standalone lines like:
  // "Anne Farrell"
  if (!info.name) {
    const disallowedNameLineTokens = new Set([
      'street',
      'st',
      'avenue',
      'ave',
      'road',
      'rd',
      'drive',
      'dr',
      'lane',
      'ln',
      'way',
      'court',
      'ct',
      'circle',
      'cir',
      'boulevard',
      'blvd',
      'place',
      'pl',
      'room',
      'rooms',
      'steps',
      'step',
      'sq',
      'sqft',
      'square',
      'email',
      'thanks',
      'cleaning',
      'info',
      'service',
      'city',
      'zip',
    ])
    const fullNameLine = userLines.find((line) => {
      if (/@/.test(line) || /\d/.test(line)) return false
      if (line.length < 4 || line.length > 40) return false
      const words = line
        .split(/\s+/)
        .map((w) => w.replace(/[^A-Za-z'-]/g, ''))
        .filter(Boolean)
      if (words.length < 2 || words.length > 3) return false
      if (!words.every((w) => /^[A-Z][a-zA-Z'-]+$/.test(w))) return false
      if (words.some((w) => disallowedNameLineTokens.has(w.toLowerCase()))) {
        return false
      }
      return true
    })
    if (fullNameLine) {
      info.name = fullNameLine
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

function detectCancelIntent(text: string): boolean {
  const cancelPhrases = [
    'cancel my appointment',
    'cancel my job',
    'cancel my booking',
    'cancel the appointment',
    'cancel the job',
    'cancel the booking',
    'cancel the cleaning',
    'cancel my cleaning',
    'need to cancel',
    'want to cancel',
    'like to cancel',
    "i'm canceling",
    "i'm cancelling",
    'i am canceling',
    'i am cancelling',
    'please cancel',
    'go ahead and cancel',
    "don't come",
    'do not come',
    "don't need you",
    'do not need you',
    'no longer need',
    'not going to need',
  ]
  const lower = text.toLowerCase()
  return cancelPhrases.some((p) => lower.includes(p))
}

function detectBillingOrPriceIntent(text: string): boolean {
  const billingPhrases = [
    'price',
    'pricing',
    'cost',
    'charge',
    'charged',
    'invoice',
    'billing',
    'bill',
    'payment',
    'paid',
    'refund',
    'overcharged',
    'dispute',
  ]
  const lower = text.toLowerCase()
  return billingPhrases.some((p) => lower.includes(p))
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

function shouldHoldForHuman(params: {
  latestUserMessage: string
  messages: ConversationMessageRecord[]
}): { hold: boolean; reason: string } {
  const text = params.latestUserMessage.toLowerCase()

  if (detectCancelIntent(text)) {
    return { hold: true, reason: 'cancel_request' }
  }

  if (detectBillingOrPriceIntent(text)) {
    return { hold: true, reason: 'billing_or_price_dispute' }
  }

  const hasRecentManualOutbound = params.messages.some((m) => {
    if (m.role !== 'assistant' || m.sent_by !== 'admin_external') return false
    const ts = Date.parse(String(m.timestamp || ''))
    if (!Number.isFinite(ts)) return false
    return Date.now() - ts < 24 * 60 * 60 * 1000
  })

  // Hiring/subcontractor context: don't let Harry sell carpet cleaning here.
  const hiringKeywords = [
    'subcontractor',
    'cleaning lady',
    'commercial',
    'liability insurance',
    '1099',
    'w9',
    'independent contractor',
    'accounts we are targeting',
    'offices',
    'janitorial',
    'nightly cleaning',
  ]
  if (hiringKeywords.some((k) => text.includes(k))) {
    return { hold: true, reason: 'hiring_or_subcontractor_context' }
  }

  // Context-dependent replies (yes/no/that works/etc.) right after a manual outbound
  // usually mean this is an active human-managed thread.
  const contextReplySignals = [
    "that's not a problem",
    'sounds good',
    'yes for',
    "i don't but",
    "i've planned",
    'that works',
    'absolutely',
    'no problem at all',
  ]
  if (
    hasRecentManualOutbound &&
    contextReplySignals.some((k) => text.includes(k))
  ) {
    return { hold: true, reason: 'manual_thread_in_progress' }
  }

  const serviceIntentKeywords = [
    'carpet',
    'upholstery',
    'tile',
    'grout',
    'rug',
    'stairs',
    'pet treatment',
    'quote',
    'estimate',
    'book',
    'booking',
    'schedule',
    'cleaning',
    'bedroom',
    'living room',
    'basement',
    'sofa',
    'sectional',
    'loveseat',
  ]
  const mentionsServiceIntent = serviceIntentKeywords.some((k) =>
    text.includes(k),
  )

  const businessOpsKeywords = [
    'insurance policy',
    'liability policy',
    'premium',
    'year',
    'annual',
    '$500',
    '$1000',
    'payroll',
    'commission',
    'hourly',
    '1099',
    'w9',
    'ein',
    'vendor packet',
    'subcontract',
    'subcontractor',
    'background check',
    'drug test',
    'application',
    'interview',
    'hiring',
  ]
  const appearsBusinessOps = businessOpsKeywords.some((k) => text.includes(k))

  // If the text looks like business/recruiting chatter (not a cleaning inquiry),
  // hold for human instead of sending a generic service reply.
  if (appearsBusinessOps && !mentionsServiceIntent) {
    return { hold: true, reason: 'off_topic_business_context' }
  }

  return { hold: false, reason: '' }
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

async function isRecentDayBeforeReminderThread(params: {
  supabase: ReturnType<typeof createAdminClient>
  phoneVariants: string[]
}): Promise<boolean> {
  if (params.phoneVariants.length === 0) return false
  const seventyTwoHoursAgoIso = new Date(
    Date.now() - 72 * 60 * 60 * 1000,
  ).toISOString()

  const { data } = await params.supabase
    .from('sms_logs')
    .select('id')
    .in('recipient_phone', params.phoneVariants)
    .in('message_type', [
      'ops_day_before_residential_sms',
      'ops_day_before_recovery_village_sms',
    ])
    .eq('status', 'sent')
    .gte('sent_at', seventyTwoHoursAgoIso)
    .limit(1)

  return !!(data && data.length > 0)
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
    // ── Nextdoor notification intercept ──────────────────────────────────────
    // Nextdoor texts us when someone messages us on their platform.
    // We want to log it and get a push notification, but Harry should never
    // try to reply to an automated Nextdoor number.
    const nextdoorLinkMatch = messageBody.match(
      /nextdoor\.com\/inbox\/chat\/([^\s?]+)/,
    )
    if (
      nextdoorLinkMatch ||
      messageBody.toLowerCase().includes('nextdoor.com')
    ) {
      console.log(
        '📍 Nextdoor notification intercepted — routing away from Harry',
      )

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
      messageBody,
      supabase,
      normalizedPhone,
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
      lsa: 'Google LSA',
    }
    const dbSource = sourceMap[sourceType]

    // LSA customer name tracking for relay number detection
    let lsaCustomerName: string | null = null
    let lsaPreviousCustomerName: string | null = null
    let shouldVerifyLsaIdentity = false

    // If this phone is an LSA relay, promote any prior 'inbound' conversations
    // to 'Google LSA'. Google sends the customer's real message first and the
    // disclaimer second, so the first message typically lands in a brand-new
    // 'inbound' conversation before we know it's LSA. Once we know, migrate it.
    if (sourceType === 'lsa') {
      // Extract customer name from this message
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

      // Check for previous LSA conversations on this relay number
      const { data: priorLsaConvos } = await supabase
        .from('conversations')
        .select('id, metadata, messages, updated_at')
        .eq('phone_number', normalizedPhone)
        .eq('source', 'Google LSA')
        .order('updated_at', { ascending: false })
        .limit(5)

      // Look for the most recent conversation with a tracked customer name
      if (priorLsaConvos && priorLsaConvos.length > 0) {
        for (const priorConvo of priorLsaConvos) {
          const metadata = priorConvo.metadata as {
            lsa_customer_name?: string
          } | null
          if (metadata?.lsa_customer_name) {
            lsaPreviousCustomerName = metadata.lsa_customer_name
            console.log(
              `[LSA] Previous customer on this relay: ${lsaPreviousCustomerName}`,
            )
            break
          }
        }

        // If we found a previous customer name and it's different from the current one,
        // OR if we have a previous customer but can't determine the current one,
        // flag for identity verification
        if (lsaPreviousCustomerName) {
          if (lsaCustomerName && lsaCustomerName !== lsaPreviousCustomerName) {
            console.warn(
              `[LSA] CUSTOMER SWITCH DETECTED: ${lsaPreviousCustomerName} → ${lsaCustomerName}`,
            )
            shouldVerifyLsaIdentity = true
          } else if (!lsaCustomerName) {
            console.warn(
              `[LSA] Cannot determine customer name - previous was ${lsaPreviousCustomerName}`,
            )
            shouldVerifyLsaIdentity = true
          }
        }
      }
    }

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

    // Check if this sender is a known scheduled ops customer.
    // Recognizing them should personalize Harry's reply, not silence him.
    const opsPhoneVariants = opsPhoneLookupVariants(normalizedPhone)
    const { data: opsCustomerMatch } = await supabase
      .from('ops_customers')
      .select('id, first_name, full_name')
      .in('phone', opsPhoneVariants)
      .maybeSingle()

    const isOpsCustomer = !!opsCustomerMatch
    const opsCustomerName = firstNameFromCustomer(opsCustomerMatch)
    const isReminderThread = isOpsCustomer
      ? await isRecentDayBeforeReminderThread({
          supabase,
          phoneVariants: opsPhoneVariants,
        })
      : false
    // Google LSA conversations must be 100% automated — they're fresh leads
    // coming through a Google relay number, so even if the relay happens to
    // collide with a known ops_customer phone we do NOT silence Harry.
    const isLsaConversation = sourceType === 'lsa'
    if (isOpsCustomer) {
      console.log(
        `[Harry] Sender ${normalizedPhone} matched ops_customer ${opsCustomerMatch!.full_name} (${opsCustomerMatch!.id}) — ${
          isReminderThread
            ? 'Harry auto-reply enabled (day-before reminder thread)'
            : isLsaConversation
              ? 'Harry auto-reply kept ON (Google LSA override)'
              : 'Harry auto-reply kept ON (known customer)'
        }`,
      )
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
      // Ensure ops customer flag is current (in case they were added to schedule after first text).
      if (isOpsCustomer && !conversation.ops_customer_id) {
        await supabase
          .from('conversations')
          .update({
            ops_customer_id: opsCustomerMatch!.id,
            ...(conversation.status === 'active' ? { ai_enabled: true } : {}),
          })
          .eq('id', conversation.id)
        conversation.ops_customer_id = opsCustomerMatch!.id
        if (conversation.status === 'active') conversation.ai_enabled = true
      } else if (
        isOpsCustomer &&
        !conversation.ai_enabled &&
        conversation.status === 'active'
      ) {
        await supabase
          .from('conversations')
          .update({ ai_enabled: true })
          .eq('id', conversation.id)
        conversation.ai_enabled = true
        console.log(
          `[Harry] Re-enabled auto-reply for known customer ${opsCustomerMatch!.id}`,
        )
      } else if (
        isLsaConversation &&
        !conversation.ai_enabled &&
        !isOpsCustomer
      ) {
        // Heal any LSA conversation that somehow ended up with ai_enabled=false
        // (e.g. from a legacy silence path). LSA must stay automatic.
        await supabase
          .from('conversations')
          .update({ ai_enabled: true })
          .eq('id', conversation.id)
        conversation.ai_enabled = true
      }

      // Update LSA customer name in metadata if we have a new one
      if (sourceType === 'lsa' && lsaCustomerName) {
        const currentMetadata =
          (conversation.metadata as Record<string, unknown>) || {}
        if (currentMetadata.lsa_customer_name !== lsaCustomerName) {
          console.log(
            `[LSA] Updating customer name in metadata: ${lsaCustomerName}`,
          )
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

    // IMPORTANT: pull any recent manual outbound messages first (Talky, etc.)
    // so Harry sees full context before responding to the new inbound text.
    const inferredBusinessNumber = toNumber
      ? normalizePhone(toNumber)
      : process.env.TWILIO_PHONE_NUMBER || null
    messages = await syncRecentOutboundContext({
      messages,
      customerPhone: normalizedPhone,
      businessNumber: inferredBusinessNumber,
    })

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

    // LSA disclaimer filter: Google Local Services Ads sends every inbound as
    // TWO SMS — the customer's actual message, then a "Replies to this number
    // will be sent to the customer..." boilerplate. If we let Harry reply to
    // both, the customer sees two Harry messages at the same timestamp (one
    // answering their real question, one answering the boilerplate). We save
    // the boilerplate for context but skip AI generation.
    const isLsaDisclaimer = isLsaDisclaimerText(messageBody)

    // Add customer message to conversation history
    messages.push({
      role: 'user',
      content: messageBody,
      timestamp: new Date().toISOString(),
      twilio_sid: twilioSid,
    })

    // Unified observability: mirror to ai_chat_logs (Harry + Scout + anything we add)
    await logChatMessage({
      agent: 'harry',
      channel: 'sms',
      sessionId: conversation.id,
      fromIdentity: normalizedPhone,
      role: 'user',
      content: messageBody,
      metadata: {
        twilio_sid: twilioSid,
        to_number: toNumber || null,
        channel_key: channelKey,
        is_lsa_disclaimer: isLsaDisclaimer,
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

    if (sourceType === 'lsa') {
      void sendLSALeadNotification({
        customerName: lsaCustomerName || undefined,
        phone: normalizedPhone,
        message: messageBody,
      })
    }

    // Persist the user message immediately so that Twilio webhook retries
    // (which arrive while the AI is still generating) see the twilio_sid in
    // the conversation and hit the dedup check above.
    await supabase
      .from('conversations')
      .update({ messages, updated_at: new Date().toISOString() })
      .eq('id', conversation.id)

    if (isAcknowledgmentOnlyMessage(messageBody)) {
      console.log('[SMS] Acknowledgment-only inbound detected, no reply sent')
      return emptyTwiml
    }

    // Check if this thread should be held for human handling.
    const holdDecision = shouldHoldForHuman({
      latestUserMessage: messageBody,
      messages,
    })
    if (holdDecision.hold) {
      await supabase
        .from('conversations')
        .update({
          messages,
          status: 'escalated',
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversation.id)

      if (holdDecision.reason === 'cancel_request') {
        const customerName = conversation.customer_name || normalizedPhone

        await Promise.allSettled([
          canSendEscalationAlerts
            ? sendAdminSMS(
                `🚨 CANCELLATION REQUEST\nCustomer: ${customerName}\nPhone: ${normalizedPhone}\nMessage: "${messageBody}"\n\nHarry did NOT cancel — needs your manual review.`,
                'ai_dispatcher_escalation',
              )
            : Promise.resolve(),
          sendOneSignalNotification({
            heading: '🚨 Job Cancellation Request',
            content: `${customerName} wants to cancel. Review needed.`,
            data: {
              type: 'cancel_request',
              phone: normalizedPhone,
              conversation_id: conversation.id,
            },
          }),
          sendCancellationAlert({
            customerName,
            phone: normalizedPhone,
            message: messageBody,
          }),
          resend.emails.send({
            from: 'Sasquatch SMS <onboarding@resend.dev>',
            to: 'sasquatchcc719@gmail.com',
            subject: `🚨 Cancellation Request — ${customerName}`,
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #dc2626;">Job Cancellation Request</h2>
                <div style="background: #fef2f2; border-radius: 8px; padding: 16px; margin: 16px 0;">
                  <p style="margin: 0 0 8px 0;"><strong>Customer:</strong> ${customerName}</p>
                  <p style="margin: 0 0 8px 0;"><strong>Phone:</strong> <a href="tel:${normalizedPhone}">${normalizedPhone}</a></p>
                  <p style="margin: 0;"><strong>Time:</strong> ${new Date().toLocaleString('en-US', { timeZone: 'America/Denver' })}</p>
                </div>
                <h3 style="color: #dc2626;">Customer said</h3>
                <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0;">
                  <p style="margin: 0; white-space: pre-wrap;">${messageBody.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
                </div>
                <p style="color: #6b7280; font-size: 14px;">
                  Harry did <strong>not</strong> cancel the job. Please review and handle manually.<br/>
                  <a href="https://sightings.sasquatchcarpet.com/admin/conversations?source=inbound">View Conversations</a> ·
                  <a href="https://sightings.sasquatchcarpet.com/admin/ops">View Jobs</a>
                </p>
              </div>
            `,
          }),
        ])

        await sendCustomerSMS(
          normalizedPhone,
          "I understand you'd like to cancel. I've flagged this for Charles and he'll follow up with you shortly to take care of it.",
          conversation.lead_id || undefined,
          'ai_dispatcher',
          toNumber || undefined,
        )

        console.log(
          `[SMS] Cancel request detected — triple-alert sent, customer notified`,
        )
      } else {
        if (canSendEscalationAlerts) {
          await sendAdminSMS(
            `🚧 Harry held reply (${holdDecision.reason})\nPhone: ${normalizedPhone}\nMessage: "${messageBody}"\n\nThread marked escalated for manual handling.`,
            'ai_dispatcher_escalation',
          )
        }
        await maybeSendInboundEmail(null)
      }

      console.log(
        `[SMS] Auto-reply suppressed, escalated for human: ${holdDecision.reason}`,
      )
      return emptyTwiml
    }

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
      // LSA Identity Verification: If we detected a potential customer switch on
      // this relay number, inject a system message telling Harry to verify who
      // he's speaking with before proceeding with booking/rescheduling operations.
      if (shouldVerifyLsaIdentity && sourceType === 'lsa') {
        console.log(`[LSA] Injecting identity verification prompt for Harry`)
        messages.push({
          role: 'system',
          content: `CRITICAL: Google LSA relay number detected with potential customer switch. Previous customer: ${lsaPreviousCustomerName || 'unknown'}. Current customer from LSA: ${lsaCustomerName || 'unknown'}.

BEFORE booking, rescheduling, or modifying ANY appointments, you MUST verify who you're speaking with by asking: "Hi! Just to confirm, who am I speaking with today?" or "Can I get your name to make sure I have the right information pulled up?"

DO NOT assume this is a continuation of the previous conversation. DO NOT reschedule or modify existing appointments until you confirm the customer's identity.`,
          timestamp: new Date().toISOString(),
        })
      }

      if (opsCustomerName && sourceType !== 'lsa') {
        messages.push({
          role: 'system',
          content: `Known customer context: This SMS phone number matches an existing Sasquatch customer named ${opsCustomerName}. Greet them by first name naturally (for example, "Hi ${opsCustomerName}, great to hear from you.") and help with their request. Do not stay silent just because they are already in the system.`,
          timestamp: new Date().toISOString(),
        })
      }

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
        undefined,
        {
          customerPhoneE164: normalizedPhone,
          isLsaRelay: channelKey === 'lsa',
        },
      )

      if (!aiResponse) {
        console.log('⚠️  AI returned empty response')
        await supabase
          .from('conversations')
          .update({ messages })
          .eq('id', conversation.id)
        await maybeSendInboundEmail(null)
        return emptyTwiml
      }

      // Add AI response to conversation
      messages.push({
        role: 'assistant',
        content: aiResponse,
        timestamp: new Date().toISOString(),
      })

      await logChatMessage({
        agent: 'harry',
        channel: 'sms',
        sessionId: conversation.id,
        fromIdentity: normalizedPhone,
        role: 'assistant',
        content: aiResponse,
        metadata: {
          to_number: toNumber || null,
          channel_key: channelKey,
        },
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
      const extractedInfo = extractCustomerInfo(messages)
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

      // Notify Charles via Harry Command bot
      const source =
        channelKey === 'lsa'
          ? 'lsa'
          : channelKey === 'inbound'
            ? 'main'
            : 'other'
      void notifyNewCustomerMessage({
        customerName: extractedInfo.name || undefined,
        phone: normalizedPhone,
        message: messageBody,
        source,
        conversationId: conversation.id,
        harryResponse: aiResponse,
      }).catch((err) =>
        console.error('Harry Command notification failed:', err),
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
