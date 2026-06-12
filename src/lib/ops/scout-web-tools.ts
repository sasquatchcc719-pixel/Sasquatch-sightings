import { Resend } from 'resend'
import type { SupabaseClient } from '@supabase/supabase-js'
import type OpenAI from 'openai'
import {
  applyAppointmentBuffer,
  calculateAppointmentDurationFromTotal,
} from '@/lib/ops/availability'
import { createAiStyleBooking } from '@/lib/ops/create-ai-style-booking'
import { createAiStyleEstimate } from '@/lib/ops/create-ai-style-estimate'
import { getStaffPrioritizedSlots } from '@/lib/ops/staff-availability'
import { createSlotToken, verifySlotToken } from '@/lib/ops/slot-token'
import { checkServiceArea } from '@/lib/service-area'

/**
 * Scout Web Tools
 *
 * Tool definitions + executor for Scout (the website chat agent).
 * Mirrors Harry's SMS tool shape so the LLM logic is familiar, but adapts to
 * the web context:
 *   - There is no authenticated inbound phone like SMS gives us. Scout has to
 *     collect the customer's phone in the chat, and we pass it to
 *     createAiStyleBooking directly.
 *   - No reschedule / update / address tools. Those require phone-based
 *     authentication and belong with Harry via SMS. If a web visitor asks to
 *     change an existing booking, Scout should redirect them to text Harry.
 *   - Per-IP (session) rate limit so one browser can't hammer the DB.
 *
 * Today's date in Mountain Time (YYYY-MM-DD). Avoids UTC rollover at 6 PM MDT.
 */
function todayMountain(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
}

const TOOL_RATE_WINDOW_MS = 60_000
const TOOL_RATE_MAX = 15
const toolCallTimestamps = new Map<string, number[]>()

function checkToolRate(
  key: string,
): { ok: true } | { ok: false; error: string } {
  const now = Date.now()
  const windowStart = now - TOOL_RATE_WINDOW_MS
  let stamps = toolCallTimestamps.get(key) ?? []
  stamps = stamps.filter((t) => t > windowStart)
  if (stamps.length >= TOOL_RATE_MAX) {
    return {
      ok: false,
      error: 'Too many actions in a short time. Try again in a minute.',
    }
  }
  stamps.push(now)
  toolCallTimestamps.set(key, stamps)
  return { ok: true }
}

function toDbTime(value: string): string {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(value).trim())
  if (!m) return '09:00:00'
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)))
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)))
  const sec = m[3] != null ? Math.min(59, Math.max(0, parseInt(m[3], 10))) : 0
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function normClock5(t: string): string {
  return toDbTime(t).slice(0, 5)
}

function normalizePhone(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.length < 10) return ''
  return '+1' + digits.slice(-10)
}

export type ScoutWebToolContext = {
  supabase: SupabaseClient
  /** Identifier used for per-session rate limiting (IP or session id). */
  rateLimitKey: string
}

