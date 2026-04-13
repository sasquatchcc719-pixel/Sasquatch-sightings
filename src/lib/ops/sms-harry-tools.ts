import type { SupabaseClient } from '@supabase/supabase-js'
import type OpenAI from 'openai'
import {
  applyAppointmentBuffer,
  calculateLineItemDurationMinutes,
  DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
  getAvailableSlots,
  type ExistingAppointmentWindow,
} from '@/lib/ops/availability'
import { createAiStyleBooking } from '@/lib/ops/create-ai-style-booking'

/** Today's date in Mountain Time (YYYY-MM-DD). Avoids UTC rollover at 6 PM MDT. */
function todayMountain(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
}

const UPCOMING_STATUSES = [
  'booked',
  'confirmed',
  'on_my_way',
  'in_progress',
  'pending_approval',
] as const

const TOOL_RATE_WINDOW_MS = 60_000
const TOOL_RATE_MAX = 20
const toolCallTimestamps = new Map<string, number[]>()

function checkToolRate(
  phone: string,
): { ok: true } | { ok: false; error: string } {
  const now = Date.now()
  const windowStart = now - TOOL_RATE_WINDOW_MS
  let stamps = toolCallTimestamps.get(phone) ?? []
  stamps = stamps.filter((t) => t > windowStart)
  if (stamps.length >= TOOL_RATE_MAX) {
    return {
      ok: false,
      error: 'Too many actions in a short time. Try again in a minute.',
    }
  }
  stamps.push(now)
  toolCallTimestamps.set(phone, stamps)
  return { ok: true }
}

export function phoneSearchVariants(e164: string): string[] {
  const trimmed = e164.trim()
  const digits = trimmed.replace(/\D/g, '')
  const last10 = digits.length >= 10 ? digits.slice(-10) : digits
  const out = new Set<string>()
  if (trimmed) out.add(trimmed)
  if (last10.length === 10) {
    out.add(`+1${last10}`)
    out.add(`+${last10}`)
    out.add(last10)
  }
  return [...out]
}

function last10Digits(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10)
}

function phoneMatchesInbound(
  inbound: string,
  dbPhone: string | null | undefined,
): boolean {
  if (!dbPhone) return false
  const a = last10Digits(inbound)
  const b = last10Digits(dbPhone)
  return a.length === 10 && b.length === 10 && a === b
}

