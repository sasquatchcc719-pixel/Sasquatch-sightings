import type { SupabaseClient } from '@supabase/supabase-js'
import { opsPhoneLookupVariants } from '@/lib/ops/phone'

const ADMIN_BASE_URL = 'https://sightings.sasquatchcarpet.com'

type CustomerRow = {
  id: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
  business_name: string | null
  email: string | null
  phone: string | null
}

type AddressRow = {
  street_1: string | null
  street_2: string | null
  city: string | null
  state: string | null
  zip_code: string | null
}

type AppointmentRow = {
  id: string
  appointment_date: string
  start_time: string | null
  status: string
  quoted_total: number | null
  ops_service_addresses: AddressRow | AddressRow[] | null
  ops_appointment_line_items: Array<{ name_snapshot: string | null }> | null
}

export type InboundSmsCustomerContext = {
  customer: {
    id: string
    name: string
    businessName: string | null
    email: string | null
    phone: string | null
  }
  address: string | null
  jobs: Array<{
    id: string
    date: string
    startTime: string | null
    status: string
    quotedTotal: number | null
    address: string | null
    services: string[]
    timing: 'upcoming' | 'recent'
  }>
}

function unwrapRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function formatAddress(row: AddressRow | null): string | null {
  if (!row) return null
  const street = [row.street_1, row.street_2].filter(Boolean).join(' ')
  const cityState = [row.city, row.state].filter(Boolean).join(', ')
  const tail = [cityState, row.zip_code].filter(Boolean).join(' ')
  return [street, tail].filter(Boolean).join(', ') || null
}

function customerDisplayName(customer: CustomerRow): string {
  return (
    customer.full_name?.trim() ||
    [customer.first_name, customer.last_name].filter(Boolean).join(' ') ||
    customer.business_name?.trim() ||
    'Known customer'
  )
}

async function findCustomer(
  supabase: SupabaseClient,
  phone: string,
): Promise<CustomerRow | null> {
  const fields =
    'id, first_name, last_name, full_name, business_name, email, phone'
  const variants = opsPhoneLookupVariants(phone)

  if (variants.length > 0) {
    const { data, error } = await supabase
      .from('ops_customers')
      .select(fields)
      .in('phone', variants)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(1)

    if (error) throw error
    if (data?.[0]) return data[0] as CustomerRow
  }

  const last10 = phone.replace(/\D/g, '').slice(-10)
  if (last10.length !== 10) return null

  const { data, error } = await supabase
    .from('ops_customers')
    .select(fields)
    .ilike('phone', `%${last10}`)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(1)

  if (error) throw error
  return (data?.[0] as CustomerRow | undefined) ?? null
}

export async function getInboundSmsCustomerContext(
  supabase: SupabaseClient,
  phone: string,
  today: string,
): Promise<InboundSmsCustomerContext | null> {
  const customer = await findCustomer(supabase, phone)
  if (!customer) return null

  const appointmentFields = `
    id,
    appointment_date,
    start_time,
    status,
    quoted_total,
    ops_service_addresses ( street_1, street_2, city, state, zip_code ),
    ops_appointment_line_items ( name_snapshot )
  `

  const [addressResult, upcomingResult, recentResult] = await Promise.all([
    supabase
      .from('ops_service_addresses')
      .select('street_1, street_2, city, state, zip_code')
      .eq('customer_id', customer.id)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(1),
    supabase
      .from('ops_appointments')
      .select(appointmentFields)
      .eq('customer_id', customer.id)
      .gte('appointment_date', today)
      .not('status', 'in', '("cancelled")')
      .order('appointment_date', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(2),
    supabase
      .from('ops_appointments')
      .select(appointmentFields)
      .eq('customer_id', customer.id)
      .lt('appointment_date', today)
      .not('status', 'in', '("cancelled")')
      .order('appointment_date', { ascending: false })
      .order('start_time', { ascending: false })
      .limit(2),
  ])

  if (addressResult.error) throw addressResult.error
  if (upcomingResult.error) throw upcomingResult.error
  if (recentResult.error) throw recentResult.error

  const mapJob = (
    row: AppointmentRow,
    timing: 'upcoming' | 'recent',
  ): InboundSmsCustomerContext['jobs'][number] => ({
    id: row.id,
    date: row.appointment_date,
    startTime: row.start_time,
    status: row.status,
    quotedTotal:
      row.quoted_total == null ? null : Number(row.quoted_total || 0),
    address: formatAddress(unwrapRelation(row.ops_service_addresses)),
    services: (row.ops_appointment_line_items || [])
      .map((line) => line.name_snapshot?.trim())
      .filter((name): name is string => Boolean(name)),
    timing,
  })

  return {
    customer: {
      id: customer.id,
      name: customerDisplayName(customer),
      businessName: customer.business_name?.trim() || null,
      email: customer.email?.trim() || null,
      phone: customer.phone?.trim() || null,
    },
    address: formatAddress((addressResult.data?.[0] as AddressRow) ?? null),
    jobs: [
      ...((upcomingResult.data || []) as AppointmentRow[]).map((row) =>
        mapJob(row, 'upcoming'),
      ),
      ...((recentResult.data || []) as AppointmentRow[]).map((row) =>
        mapJob(row, 'recent'),
      ),
    ],
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function formatJobDate(date: string, startTime: string | null): string {
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
  if (!startTime) return label

  const [hour, minute] = startTime.split(':').map(Number)
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2026, 0, 1, hour, minute)))
  return `${label} at ${time}`
}