export const SCOUT_WEB_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_service_catalog',
      description:
        'Search active services by name to get service UUIDs for booking. Use the exact terms from the SQUARE FOOTAGE → SERVICE MAPPING table.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search text (e.g. "Regular Size Room", "Step")',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_calendar_slots',
      description:
        'Get available start times for a calendar date (YYYY-MM-DD) in America/Denver. Call this before offering times to the customer.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          duration_minutes: {
            type: 'number',
            description:
              'Total job duration in minutes before buffer (default 120)',
          },
        },
        required: ['date'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_new_job',
      description:
        'Create a new appointment for this website visitor. Requires full name, email, phone, full address, catalog service IDs, and a start_time that appears in get_calendar_slots for that date. NEVER call without confirming services AND letting the customer pick the time.',
      parameters: {
        type: 'object',
        properties: {
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          email: { type: 'string' },
          customer_phone: {
            type: 'string',
            description:
              "Customer's 10-digit US callback phone number. Required.",
          },
          lead_source: {
            type: 'string',
            description:
              'Canonical key for how the customer heard about Sasquatch. Use one of: google_search, google_lsa, nextdoor, facebook, instagram, yelp, chatgpt, gemini, claude, grok, perplexity, vehicle_wrap, nfc_partner, referral, realtor_property_manager, repeat_customer, other. Never use Scout, website chat, Harry, Rabecca, Retell, voice AI, or Telegram as the marketing source.',
          },
          lead_source_detail: {
            type: 'string',
            description:
              'Required when lead_source is referral, realtor_property_manager, nfc_partner, or other. Ask for the referrer name, company/location/card code, or where they found us.',
          },
          street_1: { type: 'string' },
          city: { type: 'string' },
          state: {
            type: 'string',
            description: 'Two-letter state, defaults to CO',
          },
          zip_code: { type: 'string' },
          appointment_date: { type: 'string', description: 'YYYY-MM-DD' },
          start_time: { type: 'string', description: 'HH:MM (24h)' },
          slot_token: {
            type: 'string',
            description:
              'Required. Use the slot_token returned by get_calendar_slots for this exact date and time.',
          },
          line_items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                service_id: { type: 'string' },
                quantity: { type: 'number' },
              },
              required: ['service_id', 'quantity'],
            },
          },
          accepted_minimum_charge: {
            type: 'boolean',
            description:
              'Set true only when selected services are below the $150 minimum and the customer explicitly agreed to book at the $150 minimum anyway.',
          },
        },
        required: [
          'first_name',
          'last_name',
          'email',
          'customer_phone',
          'lead_source',
          'street_1',
          'city',
          'zip_code',
          'appointment_date',
          'start_time',
          'slot_token',
          'line_items',
        ],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_commercial_estimate',
      description:
        "COMMERCIAL WORK ONLY. Book a 1-hour time slot on Charles's calendar for an on-site walkthrough / measurement visit of a commercial property (office, restaurant, HOA, church, apartment complex, school, medical office, gym, store, etc.). You are NOT generating the estimate — you are only reserving the slot for Charles to come out, measure, and build the quote himself. Requires a start_time that appears in get_calendar_slots for that date (use duration_minutes=60 when checking). DO NOT use this for any residential job — residential ALWAYS books directly via book_new_job, no matter how big or complex the house is.",
      parameters: {
        type: 'object',
        properties: {
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          business_name: {
            type: 'string',
            description:
              'Company / business name (strongly preferred for commercial leads). Leave empty if the contact is an individual.',
          },
          email: { type: 'string' },
          customer_phone: {
            type: 'string',
            description: "Customer's 10-digit US callback phone. Required.",
          },
          street_1: { type: 'string' },
          city: { type: 'string' },
          state: {
            type: 'string',
            description: 'Two-letter state, defaults to CO',
          },
          zip_code: { type: 'string' },
          appointment_date: { type: 'string', description: 'YYYY-MM-DD' },
          start_time: { type: 'string', description: 'HH:MM (24h)' },
          slot_token: {
            type: 'string',
            description:
              'Required. Use the slot_token returned by get_calendar_slots for this exact commercial walkthrough slot.',
          },
          job_description: {
            type: 'string',
            description:
              'Short summary of what they want quoted — square footage if known, floor types, occupancy, urgency, etc.',
          },
        },
        required: [
          'first_name',
          'last_name',
          'email',
          'customer_phone',
          'street_1',
          'city',
          'zip_code',
          'appointment_date',
          'start_time',
          'slot_token',
        ],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notify_charles',
      description:
        'Send Charles an email alert about a customer issue Scout cannot resolve. ' +
        'Use whenever you tell a customer that Charles will follow up. ' +
        'Always collect the customer phone before calling this if a callback was promised.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description:
              'Short summary of why Charles needs to act (1–2 sentences)',
          },
          customer_name: {
            type: 'string',
            description: "Customer's name if known",
          },
          customer_phone: {
            type: 'string',
            description: 'Required if a callback was promised to the customer',
          },
          customer_email: {
            type: 'string',
            description: "Customer's email if known",
          },
          conversation_summary: {
            type: 'string',
            description:
              'Key points from the conversation — what they wanted, what went wrong, what was promised',
          },
        },
        required: ['reason', 'conversation_summary'],
        additionalProperties: false,
      },
    },
  },
]

