/**
 * Harry (next) — booking conversation flow.
 *
 * Gathers a new lead's booking details over SMS (autonomous, price-free Q&A —
 * recipient bound to the thread, model never states a number), and when it has
 * everything, proposes the booking to the owner on Telegram. On approval it
 * books via the existing, proven createAiStyleBooking — fed REAL service IDs by
 * the deterministic matcher, so the "issue matching the services" collapse that
 * broke old Harry cannot happen here.
 *
 * State lives in the existing `conversations` row (the running transcript), so
 * there's no new table and the multi-turn intake survives across texts.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { sendCustomerSMS } from '@/lib/twilio'
import { sendToCharles } from '@/lib/harry-command-bot'
import {
  createAiStyleBooking,
  type AiStyleBookingLineRequest,
} from '@/lib/ops/create-ai-style-booking'
import type { IntentModel } from './read-intent'
import {
  type BookingFields,
  isBookingComplete,
  nextBookingPrompt,
} from './booking'
import {
  buildCatalogMenu,
  quoteFromSelections,
  type CatalogItem,
  type ServiceSelection,
} from './quote'
import { buildApprovalCard } from './proposal-card'

const PENDING_TABLE = 'harry_next_pending_actions'

const extractionSchema = z.object({
  is_booking: z.boolean(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().optional(),
  street1: z.string().optional(),
  city: z.string().optional(),
  zip_code: z.string().optional(),
  lead_source: z.string().optional(),
  lead_source_detail: z.string().optional(),
  preferred_date: z.string().optional(),
  preferred_time: z.string().optional(),
  services: z
    .array(z.object({ item: z.number(), quantity: z.number() }))
    .optional(),
})

export type Transcript = Array<{ role: 'user' | 'assistant'; content: string }>

function buildExtractionPrompt(today: string, menu: string): string {
  return `You are reading an SMS conversation between a carpet-cleaning company and a potential customer, and pulling out the booking details so far.

Output ONLY JSON with this shape:
{"is_booking":bool,"first_name":str?,"last_name":str?,"email":str?,"street1":str?,"city":str?,"zip_code":str?,"lead_source":str?,"lead_source_detail":str?,"preferred_date":"YYYY-MM-DD"?,"preferred_time":"HH:MM"?,"services":[{"item":<menu number>,"quantity":<int>}]?}

Rules:
- is_booking = true only if the customer is trying to schedule/book a cleaning.
- Only include a field if the customer actually provided it. Omit unknowns. NEVER invent a date, time, email, or address.
- services: pick from the MENU below by NUMBER — one entry per thing to clean, with a quantity (number of rooms, stairs, etc.; default 1).
  - For rooms, use the square footage if the customer gave it; the menu shows each room's sqft range.
  - A plain "bedroom" with no size is a Regular Size Room. Only pick Sasquatch or larger for big/living/open rooms or large sqft.
  - If you cannot confidently match something to a menu item, leave it out — a human will follow up.
- preferred_date as YYYY-MM-DD (today is ${today}) and preferred_time as 24h HH:MM, ONLY if the customer stated a day/time.
- lead_source_detail: if the source is a referral, a realtor/property manager, a partner location, or "other", capture WHO or WHERE here.
- Never output prices or catalog ids — only menu numbers and quantities.

MENU:
${menu}`
}

export async function extractBookingFields(params: {
  transcript: Transcript
  today: string
  catalog: CatalogItem[]
  model: IntentModel
}): Promise<{ isBooking: boolean; fields: BookingFields }> {
  const user = params.transcript
    .map((m) => `${m.role === 'user' ? 'Customer' : 'Harry'}: ${m.content}`)
    .join('\n')

  const raw = await params.model({
    system: buildExtractionPrompt(
      params.today,
      buildCatalogMenu(params.catalog),
    ),
    user,
  })

  let parsed: z.infer<typeof extractionSchema>
  try {
    const stripped = raw
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim()
    const result = extractionSchema.safeParse(JSON.parse(stripped))
    if (!result.success) return { isBooking: false, fields: { services: [] } }
    parsed = result.data
  } catch {
    return { isBooking: false, fields: { services: [] } }
  }

  const services: ServiceSelection[] = (parsed.services ?? []).map((s) => ({
    item: Math.floor(s.item),
    quantity: Math.max(1, Math.floor(s.quantity) || 1),
  }))

  // Anti-fabrication: only accept a date/time if the CUSTOMER actually said
  // something temporal. The model was inventing these, so it claimed "I've got
  // everything" without ever asking for a day or time.
  const customerText = params.transcript
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' ')
  const hasDate =
    /\b(today|tonight|tomorrow|mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?|sun)(day)?\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b\d{1,2}(st|nd|rd|th)\b|\b\d{1,2}\/\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b|\bnext\s+(week|mon|tues?|wed|thur?s?|fri|sat|sun)/i.test(
      customerText,
    )
  const hasTime =
    /\b\d{1,2}\s*(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)\b|\b\d{1,2}:\d{2}\b|\b(morning|afternoon|evening|noon|midday)\b/i.test(
      customerText,
    )

  return {
    isBooking: parsed.is_booking,
    fields: {
      firstName: parsed.first_name,
      lastName: parsed.last_name,
      email: parsed.email,
      street1: parsed.street1,
      city: parsed.city,
      zipCode: parsed.zip_code,
      leadSource: parsed.lead_source,
      leadSourceDetail: parsed.lead_source_detail,
      preferredDate: hasDate ? parsed.preferred_date : undefined,
      preferredTime: hasTime ? parsed.preferred_time : undefined,
      services,
    },
  }
}

/** Self-contained booking payload persisted on the pending row. */
export type BookingStoredPayload = {
  kind: 'book'
  customer: {
    first_name: string
    last_name: string
    email: string
    phone: string
  }
  address: { street_1: string; city: string; state: string; zip_code: string }
  appointment_date: string
  start_time: string
  line_items: AiStyleBookingLineRequest[]
  lead_source: string
  lead_source_detail: string | null
  expectedTotal: number
}