export function renderInboundSmsCustomerContext(
  context: InboundSmsCustomerContext | null | undefined,
): string {
  if (context === undefined) {
    return `
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <h3 style="color: #991b1b; margin: 0 0 8px 0;">Customer lookup unavailable</h3>
        <p style="margin: 0; color: #7f1d1d;">The message was received, but customer details could not be loaded from the database.</p>
      </div>
    `
  }

  if (!context) {
    return `
      <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <h3 style="color: #9a3412; margin: 0 0 8px 0;">Customer lookup</h3>
        <p style="margin: 0; color: #7c2d12;">No customer record matched this phone number.</p>
      </div>
    `
  }

  const customer = context.customer
  const jobRows = context.jobs
    .map((job) => {
      const services = job.services.length
        ? escapeHtml(job.services.join(', '))
        : 'No services listed'
      const details = [
        job.address ? escapeHtml(job.address) : null,
        job.quotedTotal != null
          ? `$${job.quotedTotal.toFixed(2)} quoted`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')

      return `
        <div style="border-top: 1px solid #d1fae5; padding: 10px 0;">
          <p style="margin: 0 0 4px 0;">
            <strong>${job.timing === 'upcoming' ? 'Upcoming' : 'Recent'}:</strong>
            <a href="${ADMIN_BASE_URL}/admin/operations/appointments/${encodeURIComponent(job.id)}">${escapeHtml(formatJobDate(job.date, job.startTime))}</a>
            · ${escapeHtml(job.status.replaceAll('_', ' '))}
          </p>
          <p style="margin: 0; color: #374151;">${services}</p>
          ${details ? `<p style="margin: 4px 0 0 0; color: #6b7280; font-size: 13px;">${details}</p>` : ''}
        </div>
      `
    })
    .join('')

  return `
    <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <h3 style="color: #166534; margin: 0 0 10px 0;">Known customer</h3>
      <p style="margin: 0 0 6px 0;"><strong>Name:</strong> ${escapeHtml(customer.name)}</p>
      ${customer.businessName ? `<p style="margin: 0 0 6px 0;"><strong>Business:</strong> ${escapeHtml(customer.businessName)}</p>` : ''}
      ${customer.email ? `<p style="margin: 0 0 6px 0;"><strong>Email:</strong> <a href="mailto:${escapeHtml(customer.email)}">${escapeHtml(customer.email)}</a></p>` : ''}
      ${context.address ? `<p style="margin: 0 0 6px 0;"><strong>Address:</strong> ${escapeHtml(context.address)}</p>` : ''}
      ${customer.phone ? `<p style="margin: 0;"><strong>Saved phone:</strong> ${escapeHtml(customer.phone)}</p>` : ''}
      ${
        jobRows
          ? `<h4 style="color: #166534; margin: 16px 0 0 0;">Job history</h4>${jobRows}`
          : '<p style="margin: 14px 0 0 0; color: #6b7280;">No jobs found for this customer.</p>'
      }
    </div>
  `
}