export async function executeScoutWebTool(
  name: string,
  argsJson: string,
  ctx: ScoutWebToolContext,
): Promise<string> {
  const rl = checkToolRate(ctx.rateLimitKey)
  if (!rl.ok) return JSON.stringify({ error: rl.error })

  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson || '{}') as Record<string, unknown>
  } catch {
    return JSON.stringify({ error: 'Invalid tool arguments' })
  }

  const { supabase } = ctx

  try {
    switch (name) {
      case 'search_service_catalog': {
        const q = String(args.query || '')
          .trim()
          .replace(/[%_\\]/g, ' ')
          .slice(0, 80)
        if (!q) return JSON.stringify({ services: [], error: 'Empty query' })

        // Commercial services are not available for web self-service booking.
        const EXCLUDED_SERVICE_NAMES = [
          'Card fee',
          'Custom amount',
          'Discount',
          'Gratuity',
          'Mileage/ Travel',
          'Commercial carpet cleaning',
          'Commercial Carpet Cleaning',
          'Commercial Hard Floor Cleaning',
          'Low Moisture Encapsulation Cleaning LVM/Bonnet',
          'Commercial Deodorizer (Per Sqft)',
          'Auto scrubbing Floors (Lvt/Vinyl/Epoxy)',
          'Seal coat Vinyl/LVT flooring (per foot charge)',
        ]

        const { data: services, error } = await supabase
          .from('service_catalog_items')
          .select('id, name, category, base_price, default_duration_minutes')
          .eq('is_active', true)
          .ilike('name', `%${q}%`)
          .limit(25)

        if (error) throw error
        const filtered = (services || []).filter(
          (s) => !EXCLUDED_SERVICE_NAMES.includes(s.name),
        )
        return JSON.stringify({
          services: filtered.map((s) => ({
            id: s.id,
            name: s.name,
            category: s.category,
            base_price: s.base_price,
            default_duration_minutes: s.default_duration_minutes,
          })),
        })
      }

      case 'get_calendar_slots': {
        const date = String(args.date || '').trim()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return JSON.stringify({ error: 'date must be YYYY-MM-DD' })
        }
        const today = todayMountain()
        if (date < today) {
          return JSON.stringify({
            date,
            slots: [],
            message: 'Cannot book in the past',
          })
        }

        const durationParam = Number(args.duration_minutes || 120)
        const requiredMinutes = applyAppointmentBuffer(
          durationParam > 0 ? durationParam : 120,
        )

        const staffResult = await getStaffPrioritizedSlots({
          supabase,
          date,
          requiredMinutes,
          maxResults: 12,
        })

        if (!staffResult) {
          return JSON.stringify({
            date,
            slots: [],
            message: 'No availability on this date',
          })
        }

        return JSON.stringify({
          date,
          slots: staffResult.slots.map((s) => ({
            start_time: s.start_time.slice(0, 5),
            end_time: s.end_time.slice(0, 5),
            slot_token: createSlotToken({
              date,
              startTime: s.start_time,
              endTime: s.end_time,
              requiredMinutes,
              ownerKey: ctx.rateLimitKey,
              assignedStaffUserId: staffResult.staffUserId,
            }),
          })),
        })
      }

      case 'book_new_job': {
        const firstName = String(args.first_name || '').trim()
        const lastName = String(args.last_name || '').trim()
        const email = String(args.email || '').trim()
        const phone = normalizePhone(String(args.customer_phone || ''))
        const street1 = String(args.street_1 || '').trim()
        const city = String(args.city || '').trim()
        const state = String(args.state || 'CO').trim() || 'CO'
        const zipCode = String(args.zip_code || '').trim()
        const appointmentDate = String(args.appointment_date || '').trim()
        const startTime = String(args.start_time || '').trim()
        const slotToken = String(args.slot_token || '').trim()
        const providedLeadSource = String(args.lead_source || '').trim()
        const lineItems = Array.isArray(args.line_items) ? args.line_items : []
        const acceptedMinimumCharge = args.accepted_minimum_charge === true

        if (!firstName || !lastName || !email) {
          return JSON.stringify({
            error: 'first_name, last_name, and email are required',
          })
        }
        if (!phone) {
          return JSON.stringify({
            error:
              'customer_phone is required. Ask the customer for a 10-digit callback number.',
          })
        }
        if (!street1 || !city || !zipCode) {
          return JSON.stringify({
            error: 'street_1, city, and zip_code are required',
          })
        }
        if (!appointmentDate || !startTime || !slotToken) {
          return JSON.stringify({
            error: 'appointment_date, start_time, and slot_token are required',
          })
        }
        if (!lineItems.length) {
          return JSON.stringify({ error: 'line_items required' })
        }
        if (!providedLeadSource) {
          return JSON.stringify({
            error:
              'lead_source is required. Ask the customer how they heard about us first.',
          })
        }

        // Duplicate-booking guard: if this phone already has an active job on
        // the same date, ask them to text Harry instead of creating a second.
        const { data: existingCusts } = await supabase
          .from('ops_customers')
          .select('id')
          .eq('phone', phone)

        if (existingCusts && existingCusts.length > 0) {
          const custIds = existingCusts.map((c) => c.id)
          const { data: existingAppts } = await supabase
            .from('ops_appointments')
            .select('id')
            .in('customer_id', custIds)
            .eq('appointment_date', appointmentDate)
            .in('status', [
              'booked',
              'confirmed',
              'on_my_way',
              'in_progress',
              'pending_approval',
            ])
            .limit(1)

          if (existingAppts && existingAppts.length > 0) {
            return JSON.stringify({
              error: `This customer already has a booking on ${appointmentDate}. To change an existing booking, text Harry at (719) 249-8791. Do NOT create a duplicate.`,
            })
          }
        }

        const parsedLineItems = lineItems.map((row: unknown) => {
          const r = row as { service_id?: string; quantity?: number }
          return {
            service_id: String(r.service_id || '').trim(),
            quantity: Math.max(1, Number(r.quantity) || 1),
          }
        })

        const catalogIds = parsedLineItems.map((l) => l.service_id)
        const { data: catalogRows } = await supabase
          .from('service_catalog_items')
          .select(
            'id, slug, default_duration_minutes, base_price, pricing_unit',
          )
          .in('id', catalogIds)
          .eq('is_active', true)

        if (!catalogRows || catalogRows.length === 0) {
          return JSON.stringify({
            error:
              'None of the requested services matched active catalog items.',
          })
        }

        const MIN_JOB_TOTAL = 150
        const preServiceTotal = catalogRows.reduce((sum, row) => {
          const qty =
            parsedLineItems.find((p) => p.service_id === row.id)?.quantity ?? 1
          return sum + Number(row.base_price || 0) * qty
        }, 0)
        const serviceAreaCheck = checkServiceArea(zipCode)
        if (!serviceAreaCheck.allowed) {
          return JSON.stringify({ error: serviceAreaCheck.message })
        }
        const preTotal = preServiceTotal + (serviceAreaCheck.travelCharge || 0)
        if (preTotal < MIN_JOB_TOTAL && !acceptedMinimumCharge) {
          return JSON.stringify({
            error: `Job total of $${preTotal.toFixed(2)} is below the $${MIN_JOB_TOTAL} minimum. Ask if the customer wants to add more services or book at the $${MIN_JOB_TOTAL} minimum. If they explicitly accept the minimum, call book_new_job again with accepted_minimum_charge: true.`,
          })
        }

        // Check availability with the SAME duration createAiStyleBooking
        // stores (dollar tiers on the service subtotal) so the verified slot
        // and the stored calendar block can never disagree.
        const requiredMinutes = applyAppointmentBuffer(
          calculateAppointmentDurationFromTotal(preServiceTotal),
        )
        const bookStaffResult = await getStaffPrioritizedSlots({
          supabase,
          date: appointmentDate,
          requiredMinutes,
          maxResults: 48,
        })

        const slots = bookStaffResult?.slots || []

        const wantStart = normClock5(startTime)
        const match = slots.find((s) => normClock5(s.start_time) === wantStart)
        if (!match) {
          return JSON.stringify({
            error: `That start time is not available on ${appointmentDate}. Call get_calendar_slots first and offer a listed time.`,
            suggested_slots: slots
              .slice(0, 8)
              .map((s) => s.start_time.slice(0, 5)),
          })
        }
        const slotTokenCheck = verifySlotToken(slotToken, {
          date: appointmentDate,
          startTime: match.start_time,
          endTime: match.end_time,
          requiredMinutes,
          ownerKey: ctx.rateLimitKey,
        })
        if (!slotTokenCheck.ok) {
          return JSON.stringify({
            error: `${slotTokenCheck.error} You must call get_calendar_slots and use the returned slot_token before booking.`,
          })
        }

        const bookingMode =
          process.env.SCOUT_WEB_BOOKING_MODE === 'request'
            ? 'request'
            : 'direct'

        const result = await createAiStyleBooking({
          supabase,
          customer: {
            first_name: firstName,
            last_name: lastName,
            email,
            phone,
          },
          address: { street_1: street1, city, state, zip_code: zipCode },
          appointment_date: appointmentDate,
          start_time: startTime,
          line_items: parsedLineItems,
          booking_mode: bookingMode,
          booking_channel: 'ai_agent',
          source_label: 'Scout Website Chat',
          lead_source: providedLeadSource,
          lead_source_detail:
            String(args.lead_source_detail || '').trim() || null,
          actor_label: 'Scout Web',
          admin_heading: 'Scout website booking',
          accepted_minimum_charge: acceptedMinimumCharge,
          assigned_staff_user_id:
            slotTokenCheck.assignedStaffUserId || bookStaffResult?.staffUserId,
        })

        if (!result.ok) {
          return JSON.stringify({ error: result.error })
        }

        return JSON.stringify({
          success: true,
          confirmation_number: result.confirmation_number,
          status: result.appointment_status,
          appointment_date: result.appointment_date,
          start_time: result.start_time.slice(0, 5),
          total: result.total,
          message: result.message,
        })
      }

      case 'book_commercial_estimate': {
        const firstName = String(args.first_name || '').trim()
        const lastName = String(args.last_name || '').trim()
        const businessName = String(args.business_name || '').trim() || null
        const email = String(args.email || '').trim()
        const phone = normalizePhone(String(args.customer_phone || ''))
        const street1 = String(args.street_1 || '').trim()
        const city = String(args.city || '').trim()
        const state = String(args.state || 'CO').trim() || 'CO'
        const zipCode = String(args.zip_code || '').trim()
        const appointmentDate = String(args.appointment_date || '').trim()
        const startTime = String(args.start_time || '').trim()
        const slotToken = String(args.slot_token || '').trim()
        const jobDescription = String(args.job_description || '').trim() || null

        if (!firstName || !lastName || !email) {
          return JSON.stringify({
            error: 'first_name, last_name, and email are required',
          })
        }
        if (!phone) {
          return JSON.stringify({
            error:
              'customer_phone is required. Ask the customer for a 10-digit callback number.',
          })
        }
        if (!street1 || !city || !zipCode) {
          return JSON.stringify({
            error: 'street_1, city, and zip_code are required',
          })
        }
        if (!appointmentDate || !startTime || !slotToken) {
          return JSON.stringify({
            error: 'appointment_date, start_time, and slot_token are required',
          })
        }

        const estimateRequiredMinutes = applyAppointmentBuffer(60)
        const estimateStaffResult = await getStaffPrioritizedSlots({
          supabase,
          date: appointmentDate,
          requiredMinutes: estimateRequiredMinutes,
          maxResults: 48,
        })
        const estimateSlots = estimateStaffResult?.slots || []
        const estimateMatch = estimateSlots.find(
          (s) => normClock5(s.start_time) === normClock5(startTime),
        )
        if (!estimateMatch) {
          return JSON.stringify({
            error: `That start time is not available on ${appointmentDate}. Call get_calendar_slots with duration_minutes=60 first.`,
            suggested_slots: estimateSlots
              .slice(0, 8)
              .map((s) => s.start_time.slice(0, 5)),
          })
        }
        const estimateSlotTokenCheck = verifySlotToken(slotToken, {
          date: appointmentDate,
          startTime: estimateMatch.start_time,
          endTime: estimateMatch.end_time,
          requiredMinutes: estimateRequiredMinutes,
          ownerKey: ctx.rateLimitKey,
        })
        if (!estimateSlotTokenCheck.ok) {
          return JSON.stringify({
            error: `${estimateSlotTokenCheck.error} You must call get_calendar_slots and use the returned slot_token before booking a commercial walkthrough.`,
          })
        }

        const result = await createAiStyleEstimate({
          supabase,
          customer: {
            first_name: firstName,
            last_name: lastName,
            business_name: businessName,
            email,
            phone,
          },
          address: { street_1: street1, city, state, zip_code: zipCode },
          appointment_date: appointmentDate,
          start_time: startTime,
          visit_duration_minutes: 60,
          job_description: jobDescription,
          booking_channel: 'ai_agent',
          source_label: 'Scout Website Chat',
          actor_label: 'Scout Web',
          admin_heading: 'Scout website walkthrough',
        })

        if (!result.ok) {
          return JSON.stringify({
            error: result.error,
            ...(result.suggested_slots
              ? { suggested_slots: result.suggested_slots }
              : {}),
          })
        }

        return JSON.stringify({
          success: true,
          confirmation_number: result.confirmation_number,
          appointment_date: result.appointment_date,
          start_time: result.start_time,
          visit_duration_minutes: result.visit_duration_minutes,
          message: result.message,
        })
      }

      case 'notify_charles': {
        const reason = String(args.reason || '').trim()
        const customerName = String(args.customer_name || '').trim()
        const customerPhone = String(args.customer_phone || '').trim()
        const customerEmail = String(args.customer_email || '').trim()
        const conversationSummary = String(
          args.conversation_summary || '',
        ).trim()

        if (!reason || !conversationSummary) {
          return JSON.stringify({
            error: 'reason and conversation_summary are required',
          })
        }

        const resendKey = process.env.RESEND_API_KEY
        const toEmail = process.env.OWNER_ALERT_EMAIL
        const fromEmail =
          process.env.OPS_FROM_EMAIL || 'noreply@sasquatchcarpet.com'

        if (!resendKey || !toEmail) {
          console.warn(
            '[scout] notify_charles: RESEND_API_KEY or OWNER_ALERT_EMAIL not set',
          )
          return JSON.stringify({
            success: true,
            message:
              'Alert logged (email not configured — set RESEND_API_KEY and OWNER_ALERT_EMAIL in env).',
          })
        }

        const rows = [
          customerName &&
            `<tr><td><strong>Customer</strong></td><td>${customerName}</td></tr>`,
          customerPhone &&
            `<tr><td><strong>Phone</strong></td><td>${customerPhone}</td></tr>`,
          customerEmail &&
            `<tr><td><strong>Email</strong></td><td>${customerEmail}</td></tr>`,
        ]
          .filter(Boolean)
          .join('\n')

        const html = `
<h2 style="color:#c0392b;">Scout Alert</h2>
<p><strong>Reason:</strong> ${reason}</p>
${rows ? `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;margin:12px 0;">${rows}</table>` : ''}
<h3>Conversation Summary</h3>
<pre style="background:#f4f4f4;padding:12px;border-radius:4px;white-space:pre-wrap;">${conversationSummary}</pre>
<hr/>
<p style="color:#888;font-size:12px;">Sent automatically by Scout (Sasquatch website chat)</p>
`

        const resend = new Resend(resendKey)
        const { error: sendError } = await resend.emails.send({
          from: `Scout <${fromEmail}>`,
          to: toEmail,
          subject: `Scout Alert: ${reason.slice(0, 80)}`,
          html,
        })

        if (sendError) {
          console.error('[scout] notify_charles email error:', sendError)
          return JSON.stringify({
            error: 'Failed to send alert email. The issue has been logged.',
          })
        }

        return JSON.stringify({
          success: true,
          message: 'Charles has been notified by email.',
        })
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` })
    }
  } catch (e) {
    console.error('[Scout web tool]', name, e)
    return JSON.stringify({
      error: 'Action failed. The office can help at (719) 249-8791.',
    })
  }
}

export function isScoutWebToolsEnabled(): boolean {
  return process.env.SCOUT_WEB_TOOLS !== 'false'
}
