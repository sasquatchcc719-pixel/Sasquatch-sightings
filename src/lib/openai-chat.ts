/**
 * OpenAI Chat Integration for Sasquatch AI Dispatcher
 * Handles conversation context and generates AI responses
 */

import OpenAI from 'openai'
import { createAdminClient } from '@/supabase/server'
import {
  executeHarrySmsTool,
  HARRY_SMS_TOOLS,
  isHarrySmsOpsToolsEnabled,
} from '@/lib/ops/sms-harry-tools'
import { logToolCall } from '@/lib/ai/logging'

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null

if (!openai) {
  console.warn(
    '⚠️  OpenAI API key not configured - AI dispatcher will not work',
  )
}

// Check if AI dispatcher is enabled via environment variable
export const isAIEnabled = () => {
  return process.env.AI_DISPATCHER_ENABLED === 'true' && openai !== null
}

type Message = {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: string
}

/**
 * System prompt for Sasquatch AI Dispatcher
 * Identity, rules, and tool instructions live here.
 * Business knowledge (pricing, FAQ, service area, etc.) is loaded from
 * harry_knowledge_blocks in the database — do NOT duplicate it here.
 */
const SYSTEM_PROMPT = `MASTER SYSTEM PROMPT: SASQUATCH DISPATCHER

IDENTITY
You are Harry, Charles's AI assistant at Sasquatch Carpet Cleaning.
First message of every conversation: introduce yourself — "Hi! I'm Harry, Charles's assistant at Sasquatch Carpet Cleaning" or similar.
Tone: Professional, friendly, concise, solution-oriented. Helpful neighbor, not a robot.
Format: SMS — keep responses short. Under 160 chars when possible.

CONTEXT AWARENESS — PHONE LOOKUP FIRST
You already know the customer's phone number — it comes from the SMS sender automatically.
At the START of every conversation, call get_my_customer_profile to check if this phone matches a known customer.
- If they're a known customer: use their name, email, and address from the profile. Do NOT ask for info you already have.
- Also call list_my_upcoming_appointments to check for existing bookings.
- If they have an upcoming job, acknowledge it: "You're all set for [date] at [time]!"
- If they're NOT a known customer: proceed with normal info collection.
- ALWAYS check when a customer mentions "my appointment", "reschedule", "when are you coming", "look me up", "my phone number", etc.
- If a customer says "look at my phone number", "you have my number", or similar: call get_my_customer_profile immediately.

CONVERSATION FLOW
1. FIRST MESSAGE: Introduce yourself. Extract everything from their opening text (name, location, service needs). Don't re-ask for info they already gave.
2. QUOTE: You MAY give price estimates as soon as you have job details (rooms, sizes). You do NOT need name/email/address to state a price.
3. COLLECT INFO: Gather first+last name, email, full address (street, city, zip) naturally. Don't ask for all at once.
4. BOOK: Only call book_new_job after you have ALL required info AND completed the booking guardrails.
IMPORTANT: If a customer signals they want to book ("book it", "let's do it", "when can you come", "schedule", "ASAP"), you MUST ask for at least one missing contact field (name, email, or address) in that SAME response — even if you also need to clarify job details. Combine both asks in one message. Example: "Are those standard size bedrooms? And what's your name and address so I can check availability?"
After getting their name, use it in responses ("Thanks Jim!").
End conversations with "Questions? Just text back!"
Do NOT suggest calling — keep it in SMS.

CUSTOMER INFO REQUIREMENTS (ALL required before book_new_job)
- First AND last name (if only first given, ask for last)
- Email
- Full address: street, city, zip (if only street given, ask for city and zip)
- Phone: automatic from SMS for non-LSA. For Google LSA, see LSA section.
- Lead source: ask "How did you hear about us?" naturally. Pass as lead_source. For LSA, auto-set to "Google LSA".
Monument, CO has ZIP 80132 — if customer says Monument, use it; don't ask for ZIP.
If system context says this is a known customer with name/email/address on file, use that. Confirm stored info on first reply and ask if anything changed. Don't re-ask for fields already present.

GOOGLE LSA SPECIAL RULES (apply ONLY when CHANNEL = "Google LSA")
1. After getting name, IMMEDIATELY ask for callback phone: "What's the best number to reach you for confirmations?" The relay number can't receive texts.
2. Then quote pricing, collect email/address, offer times, book.
3. The system automatically adds a $40 LSA lead charge. Do NOT search for "Mileage/ Travel" or add it as a line item yourself.
4. When confirming to the customer, include the $40 in the total but do NOT itemize it or show math. Just list services and final total. Example: 4 bedrooms → "4 Standard Bedrooms - Total: $224" (not "4 × $46 = $184 + $40").
5. Do NOT skip the callback phone step. Do NOT call book_new_job without customer_phone for LSA.

NFC CARD / PARTNER REFERRALS
If customer mentions finding a card, scanning, NFC, or a local business name (barbershop, gym, coffee shop, etc.):
1. Acknowledge: "Awesome! Thanks for scanning our card at [place]! You get $20 off your cleaning."
2. Collect info: name, email, full address.
3. Continue with normal quoting — mention the $20 discount in the final quote.

SQUARE FOOTAGE → SERVICE MAPPING (use these EXACT search terms with search_service_catalog)
- Under 100 sqft → "Hall/Bathroom/Closet" ($25)
- 100–200 sqft → "Regular Size Room" ($46)
- 200–400 sqft → "Sasquatch Size Room" ($90)
- 400–600 sqft → "Monster Size Room" ($138)
- 600–800 sqft → "Jumbo Humungous Room" ($175)
- Over 800 sqft → "Oversized Room Carpet Cleaning" ($0.25/sqft — qty = measured sqft)
- Stairs → "Step Carpet Cleaning" ($4/step)
- Pet urine → "Urine Eliminator" ($25)

CRITICAL PRICING RULES
- Price EACH room separately by its own size, then sum. NEVER add sqft across rooms into one tier.
  Example: 5 bedrooms at 120 sqft each = 5 × $46 = $230. NOT 600 sqft = $138.
- NEVER assume room sizes. Ask for square footage before quoting, UNLESS customer says "X bedrooms" without sizes — then default to Regular ($46) but confirm: "Are those standard size, roughly under 200 sq ft?"
- "Hall/Bathroom/Closet" ($25) is ONLY for areas under 100 sqft. A bedroom is NEVER a hallway item.
- Living rooms and basements: ALWAYS ask for sqft before quoting — they often exceed 200 sqft.
- Default to STANDARD cleaning. Only use Deep Restoration when customer explicitly says "deep cleaning" or reports heavily soiled carpet.
- MINIMUM CHECK (do this EVERY time you state a price): if total < $150, you MUST add in the SAME message: "Our minimum dispatch fee is $150 — you'd be better off adding another room or two." If total >= $150, say nothing about the minimum. Example: 1 bedroom = $46 → "$46, but our minimum is $150. Add more rooms to get the most out of it." 4 bedrooms = $184 → "$184" (no minimum mention).

BOOKING GUARDRAILS (follow IN ORDER — never skip steps)
Step 1: Collect job details (rooms, sizes, services). Confirm back: "So that's [list], correct?" Wait for confirmation.
Step 2: Ask what DAY works.
Step 3: Call get_calendar_slots for that date.
Step 4: Show 2–3 available time slots. Ask which they prefer.
Step 5: Customer picks a time.
Step 6: Call book_new_job.
Hard stops:
- NEVER call book_new_job without completing steps 1–6.
- NEVER auto-pick a time. Customer MUST choose.
- Before booking, call list_my_upcoming_appointments. If they already have a booking, ask if they want to modify it instead.
- NEVER book a second job to fix a mistake. Use update_job_line_items / reschedule_job.
- Commercial jobs: use book_commercial_estimate, NOT book_new_job.

POST-BOOKING CONFIRMATION
After a successful book_new_job or update_job_line_items, give a full line-item breakdown:
"Booked for [date] at [time]:
• [qty] × [service] = $[subtotal]
Total: $[total]"
Exception: For LSA bookings, do NOT show per-item math. Just list services and final total.

COMMERCIAL / WALKTHROUGH ESTIMATES (book_commercial_estimate only)
Commercial = any business, organization, office, restaurant, church, HOA, apartment complex, daycare, school, etc.
Residential = any home, even big or "complicated" ones. Residential NEVER gets a walkthrough.
- "For commercial work Charles comes out, measures, and gives you an exact quote. It's free and takes about an hour."
- Collect: first+last name, business name, email, phone, full address, job description.
- Call get_calendar_slots with duration_minutes=60, offer times, call book_commercial_estimate.
- NEVER give commercial pricing. NEVER use residential tiers for commercial. NEVER use book_new_job for commercial.
- If unsure: "Is this for a home or a business?"

DAY-OF-WEEK RULE
When telling a customer what day a date falls on, ALWAYS use the day_of_week field returned by the tool (get_calendar_slots, list_my_upcoming_appointments, reschedule_job, book_new_job). NEVER compute the day name yourself — use exactly what the tool tells you.

EXISTING CUSTOMERS — RESCHEDULES, ADDRESS CHANGES, JOB UPDATES
- Use reschedule_job, update_job_address, update_job_line_items, list_my_upcoming_appointments.
- ALWAYS call list_my_upcoming_appointments first and use the real appointment_id. NEVER invent IDs.
- For reschedules: call get_calendar_slots for the new date, use exact slot_token. NEVER invent tokens.
- Confirm changes with full line-item breakdown after success.

CORRECTIONS AFTER BOOKING
If customer says you got it wrong, use update_job_line_items to fix. Use reschedule_job if time also needs changing. NEVER create a new booking to fix a mistake.

CANCELLATIONS — NEVER CANCEL
You cannot cancel appointments. If asked:
"I understand you'd like to cancel. I've flagged this for Charles and he'll follow up shortly."
The system auto-escalates cancel requests. Just give the response above and stop.

HONESTY GUARDRAIL (CRITICAL — violations cause real customer harm)
- To reschedule, book, or modify an appointment you MUST call the tool (reschedule_job, book_new_job, etc.) and receive success: true BEFORE telling the customer it's done.
- NEVER tell a customer their appointment was rescheduled, booked, or changed unless a tool call in THIS conversation returned success: true or a confirmation_number.
- If you haven't called the tool yet, do NOT say "I'll get you moved" or "One moment while I update" — call the tool FIRST, then confirm.
- If a tool returned "error": respond based on error type:
  Fixable (missing data): ask customer for the missing info. Don't escalate.
  Policy/business rule: explain and offer solutions.
  System/technical: escalate to Charles.
- NEVER say "Done!" or "I've updated that" unless a tool just confirmed success.
- If a tool succeeded, ALWAYS confirm. Do NOT say "I wasn't able to" when the tool returned success.
- If you don't have a tool for what they're asking: "That's outside what I can do — I've flagged it for Charles."

ESCALATION
- Water emergency → "This sounds like an emergency. I'm flagging this for our Restoration Team immediately."
- Angry customer → "I'm sorry to hear that. I've sent an urgent message to the owner. He will call you personally."
- Otherwise: "I've flagged this for Charles and he'll follow up shortly."

SMS OPS TOOLS
When tools are available, you may call them to read/update THIS customer's appointments.
- list_my_upcoming_appointments: get appointment_id values.
- search_service_catalog: find service UUIDs. ALWAYS use the exact search terms from SQUARE FOOTAGE → SERVICE MAPPING above.
- get_calendar_slots: check availability before booking/rescheduling.
- book_new_job: uses customer's SMS phone automatically — never ask them to "confirm phone."
- update_job_line_items: fix services/quantities on existing booking.
- add_job_note: save important information to job notes (garage codes, gate codes, pet info, special instructions). Use IMMEDIATELY when customer provides access codes or special instructions. After calling this tool successfully, confirm to the customer: "Got it — I've saved that to your job notes."
- book_commercial_estimate: commercial walkthroughs only (get_calendar_slots with duration_minutes=60 first).
After a successful tool call, reply with a full line-item breakdown (except LSA — no math, just services + total).
`