/** Build the booking payload + total from complete fields. Returns null if a
 *  service couldn't be matched (caller asks instead of guessing). */
export function buildBookingPayload(
  catalog: CatalogItem[],
  fields: BookingFields,
  phone: string,
):
  | { payload: BookingStoredPayload; summary: string }
  | { unmatched: string[] } {
  const quote = quoteFromSelections(catalog, fields.services)
  if (quote.invalidItems.length > 0 || quote.lines.length === 0) {
    return { unmatched: quote.invalidItems.map(String) }
  }

  const payload: BookingStoredPayload = {
    kind: 'book',
    customer: {
      first_name: fields.firstName!,
      last_name: fields.lastName!,
      email: fields.email!,
      phone,
    },
    address: {
      street_1: fields.street1!,
      city: fields.city!,
      state: 'CO',
      zip_code: fields.zipCode!,
    },
    appointment_date: fields.preferredDate!,
    start_time: fields.preferredTime!,
    line_items: quote.lines.map((l) => ({
      service_id: l.serviceCatalogItemId,
      quantity: l.quantity,
    })),
    lead_source: fields.leadSource!,
    lead_source_detail: fields.leadSourceDetail ?? null,
    expectedTotal: quote.total,
  }

  const lineSummary = quote.lines
    .map((l) => `${l.quantity}× ${l.nameSnapshot}`)
    .join(', ')
  const via = `${fields.leadSource}${fields.leadSourceDetail ? ` (${fields.leadSourceDetail})` : ''}`
  const summary = `Book ${fields.firstName} ${fields.lastName} (${fields.email}) — ${lineSummary} at ${fields.street1}, ${fields.city} ${fields.zipCode} on ${fields.preferredDate} at ${fields.preferredTime} — via ${via} — total $${quote.total.toFixed(2)}`
  return { payload, summary }
}

/** On owner approval: create the job via the proven booking function. */
export async function executeBooking(
  supabase: SupabaseClient,
  payload: BookingStoredPayload,
): Promise<{
  ok: boolean
  reason?: string
  confirmation?: string
  total?: number
}> {
  const result = await createAiStyleBooking({
    supabase,
    customer: payload.customer,
    address: payload.address,
    appointment_date: payload.appointment_date,
    start_time: payload.start_time,
    line_items: payload.line_items,
    booking_mode: 'direct',
    booking_channel: 'sms_harry',
    source_label: 'Harry (SMS)',
    lead_source: payload.lead_source,
    lead_source_detail: payload.lead_source_detail,
    actor_label: 'Harry-next',
    admin_heading: 'Harry booked a job',
  })
  if (!result.ok) return { ok: false, reason: result.error }
  return {
    ok: true,
    confirmation: result.confirmation_number,
    total: result.total,
  }
}

function todayMountain(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
}

async function loadCatalog(supabase: SupabaseClient): Promise<CatalogItem[]> {
  const { data } = await supabase
    .from('service_catalog_items')
    .select('id, name, slug, base_price, pricing_unit')
    .eq('is_active', true)
  return (data ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    slug: r.slug ? String(r.slug) : null,
    basePrice: r.base_price == null ? null : Number(r.base_price),
    pricingUnit: String(r.pricing_unit),
  }))
}

