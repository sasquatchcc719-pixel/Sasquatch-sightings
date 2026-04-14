/**
 * Seed Recovery Village recurring job templates.
 *
 * This creates the templates + recurrence rules but does NOT generate
 * appointments yet. You should review the templates in the Recurring Jobs
 * UI first, then click "Regenerate" once you've cleaned up the old
 * haphazard imports from the calendar.
 *
 * Usage:
 *   pnpm tsx scripts/seed-recovery-village-recurring.ts
 *
 * Requires .env.local with SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL
 */

import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const RV_PHONE = '+17194605924'
const RV_EMAIL = 'ars_invoicecapture@concursolutions.com'

type TemplateSeed = {
  label: string
  line_items: Array<{
    name_snapshot: string
    quantity: number
    unit_price: number
    duration_minutes: number
  }>
  start_time: string
  scheduled_duration_minutes: number
  rules: Array<{
    frequency: 'weekly' | 'biweekly' | 'monthly' | 'custom'
    day_of_week?: number
    week_of_month?: number
    day_of_month?: number
    interval_days?: number
  }>
}

const TEMPLATES: TemplateSeed[] = [
  {
    label: 'RV - A Building Common Areas',
    line_items: [
      {
        name_snapshot:
          'LVM/Bonnet — A building downstairs common areas (2,251 sf @ $0.35)',
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
    start_time: '17:30',
    scheduled_duration_minutes: 270,
    rules: [{ frequency: 'monthly', day_of_week: 3, week_of_month: 2 }],
  },
  {
    label: 'RV - C Building Guest Rooms',
    line_items: [
      {
        name_snapshot:
          'Commercial carpet cleaning — C building guest rooms (3,922 sf @ $0.35/sf)',
        quantity: 1,
        unit_price: 1372.7,
        duration_minutes: 120,
      },
    ],
    start_time: '12:00',
    scheduled_duration_minutes: 300,
    rules: [{ frequency: 'monthly', day_of_week: 3, week_of_month: 4 }],
  },
  {
    label: 'RV - Dining Room + Yoga/Family',
    line_items: [
      {
        name_snapshot:
          'Auto scrubbing floors (LVT) — Dining room (2,500 sf @ $0.35)',
        quantity: 1,
        unit_price: 875,
        duration_minutes: 60,
      },
      {
        name_snapshot: 'LVM/Bonnet — Yoga room + family room (648 sf @ $0.35)',
        quantity: 1,
        unit_price: 226.8,
        duration_minutes: 60,
      },
    ],
    start_time: '17:00',
    scheduled_duration_minutes: 240,
    rules: [{ frequency: 'monthly', day_of_week: 0, week_of_month: 4 }],
  },
  {
    label: 'RV - Kitchen + Pantry',
    line_items: [
      {
        name_snapshot:
          'Auto scrubbing floors (LVT) — Kitchen + pantry (2,205 sf @ $0.35)',
        quantity: 1,
        unit_price: 771.75,
        duration_minutes: 120,
      },
    ],
    start_time: '17:00',
    scheduled_duration_minutes: 300,
    rules: [{ frequency: 'monthly', day_of_week: 3, week_of_month: 4 }],
  },
  {
    label: 'RV - D Building Rooms',
    line_items: [
      {
        name_snapshot:
          'Commercial carpet cleaning — D building, all client rooms (3,717 sf @ $0.35)',
        quantity: 1,
        unit_price: 1300.95,
        duration_minutes: 120,
      },
    ],
    start_time: '09:00',
    scheduled_duration_minutes: 300,
    rules: [{ frequency: 'monthly', day_of_week: 2, week_of_month: 1 }],
  },
  {
    label: 'RV - Rec Room + Fortitude',
    line_items: [
      {
        name_snapshot: 'LVM/Bonnet — Rec room + fortitude (1,434 sf @ $0.35)',
        quantity: 1,
        unit_price: 501.9,
        duration_minutes: 120,
      },
    ],
    start_time: '17:30',
    scheduled_duration_minutes: 270,
    rules: [{ frequency: 'monthly', day_of_week: 4, week_of_month: 2 }],
  },
  {
    label: 'RV - E Building Rooms',
    line_items: [
      {
        name_snapshot:
          'Commercial carpet cleaning — E building + all client rooms (3,559 sf @ $0.35)',
        quantity: 1,
        unit_price: 1245.65,
        duration_minutes: 120,
      },
    ],
    start_time: '09:00',
    scheduled_duration_minutes: 300,
    rules: [{ frequency: 'monthly', day_of_week: 4, week_of_month: 1 }],
  },
  {
    label: 'RV - Pressure Washing Exterior',
    line_items: [
      {
        name_snapshot:
          'Pressure washing — exterior concrete back of building + loading ramp',
        quantity: 1,
        unit_price: 1500,
        duration_minutes: 120,
      },
    ],
    start_time: '10:00',
    scheduled_duration_minutes: 300,
    rules: [{ frequency: 'custom', interval_days: 90 }],
  },
]

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required in .env.local',
    )
  }

  const supabase = createClient(url, key)

  const { data: customer } = await supabase
    .from('ops_customers')
    .select('id')
    .eq('phone', RV_PHONE)
    .maybeSingle()

  if (!customer) {
    console.error(
      'Recovery Village customer not found. Run the HCP import script first.',
    )
    process.exit(1)
  }

  const { data: addresses } = await supabase
    .from('ops_service_addresses')
    .select('id, street_1')
    .eq('customer_id', customer.id)

  const address = addresses?.[0]
  if (!address) {
    console.error('No service address found for Recovery Village.')
    process.exit(1)
  }

  console.log(`Found RV customer: ${customer.id}`)
  console.log(`Using address: ${address.id} (${address.street_1})`)

  const today = new Date().toISOString().slice(0, 10)

  for (const seed of TEMPLATES) {
    const { data: existing } = await supabase
      .from('ops_recurring_templates')
      .select('id')
      .eq('label', seed.label)
      .eq('customer_id', customer.id)
      .maybeSingle()

    if (existing) {
      console.warn(`Skip (already exists): ${seed.label}`)
      continue
    }

    const { data: template, error: tplErr } = await supabase
      .from('ops_recurring_templates')
      .insert({
        customer_id: customer.id,
        service_address_id: address.id,
        label: seed.label,
        line_items: seed.line_items,
        start_time: seed.start_time,
        scheduled_duration_minutes: seed.scheduled_duration_minutes,
        discount_amount: 0,
        internal_notes: 'Seeded from HCP import patterns',
        invoice_mode: 'batch_monthly',
        booking_channel: 'recurring',
        is_active: false,
      })
      .select('id')
      .single()

    if (tplErr || !template) {
      console.error(`Failed to create template ${seed.label}:`, tplErr?.message)
      continue
    }

    const rulesPayload = seed.rules.map((r) => ({
      template_id: template.id,
      frequency: r.frequency,
      day_of_week: r.day_of_week ?? null,
      week_of_month: r.week_of_month ?? null,
      day_of_month: r.day_of_month ?? null,
      interval_days: r.interval_days ?? null,
      effective_from: today,
      effective_until: null,
    }))

    const { error: rulesErr } = await supabase
      .from('ops_recurrence_rules')
      .insert(rulesPayload)

    if (rulesErr) {
      console.error(
        `Failed to create rules for ${seed.label}:`,
        rulesErr.message,
      )
      continue
    }

    console.log(`OK: ${seed.label} (${template.id}) — created as PAUSED`)
  }

  console.log('\nDone! Templates are created as PAUSED.')
  console.log(
    'Go to Operations → Recurring Jobs to review, adjust patterns, and activate.',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