/**
 * Post-processing guardrail: if a response quotes a price under $150 without
 * mentioning the minimum dispatch fee, re-prompt GPT to include it.
 */
function needsMinimumDisclaimer(response: string): boolean {
  const lower = response.toLowerCase()
  if (lower.includes('minimum') || lower.includes('$150')) return false
  if (
    lower.includes('booked') ||
    lower.includes('confirmed') ||
    lower.includes('walkthrough')
  )
    return false

  const priceMatches = response.match(/\$(\d+(?:\.\d{2})?)/g)
  if (!priceMatches || priceMatches.length === 0) return false

  const prices = priceMatches.map((p) => parseFloat(p.replace('$', '')))
  const maxPrice = Math.max(...prices)
  return maxPrice > 0 && maxPrice < 150
}

/**
 * Generate AI response for a customer message
 */
export async function generateAIResponse(
  customerMessage: string,
  conversationHistory: Message[] = [],
  context?: { partnerName?: string; couponCode?: string },
  channelKey:
    | 'inbound'
    | 'contest'
    | 'vendor'
    | 'business_card'
    | 'nextdoor'
    | 'lsa' = 'inbound',
  _bookingUrlOverride?: string,
  smsOpsContext?: {
    customerPhoneE164: string
    isLsaRelay?: boolean
    sessionId?: string
  },
): Promise<string> {
  if (!openai) {
    throw new Error('OpenAI not configured')
  }

  if (!isAIEnabled()) {
    console.log('AI Dispatcher is disabled via environment variable')
    return '' // Return empty string, handler will skip sending
  }

  try {
    const supabase = createAdminClient()
    let knowledgeContext = ''
    let profileContext = ''
    let promoContext = ''

    try {
      const now = new Date().toISOString()
      const [
        { data: knowledgeRows },
        { data: profileRow },
        { data: promoRows },
      ] = await Promise.all([
        supabase
          .from('harry_knowledge_blocks')
          .select('title, content')
          .eq('is_enabled', true)
          .order('sort_order', { ascending: true }),
        supabase
          .from('harry_logic_profiles')
          .select('label, booking_mode, prompt_overrides')
          .eq('channel_key', channelKey)
          .eq('is_enabled', true)
          .maybeSingle(),
        supabase
          .from('promo_codes')
          .select(
            'code, discount_type, discount_amount, description, expires_at, max_uses, use_count',
          )
          .eq('active', true)
          .or(`expires_at.is.null,expires_at.gt.${now}`),
      ])

      if ((knowledgeRows || []).length > 0) {
        knowledgeContext = `

DASHBOARD KNOWLEDGE (editable controls):
${(knowledgeRows || [])
  .map((row) => `- ${row.title}: ${String(row.content || '').trim()}`)
  .filter((row) => row.length > 4)
  .join('\n')}
`
      }

      if (profileRow) {
        profileContext = `

CHANNEL LOGIC PROFILE:
- Profile: ${profileRow.label}
- Booking mode: ${profileRow.booking_mode}
- Overrides: ${profileRow.prompt_overrides || 'None'}
`
      }

      if ((promoRows || []).length > 0) {
        const codeLines = (promoRows || [])
          .filter((p) => {
            if (p.max_uses !== null && p.use_count >= p.max_uses) return false
            return true
          })
          .map((p) => {
            const amount =
              p.discount_type === 'flat'
                ? `$${Number(p.discount_amount).toFixed(2)} off`
                : `${p.discount_amount}% off`
            const expiry = p.expires_at
              ? ` [expires ${new Date(p.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}]`
              : ''
            const desc = p.description ? ` — ${p.description}` : ''
            return `- ${p.code}: ${amount}${expiry}${desc}`
          })
          .join('\n')

        promoContext = `

ACTIVE DISCOUNT CODES (live from database — source of truth):
${codeLines}
Rules: Only offer a code if it is appropriate for this customer's channel and context. Never invent codes not on this list. If a customer asks about a code not listed above, tell them it is not currently active.
`
      }
    } catch (contextError) {
      console.error(
        '[Harry] Failed to load dynamic prompt context:',
        contextError,
      )
    }

    // Inject today's date so Harry can resolve "tomorrow", "next Monday", etc.
    const todayMT = new Date().toLocaleDateString('en-US', {
      timeZone: 'America/Denver',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    const todayISO = new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Denver',
    })
    const dateContext = `\n\nTODAY'S DATE: ${todayMT} (${todayISO}). Use this to resolve relative dates like "tomorrow", "next week", "this Monday", etc. Pass dates to tools in YYYY-MM-DD format.\n`

    // Inject the channel so Harry knows which promotions are eligible
    const channelLabel: Record<string, string> = {
      inbound: 'inbound',
      contest: 'contest',
      vendor: 'vendor',
      business_card: 'business_card',
      nextdoor: 'nextdoor',
      lsa: 'Google LSA',
    }
    const isLsa = channelKey === 'lsa'
    const lsaExtra = isLsa
      ? ' This conversation is via a Google LSA relay number — the relay cannot receive confirmation texts. You MUST ask the customer for their real callback phone number (e.g. "What\'s the best number to reach you for confirmations?") before calling book_new_job, and pass it as customer_phone.'
      : ''
    const channelContext = `\n\nCHANNEL: ${channelLabel[channelKey] ?? channelKey}. Only apply promotions and discounts that are explicitly allowed for this channel.${lsaExtra}\n`

    // Build system prompt with partner context if available
    let systemPrompt =
      SYSTEM_PROMPT +
      knowledgeContext +
      profileContext +
      promoContext +
      dateContext +
      channelContext
    if (context?.couponCode) {
      const partnerContext = `

CURRENT CUSTOMER CONTEXT:
- This customer came from ${context.partnerName || 'a partner location'}'s NFC card
- Their specific discount code is: ${context.couponCode}
- ALWAYS mention their code "${context.couponCode}" when discussing the discount
- Tell them to mention "${context.couponCode}" when booking to get their $20 off
`
      systemPrompt =
        SYSTEM_PROMPT +
        knowledgeContext +
        profileContext +
        promoContext +
        partnerContext +
        dateContext +
        channelContext
    }

    // Build messages array with system prompt + conversation history + new message.
    // The webhook stores the inbound message before calling this function, so
    // do not duplicate the same latest customer text in the model context.
    const lastHistoryMessage =
      conversationHistory[conversationHistory.length - 1]
    const historyAlreadyIncludesLatest =
      lastHistoryMessage?.role === 'user' &&
      lastHistoryMessage.content.trim() === customerMessage.trim()
    const baseMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.map((msg) => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      })),
      ...(historyAlreadyIncludesLatest
        ? []
        : [{ role: 'user' as const, content: customerMessage }]),
    ]

    const useSmsTools =
      Boolean(smsOpsContext?.customerPhoneE164) && isHarrySmsOpsToolsEnabled()

    if (useSmsTools && smsOpsContext) {
      const messages = [...baseMessages]
      let lastText = ''
      for (let round = 0; round < 8; round += 1) {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4.1',
          messages,
          tools: HARRY_SMS_TOOLS,
          tool_choice: 'auto',
          temperature: 0.4,
          max_tokens: 450,
        })

        const msg = completion.choices[0]?.message
        if (!msg) break

        if (msg.tool_calls && msg.tool_calls.length > 0) {
          messages.push(msg)
          for (const tc of msg.tool_calls) {
            if (tc.type !== 'function') continue
            const toolStart = Date.now()
            let parsedArgs: Record<string, unknown> = {}
            try {
              parsedArgs = JSON.parse(tc.function.arguments || '{}')
            } catch {
              /* keep empty */
            }
            const out = await executeHarrySmsTool(
              tc.function.name,
              tc.function.arguments || '{}',
              {
                supabase,
                customerPhoneE164: smsOpsContext.customerPhoneE164,
                isLsaRelay: smsOpsContext.isLsaRelay ?? false,
                sessionId: smsOpsContext.sessionId,
              },
            )
            let toolSuccess = false
            let parsedResult: Record<string, unknown> | null = null
            try {
              parsedResult = JSON.parse(out)
              toolSuccess =
                (parsedResult as Record<string, unknown>)?.success === true ||
                !(parsedResult as Record<string, unknown>)?.error
            } catch {
              /* treat unparseable as failure */
            }
            logToolCall({
              agent: 'harry',
              sessionId: smsOpsContext.sessionId ?? 'unknown',
              toolName: tc.function.name,
              args: parsedArgs,
              result: parsedResult,
              success: toolSuccess,
              durationMs: Date.now() - toolStart,
            })
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: out,
            })
          }
          continue
        }

        lastText = (msg.content || '').trim()
        break
      }

      if (needsMinimumDisclaimer(lastText)) {
        messages.push({ role: 'assistant', content: lastText })
        messages.push({
          role: 'system',
          content:
            'GUARDRAIL: The quote you just gave is under $150 but you did not mention the $150 minimum dispatch fee. Rewrite your last message and include: "Our minimum dispatch fee is $150 — you\'d be better off adding another room or two to get the most out of it." Keep the same friendly tone.',
        })
        const retry = await openai.chat.completions.create({
          model: 'gpt-4.1',
          messages,
          temperature: 0.3,
          max_tokens: 450,
        })
        const retryText = (retry.choices[0]?.message?.content || '').trim()
        if (retryText) lastText = retryText
      }

      return lastText
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: baseMessages,
      temperature: 0.4,
      max_tokens: 300, // Keep responses concise for SMS
    })

    let response = (completion.choices[0]?.message?.content || '').trim()

    if (needsMinimumDisclaimer(response)) {
      const retryMessages: OpenAI.ChatCompletionMessageParam[] = [
        ...baseMessages,
        { role: 'assistant', content: response },
        {
          role: 'system',
          content:
            'GUARDRAIL: The quote you just gave is under $150 but you did not mention the $150 minimum dispatch fee. Rewrite your last message and include: "Our minimum dispatch fee is $150 — you\'d be better off adding another room or two to get the most out of it." Keep the same friendly tone.',
        },
      ]
      const retry = await openai.chat.completions.create({
        model: 'gpt-4.1',
        messages: retryMessages,
        temperature: 0.3,
        max_tokens: 300,
      })
      const retryText = (retry.choices[0]?.message?.content || '').trim()
      if (retryText) response = retryText
    }

    return response
  } catch (error) {
    console.error('OpenAI API error:', error)
    throw error
  }
}

/**
 * Check if AI response indicates customer needs human escalation
 */
export function shouldEscalate(aiResponse: string): boolean {
  const escalationPhrases = [
    "I'm flagging this for",
    'Restoration Team immediately',
    'urgent message to the owner',
    'call you personally',
    'owner will call you',
    'emergency',
    'flagging this',
    'sounds like an emergency',
  ]

  const lowerResponse = aiResponse.toLowerCase()
  return escalationPhrases.some((phrase) =>
    lowerResponse.includes(phrase.toLowerCase()),
  )
}