function addMinutesToTime(value: string, minutesToAdd: number): string {
  const [hours, minutes] = value.split(':').map(Number)
  const total = hours * 60 + minutes + minutesToAdd
  const normalized = ((total % 1440) + 1440) % 1440
  const nextHours = Math.floor(normalized / 60)
  const nextMinutes = normalized % 60
  return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}:00`
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

async function loadAvailabilityBundle(
  supabase: SupabaseClient,
  date: string,
  excludeAppointmentId?: string,
): Promise<{
  templates: Parameters<typeof getAvailableSlots>[0]['templates']
  overrides: Parameters<typeof getAvailableSlots>[0]['overrides']
  appointments: ExistingAppointmentWindow[]
}> {
  const [templatesResult, overridesResult, appointmentsResult] =
    await Promise.all([
      supabase.from('availability_templates').select('*').eq('is_active', true),
      supabase
        .from('availability_overrides')
        .select('*')
        .eq('override_date', date),
      supabase
        .from('ops_appointments')
        .select('id, appointment_date, start_time, end_time, status')
        .eq('appointment_date', date),
    ])

  // Self-heal: if no active templates exist, re-seed defaults so booking
  // keeps working and the issue is logged for investigation.
  let templates = templatesResult.data || []
  if (templates.length === 0) {
    console.warn(
      '⚠️  No active availability_templates found — auto-seeding defaults',
    )
    const defaults = DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES.map((t) => ({
      day_of_week: t.day_of_week,
      start_time: t.start_time,
      end_time: t.end_time,
      slot_interval_minutes: t.slot_interval_minutes,
      is_active: true,
    }))
    const { data: seeded } = await supabase
      .from('availability_templates')
      .upsert(defaults, { onConflict: 'day_of_week' })
      .select('*')
    if (seeded && seeded.length > 0) templates = seeded
    else templates = DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES as typeof templates
  }

  let rows = (appointmentsResult.data || []) as Array<
    ExistingAppointmentWindow & { id: string }
  >
  if (excludeAppointmentId) {
    rows = rows.filter((a) => a.id !== excludeAppointmentId)
  }
  return {
    templates,
    overrides: overridesResult.data || [],
    appointments: rows.map(
      ({ appointment_date, start_time, end_time, status }) => ({
        appointment_date,
        start_time,
        end_time,
        status,
      }),
    ),
  }
}

async function customerOwnsAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
  inboundPhoneE164: string,
): Promise<
  | {
      ok: true
      appointment: {
        id: string
        customer_id: string
        service_address_id: string
        appointment_date: string
        start_time: string
        end_time: string
        status: string
      }
      customerPhone: string | null
    }
  | { ok: false; error: string }
> {
  const { data: row, error } = await supabase
    .from('ops_appointments')
    .select(
      `
      id,
      customer_id,
      service_address_id,
      appointment_date,
      start_time,
      end_time,
      status,
      ops_customers ( phone )
    `,
    )
    .eq('id', appointmentId)
    .maybeSingle()

  if (error || !row) {
    return { ok: false, error: 'Appointment not found.' }
  }

  const cust = row.ops_customers as { phone?: string | null } | null
  const customerPhone = cust?.phone ?? null
  if (!phoneMatchesInbound(inboundPhoneE164, customerPhone)) {
    return {
      ok: false,
      error:
        'That appointment is not linked to this phone number. Call the office if you need help.',
    }
  }

  return {
    ok: true,
    appointment: {
      id: row.id,
      customer_id: row.customer_id,
      service_address_id: row.service_address_id,
      appointment_date: row.appointment_date,
      start_time: row.start_time,
      end_time: row.end_time,
      status: row.status,
    },
    customerPhone,
  }
}

export type HarrySmsToolContext = {
  supabase: SupabaseClient
  customerPhoneE164: string
}

export const HARRY_SMS_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'list_my_upcoming_appointments',
      description:
        'List this customer\'s upcoming Ops jobs (matched by SMS phone). Use when they ask about "my appointment" or need an appointment_id.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_service_catalog',
      description:
        'Search active services by name to get service UUIDs for booking.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search text (e.g. carpet, upholstery)',
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
        'Get available start times for a calendar date (YYYY-MM-DD) in America/Denver scheduling.',
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
      name: 'update_job_address',
      description:
        'Update the service address on an existing upcoming job for this phone number.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          street_1: { type: 'string' },
          city: { type: 'string' },
          state: {
            type: 'string',
            description: 'Two-letter state, default CO',
          },
          zip_code: { type: 'string' },
        },
        required: ['appointment_id', 'street_1', 'city', 'zip_code'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reschedule_job',
      description:
        'Move an existing job to a new date and start time. Time must match an available slot from get_calendar_slots.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          new_appointment_date: { type: 'string', description: 'YYYY-MM-DD' },
          new_start_time: { type: 'string', description: 'HH:MM (24h)' },
        },
        required: ['appointment_id', 'new_appointment_date', 'new_start_time'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_job_line_items',
      description:
        'Replace the services/line items on an existing appointment. Use when the customer corrects job details after booking (wrong rooms, wrong services, wrong quantities). Recalculates price and duration.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
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
        },
        required: ['appointment_id', 'line_items'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_new_job',
      description:
        'Create a new Ops appointment for this SMS customer. Requires name, email, full address, catalog service IDs, and a slot time that appears in get_calendar_slots for that date. Phone is always taken from SMS automatically.',
      parameters: {
        type: 'object',
        properties: {
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          email: { type: 'string' },
          street_1: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          zip_code: { type: 'string' },
          appointment_date: { type: 'string' },
          start_time: { type: 'string' },
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
        },
        required: [
          'first_name',
          'last_name',
          'email',
          'street_1',
          'city',
          'zip_code',
          'appointment_date',
          'start_time',
          'line_items',
        ],
        additionalProperties: false,
      },
    },
  },
]

export async function executeHarrySmsTool(
  name: string,
  argsJson: string,
  ctx: HarrySmsToolContext,
): Promise<string> {
  const rl = checkToolRate(ctx.customerPhoneE164)
  if (!rl.ok) return JSON.stringify({ error: rl.error })

  const phoneVariants = phoneSearchVariants(ctx.customerPhoneE164)
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson || '{}') as Record<string, unknown>
  } catch {
    return JSON.stringify({ error: 'Invalid tool arguments' })
  }

  const { supabase } = ctx

  try {
    switch (name) {
      case 'list_my_upcoming_appointments': {
        let { data: customers, error: cErr } = await supabase
          .from('ops_customers')
          .select('id, full_name, phone')
          .in('phone', phoneVariants)

        if (cErr) throw cErr
        if (!customers?.length) {
          const last10 = last10Digits(ctx.customerPhoneE164)
          if (last10.length === 10) {
            const retry = await supabase
              .from('ops_customers')
              .select('id, full_name, phone')
              .ilike('phone', `%${last10}`)
            if (!retry.error && retry.data?.length) {
              customers = retry.data.filter(
                (c) => last10Digits(c.phone || '') === last10,
              )
            }
          }
        }
        if (!customers?.length) {
          return JSON.stringify({
            upcoming: [],
            message: 'No customer profile found for this phone yet.',
          })
        }

        const customerIds = customers.map((c) => c.id)
        const today = todayMountain()

        const { data: rows, error: aErr } = await supabase
          .from('ops_appointments')
          .select(
            `
            id,
            appointment_date,
            start_time,
            end_time,
            status,
            ops_service_addresses ( street_1, city, state, zip_code )
          `,
          )
          .in('customer_id', customerIds)
          .in('status', [...UPCOMING_STATUSES])
          .gte('appointment_date', today)
          .order('appointment_date', { ascending: true })
          .limit(20)

        if (aErr) throw aErr

        const upcoming = (rows || []).map((r) => {
          const addr = r.ops_service_addresses as {
            street_1?: string
            city?: string
            state?: string
            zip_code?: string
          } | null
          const addressLine = addr
            ? `${addr.street_1 || ''}, ${addr.city || ''}, ${addr.state || ''} ${addr.zip_code || ''}`.trim()
            : ''
          return {
            appointment_id: r.id,
            date: r.appointment_date,
            start_time: String(r.start_time || '').slice(0, 5),
            status: r.status,
            address: addressLine,
          }
        })

        return JSON.stringify({ upcoming })
      }

      case 'search_service_catalog': {
        const q = String(args.query || '')
          .trim()
          .replace(/[%_\\]/g, ' ')
          .slice(0, 80)
        if (!q) return JSON.stringify({ services: [], error: 'Empty query' })

        const { data: services, error } = await supabase
          .from('service_catalog_items')
          .select('id, name, category, base_price, default_duration_minutes')
          .eq('is_active', true)
          .ilike('name', `%${q}%`)
          .limit(15)

        if (error) throw error
        return JSON.stringify({
          services: (services || []).map((s) => ({
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

        const bundle = await loadAvailabilityBundle(supabase, date)
        const slots = getAvailableSlots({
          date,
          requiredMinutes,
          templates: bundle.templates,
          overrides: bundle.overrides,
          appointments: bundle.appointments,
          maxResults: 12,
        })

        return JSON.stringify({
          date,
          slots: slots.map((s) => ({
            start_time: s.start_time.slice(0, 5),
            end_time: s.end_time.slice(0, 5),
          })),
        })
      }

      case 'update_job_address': {
        const appointmentId = String(args.appointment_id || '').trim()
        const street1 = String(args.street_1 || '').trim()
        const city = String(args.city || '').trim()
        const state = String(args.state || 'CO').trim() || 'CO'
        const zipCode = String(args.zip_code || '').trim()
        if (!appointmentId || !street1 || !city || !zipCode) {
          return JSON.stringify({ error: 'Missing address fields' })
        }

        const owned = await customerOwnsAppointment(
          supabase,
          appointmentId,
          ctx.customerPhoneE164,
        )
        if (!owned.ok) return JSON.stringify({ error: owned.error })

        const oldAddrId = owned.appointment.service_address_id

        const { count: sharedCount } = await supabase
          .from('ops_appointments')
          .select('id', { count: 'exact', head: true })
          .eq('service_address_id', oldAddrId)
          .neq('id', appointmentId)

        if (sharedCount && sharedCount > 0) {
          const { data: newAddr, error: addrErr } = await supabase
            .from('ops_service_addresses')
            .insert({
              customer_id: owned.appointment.customer_id,
              street_1: street1,
              city,
              state,
              zip_code: zipCode,
              label: 'Service Address',
            })
            .select('id')
            .single()
          if (addrErr) throw addrErr

          const { error: linkErr } = await supabase
            .from('ops_appointments')
            .update({
              service_address_id: newAddr.id,
              updated_at: new Date().toISOString(),
            })
            .eq('id', appointmentId)
          if (linkErr) throw linkErr
        } else {
          const { error: uErr } = await supabase
            .from('ops_service_addresses')
            .update({
              street_1: street1,
              city,
              state,
              zip_code: zipCode,
              updated_at: new Date().toISOString(),
            })
            .eq('id', oldAddrId)
          if (uErr) throw uErr
        }

        await supabase.from('ops_appointment_status_events').insert({
          appointment_id: appointmentId,
          from_status: owned.appointment.status,
          to_status: owned.appointment.status,
          notes: `Address updated via Harry SMS → ${street1}, ${city}, ${state} ${zipCode}`,
        })

        return JSON.stringify({
          success: true,
          appointment_id: appointmentId,
          address: `${street1}, ${city}, ${state} ${zipCode}`,
        })
      }

      case 'reschedule_job': {
        const appointmentId = String(args.appointment_id || '').trim()
        const newDate = String(args.new_appointment_date || '').trim()
        const newStartRaw = String(args.new_start_time || '').trim()
        if (!appointmentId || !newDate || !newStartRaw) {
          return JSON.stringify({ error: 'Missing reschedule fields' })
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
          return JSON.stringify({
            error: 'new_appointment_date must be YYYY-MM-DD',
          })
        }

        const owned = await customerOwnsAppointment(
          supabase,
          appointmentId,
          ctx.customerPhoneE164,
        )
        if (!owned.ok) return JSON.stringify({ error: owned.error })

        const { data: lineRows, error: liErr } = await supabase
          .from('ops_appointment_line_items')
          .select('duration_minutes, quantity')
          .eq('appointment_id', appointmentId)

        if (liErr) throw liErr

        const totalMinutesFromLines = (lineRows || []).reduce(
          (sum, item) =>
            sum +
            calculateLineItemDurationMinutes({
              durationMinutes: Number(item.duration_minutes),
              quantity: Number(item.quantity),
            }),
          0,
        )
        const totalMinutesWithBuffer = applyAppointmentBuffer(
          totalMinutesFromLines || 120,
        )

        const bundle = await loadAvailabilityBundle(
          supabase,
          newDate,
          appointmentId,
        )
        const slots = getAvailableSlots({
          date: newDate,
          requiredMinutes: totalMinutesWithBuffer,
          templates: bundle.templates,
          overrides: bundle.overrides,
          appointments: bundle.appointments,
          maxResults: 48,
        })

        const wantStart = normClock5(newStartRaw)
        const match = slots.find((s) => normClock5(s.start_time) === wantStart)
        if (!match) {
          return JSON.stringify({
            error: `That start time is not available on ${newDate}. Call get_calendar_slots for that date first.`,
            suggested_slots: slots
              .slice(0, 8)
              .map((s) => s.start_time.slice(0, 5)),
          })
        }

        const nextStartDb = toDbTime(newStartRaw)
        const nextEndDb = addMinutesToTime(
          nextStartDb.slice(0, 5),
          totalMinutesWithBuffer,
        )

        const prevDate = owned.appointment.appointment_date
        const prevStart = owned.appointment.start_time

        const { error: upErr } = await supabase
          .from('ops_appointments')
          .update({
            appointment_date: newDate,
            start_time: nextStartDb,
            end_time: nextEndDb,
            updated_at: new Date().toISOString(),
          })
          .eq('id', appointmentId)

        if (upErr) throw upErr

        await supabase.from('ops_appointment_status_events').insert({
          appointment_id: appointmentId,
          from_status: owned.appointment.status,
          to_status: owned.appointment.status,
          notes: `Rescheduled via Harry SMS (${prevDate} ${String(prevStart).slice(0, 5)} → ${newDate} ${wantStart})`,
        })

        return JSON.stringify({
          success: true,
          appointment_id: appointmentId,
          new_appointment_date: newDate,
          new_start_time: wantStart,
        })
      }

      case 'update_job_line_items': {
        const appointmentId = String(args.appointment_id || '').trim()
        const newLineItems = Array.isArray(args.line_items)
          ? args.line_items
          : []

        if (!appointmentId) {
          return JSON.stringify({ error: 'appointment_id is required' })
        }
        if (!newLineItems.length) {
          return JSON.stringify({ error: 'line_items required' })
        }

        const owned = await customerOwnsAppointment(
          supabase,
          appointmentId,
          ctx.customerPhoneE164,
        )
        if (!owned.ok) return JSON.stringify({ error: owned.error })

        const parsedItems = newLineItems.map((row: unknown) => {
          const r = row as { service_id?: string; quantity?: number }
          return {
            service_id: String(r.service_id || '').trim(),
            quantity: Math.max(1, Number(r.quantity) || 1),
          }
        })

        const catalogIds = parsedItems.map((l) => l.service_id)
        const { data: catalogRows, error: catErr } = await supabase
          .from('service_catalog_items')
          .select('id, name, base_price, default_duration_minutes')
          .in('id', catalogIds)
          .eq('is_active', true)

        if (catErr || !catalogRows?.length) {
          return JSON.stringify({
            error: 'Could not find the requested services in the catalog.',
          })
        }

        const builtLines = parsedItems
          .map((req) => {
            const cat = catalogRows.find((c) => c.id === req.service_id)
            if (!cat) return null
            return {
              appointment_id: appointmentId,
              name_snapshot: cat.name,
              quantity: req.quantity,
              unit_price: Number(cat.base_price || 0),
              duration_minutes: cat.default_duration_minutes || 60,
              line_total: Number(cat.base_price || 0) * req.quantity,
            }
          })
          .filter(Boolean) as Array<{
          appointment_id: string
          name_snapshot: string
          quantity: number
          unit_price: number
          duration_minutes: number
          line_total: number
        }>

        if (!builtLines.length) {
          return JSON.stringify({
            error:
              'None of the requested services matched active catalog items.',
          })
        }

        // Delete old line items and insert new ones
        await supabase
          .from('ops_appointment_line_items')
          .delete()
          .eq('appointment_id', appointmentId)

        await supabase.from('ops_appointment_line_items').insert(builtLines)

        // Recalculate total and end_time
        const newTotal = builtLines.reduce((s, l) => s + l.line_total, 0)
        const totalMinutes = builtLines.reduce(
          (s, l) =>
            s +
            calculateLineItemDurationMinutes({
              durationMinutes: l.duration_minutes,
              quantity: l.quantity,
            }),
          0,
        )
        const buffered = applyAppointmentBuffer(totalMinutes || 120)
        const newEndTime = addMinutesToTime(
          owned.appointment.start_time.slice(0, 5),
          buffered,
        )

        await supabase
          .from('ops_appointments')
          .update({
            quoted_total: newTotal,
            end_time: newEndTime,
            updated_at: new Date().toISOString(),
          })
          .eq('id', appointmentId)

        // Also update the invoice if one exists
        const { data: invoice } = await supabase
          .from('ops_invoices')
          .select('id')
          .eq('appointment_id', appointmentId)
          .maybeSingle()

        if (invoice) {
          await supabase
            .from('ops_invoice_line_items')
            .delete()
            .eq('invoice_id', invoice.id)

          await supabase.from('ops_invoice_line_items').insert(
            builtLines.map((l) => ({
              invoice_id: invoice.id,
              description: l.name_snapshot,
              quantity: l.quantity,
              unit_price: l.unit_price,
              line_total: l.line_total,
            })),
          )

          await supabase
            .from('ops_invoices')
            .update({
              subtotal: newTotal,
              total: newTotal,
              updated_at: new Date().toISOString(),
            })
            .eq('id', invoice.id)
        }

        await supabase.from('ops_appointment_status_events').insert({
          appointment_id: appointmentId,
          from_status: owned.appointment.status,
          to_status: owned.appointment.status,
          notes: `Line items updated via Harry SMS. New total: $${newTotal.toFixed(2)}`,
        })

        return JSON.stringify({
          success: true,
          appointment_id: appointmentId,
          new_total: newTotal,
          services: builtLines.map((l) => ({
            name: l.name_snapshot,
            qty: l.quantity,
            price: l.unit_price * l.quantity,
          })),
        })
      }

      case 'book_new_job': {
        const firstName = String(args.first_name || '').trim()
        const lastName = String(args.last_name || '').trim()
        const email = String(args.email || '').trim()
        const street1 = String(args.street_1 || '').trim()
        const city = String(args.city || '').trim()
        const state = String(args.state || 'CO').trim() || 'CO'
        const zipCode = String(args.zip_code || '').trim()
        const appointmentDate = String(args.appointment_date || '').trim()
        const startTime = String(args.start_time || '').trim()
        const lineItems = Array.isArray(args.line_items) ? args.line_items : []

        if (!firstName || !lastName || !email) {
          return JSON.stringify({
            error: 'first_name, last_name, and email are required',
          })
        }
        if (!street1 || !city || !zipCode) {
          return JSON.stringify({
            error: 'street_1, city, and zip_code are required',
          })
        }
        if (!appointmentDate || !startTime) {
          return JSON.stringify({
            error: 'appointment_date and start_time are required',
          })
        }
        if (!lineItems.length) {
          return JSON.stringify({ error: 'line_items required' })
        }

        // Guard: prevent duplicate booking for same customer on same date
        const { data: existingCusts } = await supabase
          .from('ops_customers')
          .select('id')
          .in('phone', phoneVariants)

        if (existingCusts && existingCusts.length > 0) {
          const custIds = existingCusts.map((c) => c.id)
          const { data: existingAppts } = await supabase
            .from('ops_appointments')
            .select('id, start_time, status')
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
            const dup = existingAppts[0]
            return JSON.stringify({
              error: `This customer already has a booking on ${appointmentDate} (appointment_id: ${dup.id}). Use update_job_line_items to fix the services or reschedule_job to change the time. Do NOT create a duplicate.`,
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
          .select('id, default_duration_minutes')
          .in('id', catalogIds)
          .eq('is_active', true)

        const totalMinutes = (catalogRows || []).reduce((sum, row) => {
          const qty =
            parsedLineItems.find((p) => p.service_id === row.id)?.quantity ?? 1
          return (
            sum +
            calculateLineItemDurationMinutes({
              durationMinutes: Number(row.default_duration_minutes || 60),
              quantity: qty,
            })
          )
        }, 0)

        const requiredMinutes = applyAppointmentBuffer(totalMinutes || 120)
        const bundle = await loadAvailabilityBundle(supabase, appointmentDate)
        const slots = getAvailableSlots({
          date: appointmentDate,
          requiredMinutes,
          templates: bundle.templates,
          overrides: bundle.overrides,
          appointments: bundle.appointments,
          maxResults: 48,
        })

        const wantStart = normClock5(startTime)
        const slotOk = slots.some((s) => normClock5(s.start_time) === wantStart)
        if (!slotOk) {
          return JSON.stringify({
            error: `That start time is not available on ${appointmentDate}. Use get_calendar_slots with duration matching the services first.`,
            suggested_slots: slots
              .slice(0, 8)
              .map((s) => s.start_time.slice(0, 5)),
          })
        }

        const bookingMode =
          process.env.HARRY_SMS_BOOKING_MODE === 'request'
            ? 'request'
            : 'direct'

        const result = await createAiStyleBooking({
          supabase,
          customer: {
            first_name: firstName,
            last_name: lastName,
            email,
            phone: ctx.customerPhoneE164,
          },
          address: { street_1: street1, city, state, zip_code: zipCode },
          appointment_date: appointmentDate,
          start_time: startTime,
          line_items: parsedLineItems,
          booking_mode: bookingMode,
          booking_channel: 'sms_harry',
          source_label: 'Harry SMS',
          lead_source: 'Harry SMS Assistant',
          actor_label: 'Harry SMS',
          admin_heading: 'Harry SMS booking',
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

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` })
    }
  } catch (e) {
    console.error('[Harry SMS tool]', name, e)
    return JSON.stringify({
      error: 'Action failed. The office can help at (719) 249-8791.',
    })
  }
}

export function isHarrySmsOpsToolsEnabled(): boolean {
  return process.env.HARRY_SMS_OPS_TOOLS !== 'false'
}
