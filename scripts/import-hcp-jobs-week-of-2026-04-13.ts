/**
 * One-off: mirror HouseCall Pro jobs into ops (customers, addresses, appointments, invoices).
 * Skips availability checks (same as manual calendar block).
 * Does NOT call sendOpsLifecycleCommunications — keep job_scheduled templates off or confirm before run.
 *
 * Usage (from Sasquatch Sightings repo root):
 *   pnpm tsx scripts/import-hcp-jobs-week-of-2026-04-13.ts
 *
 * Requires .env.local with SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL (or DATABASE_URL pattern used by server client).
 */

import dotenv from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** Service-role client for one-off scripts (no generated Database types in this repo). */
type ScriptSupabase = SupabaseClient<any, 'public', any>
import {
  applyAppointmentBuffer,
  calculateLineItemDurationMinutes,
} from '@/lib/ops/availability'
import {
  buildQuickBooksCustomerPayload,
  buildQuickBooksInvoicePayload,
  getQuickBooksSyncStatus,
} from '@/lib/quickbooks'

dotenv.config({ path: '.env.local' })

function addMinutesToTime(value: string, minutesToAdd: number): string {
  const [hours, minutes] = value.split(':').map(Number)
  const total = hours * 60 + minutes + minutesToAdd
  const normalized = ((total % 1440) + 1440) % 1440
  const nextHours = Math.floor(normalized / 60)
  const nextMinutes = normalized % 60
  return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}:00`
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}

type LineIn = {
  name_snapshot: string
  quantity: number
  unit_price: number
  duration_minutes: number
  buffer_minutes?: number
  notes?: string | null
}

type JobIn = {
  first_name: string
  last_name: string
  business_name?: string | null
  email: string
  phone: string
  street_1: string
  city: string
  state: string
  zip_code: string
  appointment_date: string
  start_time: string
  lines: LineIn[]
  discount_amount?: number
  internal_notes: string
}

const JOBS: JobIn[] = [
  {
    first_name: 'Jolie',
    last_name: 'Larder',
    email: 'jolie.larder.hcp@import.local',
    phone: normalizePhone('303-478-9527'),
    street_1: '1572 Piney Hill Point',
    city: 'Monument',
    state: 'CO',
    zip_code: '80132',
    appointment_date: '2026-04-13',
    start_time: '09:00',
    lines: [
      {
        name_snapshot: 'Standard Carpet Cleaning (HCP #18042)',
        quantity: 1,
        unit_price: 161,
        duration_minutes: 120,
      },
    ],
    internal_notes:
      'HCP import 2026-04-13. Standard carpet cleaning. Total $161.',
  },
  {
    first_name: 'Recovery',
    last_name: 'Village',
    business_name: 'Recovery Village',
    email: 'ars_invoicecapture@concursolutions.com',
    phone: normalizePhone('719-460-5924'),
    street_1: '443 Highway 105',
    city: 'Palmer Lake',
    state: 'CO',
    zip_code: '80133',
    appointment_date: '2026-04-13',
    start_time: '17:30',
    lines: [
      {
        name_snapshot:
          'Low Moisture Encapsulation LVM/Bonnet — building downstairs common areas (2251 units @ $0.35)',
        quantity: 1,
        unit_price: 787.85,
        duration_minutes: 90,
      },
      {
        name_snapshot: 'Step Carpet Cleaning (34 steps @ $4)',
        quantity: 1,
        unit_price: 136,
        duration_minutes: 30,
      },
    ],
    internal_notes:
      'HCP commercial import. Recurring monthly on HCP — not modeled in Sightings yet. Subtotal $923.85. Notifications off in HCP.',
  },
  {
    first_name: 'Stephanie',
    last_name: 'Be',
    email: 'stephanie.be.hcp@import.local',
    phone: normalizePhone('719-499-8844'),
    street_1: '1245 Old Antlers Way',
    city: 'Monument',
    state: 'CO',
    zip_code: '80132',
    appointment_date: '2026-04-16',
    start_time: '09:00',
    discount_amount: 40,
    lines: [
      {
        name_snapshot: 'Regular size room (6 × $46)',
        quantity: 6,
        unit_price: 46,
        duration_minutes: 10,
      },
      {
        name_snapshot: 'Step Carpet Cleaning (15 steps × $4)',
        quantity: 15,
        unit_price: 4,
        duration_minutes: 4,
      },
    ],
    internal_notes:
      'HCP import. 6 regular rooms + 15 steps. Subtotal $336, $40 discount → $296.',
  },
  {
    first_name: 'Pam',
    last_name: 'Lively',
    email: 'pam.lively.hcp@import.local',
    phone: normalizePhone('719-330-0139'),
    street_1: '18357 Heavens Pl',
    city: 'Monument',
    state: 'CO',
    zip_code: '80132',
    appointment_date: '2026-04-17',
    start_time: '10:00',
    lines: [
      {
        name_snapshot: 'Regular size room (5 × $46)',
        quantity: 5,
        unit_price: 46,
        duration_minutes: 10,
      },
      {
        name_snapshot: 'Sasquatch size room (2 × $90)',
        quantity: 2,
        unit_price: 90,
        duration_minutes: 15,
      },
      {
        name_snapshot: 'Step Carpet Cleaning (15 steps × $4)',
        quantity: 15,
        unit_price: 4,
        duration_minutes: 2,
      },
      {
        name_snapshot: 'Urine Eliminator / pet treatment (2 rooms × $25)',
        quantity: 2,
        unit_price: 25,
        duration_minutes: 4,
      },
      {
        name_snapshot: 'Runner cleaning (38 ft — per HCP line)',
        quantity: 1,
        unit_price: 60,
        duration_minutes: 2,
      },
    ],
    internal_notes:
      'HCP import. 15 steps, 5 regular, 2 Sasquatch, 2 pet treatment rooms, 38 ft runners. Total $580.',
  },
  {
    first_name: 'Lindsey',
    last_name: 'Wright',
    email: 'lindsey.wright.hcp@import.local',
    phone: normalizePhone('719-299-1983'),
    street_1: '350 Park St',
    city: 'Palmer Lake',
    state: 'CO',
    zip_code: '80133',
    appointment_date: '2026-04-17',
    start_time: '13:00',
    lines: [
      {
        name_snapshot: 'Regular size room (2 × $46)',
        quantity: 2,
        unit_price: 46,
        duration_minutes: 20,
      },
      {
        name_snapshot: 'Hall/Bathroom/Closet Carpet (small area ~$25)',
        quantity: 1,
        unit_price: 25,
        duration_minutes: 15,
      },
      {
        name_snapshot: 'Step Carpet Cleaning (1 step × $4)',
        quantity: 1,
        unit_price: 4,
        duration_minutes: 5,
      },
      {
        name_snapshot: 'Urine Eliminator Treatment (2 areas × $25)',
        quantity: 2,
        unit_price: 25,
        duration_minutes: 15,
      },
      {
        name_snapshot: 'Pre-Vacuuming (2 rooms × $10)',
        quantity: 2,
        unit_price: 10,
        duration_minutes: 15,
      },
    ],
    internal_notes:
      'HCP import. 2 regular, 1 hallway, 1 step (verify stairway on site), 2 pet areas, pre-vac 2 rooms. Total $191.',
  },

  // Week of Apr 19–25, 2026 (HCP calendar + detail screenshots)
  {
    first_name: 'Michelle',
    last_name: 'Bogle',
    email: 'michelle.bogle.hcp@import.local',
    phone: normalizePhone('208-534-8190'),
    street_1: '1280 Almagre Peak Dr',
    city: 'Monument',
    state: 'CO',
    zip_code: '80132',
    appointment_date: '2026-04-22',
    start_time: '10:00',
    lines: [
      {
        name_snapshot: 'Sasquatch size room (200–400 sq ft) × 1',
        quantity: 1,
        unit_price: 90,
        duration_minutes: 40,
      },
      {
        name_snapshot: 'Step Carpet Cleaning (13 steps × $4)',
        quantity: 13,
        unit_price: 4,
        duration_minutes: 4,
      },
      {
        name_snapshot: 'Urine Eliminator / pet treatment (2 areas × $25)',
        quantity: 2,
        unit_price: 25,
        duration_minutes: 14,
      },
    ],
    internal_notes:
      'HCP import wk 4/19–25. 1 Sasquatch room + 13 steps + 2 pet areas. Total $192.',
  },
  {
    first_name: 'Recovery',
    last_name: 'Village',
    business_name: 'Recovery Village',
    email: 'ars_invoicecapture@concursolutions.com',
    phone: normalizePhone('719-460-5924'),
    street_1: '443 Highway 105',
    city: 'Palmer Lake',
    state: 'CO',
    zip_code: '80133',
    appointment_date: '2026-04-22',
    start_time: '12:00',
    lines: [
      {
        name_snapshot:
          'Commercial carpet cleaning — C building guest rooms (3,922 sf @ $0.35/sf = $1,372.70, per HCP)',
        quantity: 1,
        unit_price: 1372.7,
        duration_minutes: 120,
      },
    ],
    internal_notes:
      'HCP import wk 4/19–25. Commercial line only $1,372.70. Recurring billing on HCP — not modeled in Sightings.',
  },
  {
    first_name: 'Matt',
    last_name: 'Schroeder',
    email: 'matt.schroeder.hcp@import.local',
    phone: normalizePhone('719-761-9672'),
    street_1: '406 Durango Way',
    city: 'Palmer Lake',
    state: 'CO',
    zip_code: '80133',
    appointment_date: '2026-04-25',
    start_time: '09:00',
    lines: [
      {
        name_snapshot: 'Regular size room (100–200 sq ft) × 4',
        quantity: 4,
        unit_price: 46,
        duration_minutes: 10,
      },
      {
        name_snapshot: 'Hall / walk-in closet (50–100 sq ft) × 1',
        quantity: 1,
        unit_price: 25,
        duration_minutes: 10,
      },
      {
        name_snapshot: 'Monster size room (400–600 sq ft) × 1',
        quantity: 1,
        unit_price: 138,
        duration_minutes: 70,
      },
    ],
    internal_notes:
      'HCP import wk 4/19–25. Per HCP quantities: 4 regular, 1 hall, 1 monster; 0 stairs/Sasquatch/pet. Total $347.',
  },

  // Week of Apr 26 – May 2, 2026
  {
    first_name: 'Recovery',
    last_name: 'Village',
    business_name: 'Recovery Village',
    email: 'ars_invoicecapture@concursolutions.com',
    phone: normalizePhone('719-460-5924'),
    street_1: '443 Highway 105',
    city: 'Palmer Lake',
    state: 'CO',
    zip_code: '80133',
    appointment_date: '2026-04-26',
    start_time: '17:00',
    lines: [
      {
        name_snapshot:
          'Auto scrubbing floors (LVT/Vinyl/Epoxy) — Dining room LVT (2,500 sf @ $0.35 = $875)',
        quantity: 1,
        unit_price: 875,
        duration_minutes: 60,
      },
      {
        name_snapshot:
          'Low Moisture Encapsulation LVM/Bonnet — Yoga room + family room (648 sf @ $0.35 = $226.80)',
        quantity: 1,
        unit_price: 226.8,
        duration_minutes: 60,
      },
    ],
    internal_notes:
      'HCP import wk 4/26–5/2. Sun 4/26 5pm. Subtotal $1,101.80 per estimate screenshot. Recurring — not modeled as series in Sightings.',
  },
  {
    first_name: 'Recovery',
    last_name: 'Village',
    business_name: 'Recovery Village',
    email: 'ars_invoicecapture@concursolutions.com',
    phone: normalizePhone('719-460-5924'),
    street_1: '443 Highway 105',
    city: 'Palmer Lake',
    state: 'CO',
    zip_code: '80133',
    appointment_date: '2026-04-29',
    start_time: '17:00',
    lines: [
      {
        name_snapshot:
          'Auto scrubbing floors (LVT/Vinyl/Epoxy) — Kitchen + pantry (2,205 sf @ $0.35 = $771.75)',
        quantity: 1,
        unit_price: 771.75,
        duration_minutes: 120,
      },
    ],
    internal_notes:
      'HCP import wk 4/26–5/2. Wed 4/29 5pm. $771.75 per estimate screenshot. Recurring.',
  },
  {
    first_name: 'Keri',
    last_name: 'Winters',
    email: 'keri.winters.hcp@import.local',
    phone: normalizePhone('720-733-0711'),
    street_1: '15581 Lacuna Dr',
    city: 'Monument',
    state: 'CO',
    zip_code: '80132',
    appointment_date: '2026-04-30',
    start_time: '12:00',
    lines: [
      {
        name_snapshot: 'Regular size room (100–200 sq ft) × 4',
        quantity: 4,
        unit_price: 46,
        duration_minutes: 20,
      },
      {
        name_snapshot: 'Hall / walk-in closet (50–100 sq ft) × 1',
        quantity: 1,
        unit_price: 25,
        duration_minutes: 20,
      },
      {
        name_snapshot: 'Step / landing (1 step × $4)',
        quantity: 1,
        unit_price: 4,
        duration_minutes: 20,
      },
    ],
    internal_notes:
      'HCP import wk 4/26–5/2. Job #18052. 4 regular + 1 hall + 1 step. Total $213.',
  },

  // Week of May 3–9, 2026
  {
    first_name: 'Recovery',
    last_name: 'Village',
    business_name: 'Recovery Village',
    email: 'ars_invoicecapture@concursolutions.com',
    phone: normalizePhone('719-460-5924'),
    street_1: '443 Highway 105',
    city: 'Palmer Lake',
    state: 'CO',
    zip_code: '80133',
    appointment_date: '2026-05-05',
    start_time: '09:00',
    lines: [
      {
        name_snapshot:
          'Commercial carpet cleaning — D building, all client rooms (3,717 sf @ $0.35 = $1,300.95, HCP #12513)',
        quantity: 1,
        unit_price: 1300.95,
        duration_minutes: 120,
      },
    ],
    internal_notes:
      'HCP import wk 5/3–9. Tue 5/5 9–11am. D building scope per HCP estimate.',
  },

  // Week of May 10–16, 2026
  {
    first_name: 'Dan',
    last_name: 'Martindale',
    email: 'dan.martindale.hcp@import.local',
    phone: normalizePhone('719-338-1999'),
    street_1: '130 Star View Cir',
    city: 'Palmer Lake',
    state: 'CO',
    zip_code: '80133',
    appointment_date: '2026-05-11',
    start_time: '09:00',
    lines: [
      {
        name_snapshot:
          'Rug cleaning — Rug 8x11 Wool or Polyester (qty 2 @ $70, HCP #18028)',
        quantity: 2,
        unit_price: 70,
        duration_minutes: 30,
      },
      {
        name_snapshot: 'Rug cleaning — Runner 2.5×8 (qty 2 @ $20)',
        quantity: 2,
        unit_price: 20,
        duration_minutes: 30,
      },
    ],
    internal_notes:
      'HCP import wk 5/10–16. Mon 5/11 9–11am. Rug job. Total $180.',
  },
  {
    first_name: 'Kelly',
    last_name: 'Matice',
    email: 'kelly.mattice333@gmail.com',
    phone: normalizePhone('719-330-4946'),
    street_1: '2088 Turnbull Dr',
    city: 'Colorado Springs',
    state: 'CO',
    zip_code: '80921',
    appointment_date: '2026-05-11',
    start_time: '12:00',
    lines: [
      {
        name_snapshot:
          'Standard Carpet Cleaning (HCP #18046) — 3 regular + 1 hall + 1 Sasquatch, total per HCP',
        quantity: 1,
        unit_price: 313,
        duration_minutes: 120,
      },
    ],
    internal_notes:
      'HCP import wk 5/10–16. Mon 5/11 12:00–2:00 PM. Job #18046. Subtotal $313 tax $0.',
  },
  {
    first_name: 'Recovery',
    last_name: 'Village',
    business_name: 'Recovery Village',
    email: 'ars_invoicecapture@concursolutions.com',
    phone: normalizePhone('719-460-5924'),
    street_1: '443 Highway 105',
    city: 'Palmer Lake',
    state: 'CO',
    zip_code: '80133',
    appointment_date: '2026-05-13',
    start_time: '17:30',
    lines: [
      {
        name_snapshot:
          'LVM/Bonnet — A building downstairs common areas (2,251 sf @ $0.35 = $787.85, HCP #12476)',
        quantity: 1,
        unit_price: 787.85,
        duration_minutes: 60,
      },
      {
        name_snapshot: 'Step carpet cleaning (34 steps × $4 = $136)',
        quantity: 1,
        unit_price: 136,
        duration_minutes: 60,
      },
    ],
    internal_notes:
      'HCP import wk 5/10–16. Wed 5/13 5:30–7:30pm. Same scope pattern as prior A-building job. Subtotal $923.85.',
  },
  {
    first_name: 'Recovery',
    last_name: 'Village',
    business_name: 'Recovery Village',
    email: 'ars_invoicecapture@concursolutions.com',
    phone: normalizePhone('719-460-5924'),
    street_1: '443 Highway 105',
    city: 'Palmer Lake',
    state: 'CO',
    zip_code: '80133',
    appointment_date: '2026-05-14',
    start_time: '17:30',
    lines: [
      {
        name_snapshot:
          'LVM/Bonnet — rec room + fortitude (1,434 sf @ $0.35 = $501.90, HCP #12489)',
        quantity: 1,
        unit_price: 501.9,
        duration_minutes: 120,
      },
    ],
    internal_notes: 'HCP import wk 5/10–16. Thu 5/14 5:30–7:30pm.',
  },

  // Week of May 24–30, 2026
  {
    first_name: 'Recovery',
    last_name: 'Village',
    business_name: 'Recovery Village',
    email: 'ars_invoicecapture@concursolutions.com',
    phone: normalizePhone('719-460-5924'),
    street_1: '443 Highway 105',
    city: 'Palmer Lake',
    state: 'CO',
    zip_code: '80133',
    appointment_date: '2026-05-25',
    start_time: '10:00',
    lines: [
      {
        name_snapshot:
          'Pressure washing — exterior concrete back of building + loading ramp (HCP #12457)',
        quantity: 1,
        unit_price: 1500,
        duration_minutes: 120,
      },
    ],
    internal_notes:
      'HCP import wk 5/24–30. Memorial Day Mon 5/25 10am–12pm. $1,500.',
  },
  {
    first_name: 'Recovery',
    last_name: 'Village',
    business_name: 'Recovery Village',
    email: 'ars_invoicecapture@concursolutions.com',
    phone: normalizePhone('719-460-5924'),
    street_1: '443 Highway 105',
    city: 'Palmer Lake',
    state: 'CO',
    zip_code: '80133',
    appointment_date: '2026-05-26',
    start_time: '17:30',
    lines: [
      {
        name_snapshot:
          'Auto scrubbing LVT — Dining room (2,500 sf @ $0.35 = $875, HCP #12443)',
        quantity: 1,
        unit_price: 875,
        duration_minutes: 60,
      },
      {
        name_snapshot:
          'LVM/Bonnet — Yoga room + family room (648 sf @ $0.35 = $226.80)',
        quantity: 1,
        unit_price: 226.8,
        duration_minutes: 60,
      },
    ],
    internal_notes:
      'HCP import wk 5/24–30. Tue 5/26 5:30–7:30pm. Subtotal $1,101.80. If this estimate belongs to Fri instead, swap in ops.',
  },
  {
    first_name: 'Recovery',
    last_name: 'Village',
    business_name: 'Recovery Village',
    email: 'ars_invoicecapture@concursolutions.com',
    phone: normalizePhone('719-460-5924'),
    street_1: '443 Highway 105',
    city: 'Palmer Lake',
    state: 'CO',
    zip_code: '80133',
    appointment_date: '2026-05-29',
    start_time: '17:30',
    lines: [
      {
        name_snapshot:
          'Auto scrubbing LVT — Kitchen + pantry (2,205 sf @ $0.35 = $771.75, HCP #12430)',
        quantity: 1,
        unit_price: 771.75,
        duration_minutes: 120,
      },
    ],
    internal_notes:
      'HCP import wk 5/24–30. Fri 5/29 5:30–7:30pm. If estimate #12443 belongs here, swap line items with Tue in ops.',
  },

  // Week of May 31 – June 6, 2026
  {
    first_name: 'Recovery',
    last_name: 'Village',
    business_name: 'Recovery Village',
    email: 'ars_invoicecapture@concursolutions.com',
    phone: normalizePhone('719-460-5924'),
    street_1: '443 Highway 105',
    city: 'Palmer Lake',
    state: 'CO',
    zip_code: '80133',
    appointment_date: '2026-06-04',
    start_time: '09:00',
    lines: [
      {
        name_snapshot:
          'Commercial carpet cleaning — E building + all client rooms (3,559 sf @ $0.35 = $1,245.65, HCP #12518)',
        quantity: 1,
        unit_price: 1245.65,
        duration_minutes: 120,
      },
    ],
    internal_notes:
      'HCP import wk 5/31–6/6. Thu 6/4 9–11am. Commercial line per HCP.',
  },
]

async function upsertCustomer(
  supabase: ScriptSupabase,
  job: JobIn,
): Promise<string> {
  const phone = job.phone
  const fullName = [job.first_name, job.last_name].filter(Boolean).join(' ')
  const { data: existing } = await supabase
    .from('ops_customers')
    .select('id')
    .eq('phone', phone)
    .maybeSingle()

  if (existing?.id) {
    await supabase
      .from('ops_customers')
      .update({
        full_name: fullName,
        first_name: job.first_name,
        last_name: job.last_name,
        business_name: job.business_name ?? null,
        email: job.email,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
    return existing.id
  }

  const { data, error } = await supabase
    .from('ops_customers')
    .insert({
      full_name: fullName,
      first_name: job.first_name,
      last_name: job.last_name,
      business_name: job.business_name ?? null,
      email: job.email,
      phone,
      notes: 'Created by scripts/import-hcp-jobs-week-of-2026-04-13.ts',
    })
    .select('id')
    .single()

  if (error) throw error
  return data!.id
}

async function insertAppointmentForJob(
  supabase: ScriptSupabase,
  job: JobIn,
  customerId: string,
) {
  const normalizedLines = job.lines.map((item) => {
    const qty = Number(item.quantity)
    const unit = Number(item.unit_price)
    const dur = Number(item.duration_minutes)
    const buf = Number(item.buffer_minutes ?? 0)
    const lineTotal = Math.round(qty * unit * 100) / 100
    return {
      service_catalog_item_id: null as string | null,
      name_snapshot: item.name_snapshot,
      quantity: qty,
      unit_price: unit,
      duration_minutes: dur,
      buffer_minutes: buf,
      line_total: lineTotal,
      notes: item.notes ?? null,
    }
  })

  const totalMinutes = normalizedLines.reduce(
    (sum, item) =>
      sum +
      calculateLineItemDurationMinutes({
        durationMinutes: item.duration_minutes,
        quantity: item.quantity,
      }),
    0,
  )
  if (totalMinutes <= 0) {
    throw new Error(`No duration for job ${job.first_name} ${job.last_name}`)
  }

  const totalMinutesWithBuffer = applyAppointmentBuffer(totalMinutes)
  const startRaw = job.start_time
  const normalizedStart = `${startRaw}:00`.slice(0, 8)
  const quotedSubtotal = normalizedLines.reduce((s, l) => s + l.line_total, 0)
  const discountAmount = Math.max(0, job.discount_amount ?? 0)
  const quotedTotal = Math.max(0, quotedSubtotal - discountAmount)

  const { data: address, error: addrErr } = await supabase
    .from('ops_service_addresses')
    .insert({
      customer_id: customerId,
      label: job.business_name
        ? 'Commercial / service address'
        : 'Service Address',
      street_1: job.street_1,
      city: job.city,
      state: job.state,
      zip_code: job.zip_code,
      notes: null,
    })
    .select()
    .single()
  if (addrErr) throw addrErr

  const syncStatus = getQuickBooksSyncStatus()

  const { data: appointment, error: apptErr } = await supabase
    .from('ops_appointments')
    .insert({
      customer_id: customerId,
      service_address_id: address.id,
      booking_channel: 'admin',
      source: 'housecallpro_import',
      status: 'booked',
      payment_status: 'unpaid',
      quickbooks_sync_status: syncStatus,
      appointment_date: job.appointment_date,
      start_time: normalizedStart,
      end_time: addMinutesToTime(startRaw, totalMinutesWithBuffer),
      quoted_total: Number(quotedTotal.toFixed(2)),
      internal_notes: job.internal_notes,
    })
    .select()
    .single()
  if (apptErr) throw apptErr

  const appointmentLinesPayload = normalizedLines.map((item) => ({
    appointment_id: appointment.id,
    service_catalog_item_id: item.service_catalog_item_id,
    name_snapshot: item.name_snapshot,
    quantity: item.quantity,
    unit_price: item.unit_price,
    duration_minutes: item.duration_minutes,
    buffer_minutes: item.buffer_minutes,
    line_total: item.line_total,
    notes: item.notes,
  }))

  const { data: appointmentLines, error: lineErr } = await supabase
    .from('ops_appointment_line_items')
    .insert(appointmentLinesPayload)
    .select()
  if (lineErr) throw lineErr

  const { data: invoice, error: invErr } = await supabase
    .from('ops_invoices')
    .insert({
      appointment_id: appointment.id,
      status: 'draft',
      payment_status: 'unpaid',
      subtotal: Number(quotedSubtotal.toFixed(2)),
      discount_amount: Number(discountAmount.toFixed(2)),
      total: Number(quotedTotal.toFixed(2)),
      sync_status: syncStatus,
    })
    .select()
    .single()
  if (invErr) throw invErr

  const invoiceLinesPayload = (appointmentLines || []).map((item) => ({
    invoice_id: invoice.id,
    appointment_line_item_id: item.id,
    description: item.name_snapshot,
    quantity: item.quantity,
    unit_price: item.unit_price,
    line_total: item.line_total,
  }))

  if (invoiceLinesPayload.length > 0) {
    const { error: invLineErr } = await supabase
      .from('ops_invoice_line_items')
      .insert(invoiceLinesPayload)
    if (invLineErr) throw invLineErr
  }

  const fullName = [job.first_name, job.last_name].filter(Boolean).join(' ')

  await Promise.all([
    supabase.from('ops_appointment_status_events').insert({
      appointment_id: appointment.id,
      from_status: null,
      to_status: 'booked',
      changed_by: null,
      notes: 'Imported from HouseCall Pro (script)',
    }),
    supabase.from('ops_invoice_status_events').insert({
      invoice_id: invoice.id,
      from_status: null,
      to_status: 'draft',
      changed_by: null,
      notes: 'Draft from HCP import script',
    }),
    supabase.from('ops_quickbooks_sync_jobs').insert([
      {
        entity_type: 'customer',
        entity_id: customerId,
        status: syncStatus,
        payload: buildQuickBooksCustomerPayload({
          customerId,
          fullName,
          email: job.email,
          phone: job.phone,
          address: {
            street_1: job.street_1,
            city: job.city,
            state: job.state,
            zip_code: job.zip_code,
          },
        }),
      },
      {
        entity_type: 'invoice',
        entity_id: invoice.id,
        status: syncStatus,
        payload: buildQuickBooksInvoicePayload({
          invoiceId: invoice.id,
          customerId,
          serviceDate: job.appointment_date,
          subtotal: Number(invoice.subtotal),
          total: Number(invoice.total),
          lineItems: invoiceLinesPayload,
        }),
      },
    ]),
  ])

  return { appointmentId: appointment.id, invoiceId: invoice.id, quotedTotal }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required in .env.local',
    )
  }

  const supabase = createClient(url, key) as ScriptSupabase

  for (const job of JOBS) {
    const startNormalized = `${job.start_time}:00`.slice(0, 8)
    const { data: sameSlot } = await supabase
      .from('ops_appointments')
      .select('id, customer_id')
      .eq('appointment_date', job.appointment_date)
      .eq('start_time', startNormalized)

    let already = false
    for (const row of sameSlot || []) {
      const { data: cust } = await supabase
        .from('ops_customers')
        .select('phone')
        .eq('id', row.customer_id)
        .maybeSingle()
      if (cust?.phone === job.phone) {
        already = true
        break
      }
    }

    if (already) {
      console.warn(
        `Skip (already exists same date/start/phone): ${job.first_name} ${job.last_name} ${job.appointment_date} ${job.start_time}`,
      )
      continue
    }

    const customerId = await upsertCustomer(supabase, job)
    const result = await insertAppointmentForJob(supabase, job, customerId)
    console.log(
      `OK ${job.first_name} ${job.last_name} ${job.appointment_date} ${job.start_time} → appt ${result.appointmentId} total $${result.quotedTotal}`,
    )
  }

  console.log('Done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