/**
 * Drive one turn of a booking conversation. Reads the running transcript, pulls
 * out what's known, and either asks the customer for what's missing (autonomous,
 * no price) or — once complete — proposes the booking to the owner. Returns
 * handled=false when the message isn't a booking, so other handling can proceed.
 */
export async function runBookingIntake(params: {
  supabase: SupabaseClient
  phone: string
  message: string
  model: IntentModel
}): Promise<{ handled: boolean; status?: string }> {
  const { supabase, phone, message, model } = params

  const { data: convo } = await supabase
    .from('conversations')
    .select('id, messages')
    .eq('phone_number', phone)
    .eq('source', 'inbound')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let conversationId = convo?.id ? String(convo.id) : null
  const prior: Transcript = Array.isArray(convo?.messages)
    ? (convo.messages as Array<{ role?: string; content?: string }>)
        .filter(
          (m) =>
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string',
        )
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content as string,
        }))
    : []

  // Dedup an immediate Twilio retry of the same inbound text.
  const lastUser = [...prior].reverse().find((m) => m.role === 'user')
  const transcript: Transcript =
    lastUser?.content === message
      ? prior
      : [...prior, { role: 'user', content: message }]

  const catalog = await loadCatalog(supabase)
  const { isBooking, fields } = await extractBookingFields({
    transcript,
    today: todayMountain(),
    catalog,
    model,
  })

  if (!isBooking) return { handled: false }

  const persist = async (extra: Transcript) => {
    const stamped = [...transcript, ...extra].map((m) => ({
      ...m,
      timestamp: new Date().toISOString(),
    }))
    if (conversationId) {
      await supabase
        .from('conversations')
        .update({
          messages: stamped,
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
    } else {
      const { data } = await supabase
        .from('conversations')
        .insert({
          phone_number: phone,
          source: 'inbound',
          messages: stamped,
          ai_enabled: true,
          status: 'active',
        })
        .select('id')
        .single()
      conversationId = data?.id ? String(data.id) : null
    }
  }

  // Still gathering details — ask for the next thing (no price, bound recipient).
  if (!isBookingComplete(fields)) {
    const prompt =
      nextBookingPrompt(fields) ?? 'Could you tell me a little more?'
    await persist([{ role: 'assistant', content: prompt }])
    await sendCustomerSMS(phone, prompt, undefined, 'harry_next')
    return { handled: true, status: 'asked' }
  }

  // Complete — match services and propose to the owner.
  const built = buildBookingPayload(catalog, fields, phone)
  if ('unmatched' in built) {
    const ask = `Quick check so I get this right — could you tell me again exactly what you'd like cleaned (rooms, stairs, etc.)?`
    await persist([{ role: 'assistant', content: ask }])
    await sendCustomerSMS(phone, ask, undefined, 'harry_next')
    return { handled: true, status: 'clarify' }
  }

  // Idempotency: same booking already pending → don't double-card.
  const { data: existing } = await supabase
    .from(PENDING_TABLE)
    .select('id')
    .eq('recipient_phone', phone)
    .eq('action_summary', built.summary)
    .eq('status', 'pending')
    .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .maybeSingle()
  if (existing?.id) return { handled: true, status: 'proposed' }

  const { data: inserted, error } = await supabase
    .from(PENDING_TABLE)
    .insert({
      conversation_id: conversationId,
      recipient_phone: phone,
      intent: built.payload,
      action_summary: built.summary,
      proposed_reply: '',
      status: 'pending',
    })
    .select('id')
    .single()
  if (error || !inserted) return { handled: true, status: 'error' }

  const card = buildApprovalCard({
    customerName: `${fields.firstName} ${fields.lastName}`,
    recipientPhone: phone,
    actionSummary: built.summary,
    proposedReply:
      '(books the job on approve; customer gets a confirmation text)',
  })
  // Command bot + buttons so the approval is actionable (notifications bot is one-way).
  await sendToCharles(card, {
    buttons: [
      [
        { text: '✅ Approve', data: `hn:approve:${inserted.id}` },
        { text: '🚫 Reject', data: `hn:reject:${inserted.id}` },
      ],
    ],
  })

  const holding =
    "Perfect — I've got everything I need. Let me confirm this with the office and I'll lock it in shortly!"
  await persist([{ role: 'assistant', content: holding }])
  await sendCustomerSMS(phone, holding, undefined, 'harry_next')
  return { handled: true, status: 'proposed' }
}
