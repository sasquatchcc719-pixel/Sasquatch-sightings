import { Resend } from 'resend'
import { generateUnsubscribeToken } from '@/lib/ops/drip-campaign'
import { createAdminClient } from '@/supabase/server'
import { isBlacklisted } from '@/lib/blacklist'
import {
  loadCustomerValueIndex,
  type CustomerValueEntry,
} from '@/lib/ops/business-health'

const BOOK_URL = 'https://www.sasquatchcarpet.com'
const UNSUB_BASE =
  'https://sightings.sasquatchcarpet.com/api/public/unsubscribe'
const NON_DELIVERABLE_DOMAINS = new Set(['import.local'])

type SupabaseAdmin = ReturnType<typeof createAdminClient>

type ReactivationSettings = {
  engine_enabled: boolean
  daily_send_cap: number
  cadence_days: number
  /** Stop the sequence after this many emails per customer. */
  max_messages: number
  dormancy_months: number
  default_offer: string
  strong_offer_enabled: boolean
  strong_offer: string
  strong_offer_expires_at: string | null
}

type CustomerRow = {
  id: string
  full_name: string | null
  first_name: string | null
  email: string | null
  phone: string | null
  email_opt_out: boolean | null
  created_at: string
  ops_service_addresses:
    | { city: string | null; state: string | null; zip_code: string | null }
    | { city: string | null; state: string | null; zip_code: string | null }[]
    | null
}

type AppointmentRow = {
  customer_id: string
  appointment_date: string | null
  completed_at: string | null
  status: string | null
}

type EnrollmentRow = {
  id: string
  customer_id: string
  status: string
  messages_sent: number
  next_send_at: string | null
  manual_suppressed_at: string | null
}

type TemplateRow = {
  id: string
  template_key: string
  category: string
  label: string
  rotation_order: number
  subject_template: string
  body_template: string
  is_enabled: boolean
  is_strong_offer: boolean
}

type ReactivationContext = {
  first_name: string
  full_name: string
  city: string
  booking_url: string
  default_offer: string
  strong_offer: string
}

export type ReactivationStatus =
  | 'active'
  | 'eligible'
  | 'paused_recent_booking'
  | 'post_job_drip'
  | 'suppressed_manual'
  | 'suppressed_blacklisted'
  | 'suppressed_unsubscribed'
  | 'suppressed_bounced'
  | 'excluded_no_email'
  | 'excluded_duplicate'

export type ReactivationResults = {
  enrolled: number
  updated: number
  processed: number
  sent: number
  skipped: number
  failed: number
  errors: string[]
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

function addMonths(date: string, months: number): string {
  const result = new Date(`${date}T12:00:00Z`)
  result.setUTCMonth(result.getUTCMonth() + months)
  return result.toISOString().slice(0, 10)
}

function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] || null : value
}

function normalizedEmail(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function phoneDigits(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '')
}

function phoneMatchesBlacklist(
  phone: string | null | undefined,
  blacklist: Set<string>,
) {
  const digits = phoneDigits(phone)
  if (!digits) return false
  const national =
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  return (
    blacklist.has(digits) ||
    blacklist.has(national) ||
    blacklist.has(`1${national}`)
  )
}

function isDeliverableCustomerEmail(
  value: string | null | undefined,
): value is string {
  const email = normalizedEmail(value)
  const atIndex = email.lastIndexOf('@')
  if (atIndex <= 0 || atIndex === email.length - 1) return false

  return !NON_DELIVERABLE_DOMAINS.has(email.slice(atIndex + 1))
}

function firstName(customer: Pick<CustomerRow, 'first_name' | 'full_name'>) {
  return (
    customer.first_name ||
    customer.full_name?.split(' ').filter(Boolean)[0] ||
    'there'
  )
}

function renderTemplate(template: string, ctx: ReactivationContext): string {
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_, key: string) => ctx[key as keyof ReactivationContext] ?? '',
  )
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function unsubscribeUrl(customerId: string): string {
  const token = generateUnsubscribeToken(customerId)
  return `${UNSUB_BASE}?cid=${customerId}&token=${token}`
}

/**
 * The real reactivation email, wrapper and all.
 *
 * Exported so the admin preview renders exactly what the customer receives.
 * It used to render these through the generic ops wrapper instead, which has
 * no BOOK ONLINE button — so the preview showed "Use the button below to book
 * online" with no button under it, and looked like 834 sent emails had been
 * dead ends. They were not; only the preview was wrong.
 */
export function buildReactivationEmailHtml(
  body: string,
  customerId: string,
): string {
  const paragraphs = body
    .replace(/\\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const lines = p.split('\n').map((line) => escapeHtml(line.trim()))
      return `<p style="margin:0 0 16px 0;line-height:1.6;">${lines.join('<br>')}</p>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#2d6a4f;padding:24px 32px;text-align:center;">
            <img src="https://sightings.sasquatchcarpet.com/sasquatch-logo.png" alt="Sasquatch Carpet Cleaning" width="160" style="display:block;margin:0 auto;max-width:160px;height:auto;" />
          </td>
        </tr>
        <tr>
          <td style="padding:32px;color:#333333;font-size:15px;">
            ${paragraphs}
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
              <tr><td align="center">
                <a href="${BOOK_URL}" style="display:inline-block;padding:14px 32px;background:#1a73e8;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:16px;">BOOK ONLINE</a>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#f9f9f9;padding:20px 32px;border-top:1px solid #eeeeee;text-align:center;color:#888888;font-size:12px;">
            <p style="margin:0 0 6px 0;">(719) 249-8791 | sasquatchcc719@gmail.com</p>
            <p style="margin:0 0 6px 0;">Sasquatch Carpet Cleaning · Colorado Springs, CO</p>
            <p style="margin:0;">
              <a href="${escapeHtml(unsubscribeUrl(customerId))}" style="color:#aaaaaa;text-decoration:underline;">Unsubscribe</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

async function getSettings(
  supabase: SupabaseAdmin,
): Promise<ReactivationSettings> {
  const { data, error } = await supabase
    .from('reactivation_settings')
    .select('*')
    .eq('id', true)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load reactivation settings: ${error.message}`)
  }

  return {
    engine_enabled: data?.engine_enabled ?? true,
    daily_send_cap: data?.daily_send_cap ?? 35,
    cadence_days: data?.cadence_days ?? 30,
    max_messages: data?.max_messages ?? 6,
    dormancy_months: data?.dormancy_months ?? 6,
    default_offer: data?.default_offer ?? '$20 off your next cleaning',
    strong_offer_enabled: data?.strong_offer_enabled ?? false,
    strong_offer: data?.strong_offer ?? '$35 off your next cleaning',
    strong_offer_expires_at: data?.strong_offer_expires_at ?? null,
  }
}

function latestAppointmentByCustomer(appointments: AppointmentRow[]) {
  const latest = new Map<string, string>()
  for (const appointment of appointments) {
    const activityDate = String(
      appointment.completed_at || appointment.appointment_date || '',
    ).slice(0, 10)
    if (!appointment.customer_id || !activityDate) continue
    const current = latest.get(appointment.customer_id)
    if (!current || activityDate > current) {
      latest.set(appointment.customer_id, activityDate)
    }
  }
  return latest
}

function isWithinDormancyWindow(params: {
  latestAppointmentDate: string | null
  settings: ReactivationSettings
  asOfDate: string
}) {
  if (!params.latestAppointmentDate) return false
  const eligibleAfter = addMonths(
    params.latestAppointmentDate,
    params.settings.dormancy_months,
  )
  return eligibleAfter > params.asOfDate
}

function statusForCustomer(params: {
  customer: CustomerRow
  latestAppointmentDate: string | null
  history?: CustomerValueEntry
  emailOwnerByEmail: Map<string, string>
  activeDripCustomerIds: Set<string>
  blacklistedPhones: Set<string>
  existingEnrollment?: EnrollmentRow
  settings: ReactivationSettings
  asOfDate: string
}): {
  status: ReactivationStatus
  nextSendAt: string | null
  pausedUntil: string | null
  stopReason: string | null
  source: string
} {
  const email = normalizedEmail(params.customer.email)
  const ownerId = params.emailOwnerByEmail.get(email)

  if (
    params.existingEnrollment?.status === 'suppressed_manual' ||
    params.existingEnrollment?.status === 'suppressed_bounced' ||
    params.existingEnrollment?.status === 'suppressed_blacklisted'
  ) {
    return {
      status: params.existingEnrollment.status as ReactivationStatus,
      nextSendAt: null,
      pausedUntil: null,
      stopReason:
        params.existingEnrollment.status === 'suppressed_bounced'
          ? 'bounce_suppression'
          : params.existingEnrollment.status === 'suppressed_blacklisted'
            ? 'blacklisted_customer'
            : 'manual_suppression',
      source:
        params.existingEnrollment.status === 'suppressed_bounced'
          ? 'delivery_suppression'
          : params.existingEnrollment.status === 'suppressed_blacklisted'
            ? 'blacklist'
            : 'manual_override',
    }
  }

  if (phoneMatchesBlacklist(params.customer.phone, params.blacklistedPhones)) {
    return {
      status: 'suppressed_blacklisted',
      nextSendAt: null,
      pausedUntil: null,
      stopReason: 'blacklisted_customer',
      source: 'blacklist',
    }
  }

  // Do-not-contact flag carried over from the Housecall Pro import.
  if (params.history?.doNotContact) {
    return {
      status: 'suppressed_manual',
      nextSendAt: null,
      pausedUntil: null,
      stopReason: 'do_not_contact_flag',
      source: 'hcp_import',
    }
  }

  if (params.customer.email_opt_out) {
    return {
      status: 'suppressed_unsubscribed',
      nextSendAt: null,
      pausedUntil: null,
      stopReason: 'email_opt_out',
      source: 'customer_opt_out',
    }
  }

  if (!isDeliverableCustomerEmail(email)) {
    return {
      status: 'excluded_no_email',
      nextSendAt: null,
      pausedUntil: null,
      stopReason: 'no_deliverable_email',
      source: 'eligibility',
    }
  }

  if (ownerId && ownerId !== params.customer.id) {
    return {
      status: 'excluded_duplicate',
      nextSendAt: null,
      pausedUntil: null,
      stopReason: 'duplicate_email',
      source: 'eligibility',
    }
  }

  if (params.activeDripCustomerIds.has(params.customer.id)) {
    return {
      status: 'post_job_drip',
      nextSendAt: null,
      pausedUntil: null,
      stopReason: 'active_post_job_drip',
      source: 'post_job_drip',
    }
  }

  if (
    isWithinDormancyWindow({
      latestAppointmentDate: params.latestAppointmentDate,
      settings: params.settings,
      asOfDate: params.asOfDate,
    })
  ) {
    return {
      status: 'paused_recent_booking',
      nextSendAt: null,
      pausedUntil: addMonths(
        params.latestAppointmentDate || params.asOfDate,
        params.settings.dormancy_months,
      ),
      stopReason: 'booked_job',
      source: 'recent_booking',
    }
  }

  return {
    status: 'active',
    nextSendAt: params.existingEnrollment?.next_send_at || params.asOfDate,
    pausedUntil: null,
    stopReason: null,
    // Blended history (QuickBooks/HCP era) makes the distinction accurate:
    // a customer last cleaned in 2024 is dormant, not "never booked".
    source:
      params.latestAppointmentDate || params.history?.lastKnownService
        ? 'six_month_dormant_customer'
        : 'never_booked_customer',
  }
}

async function loadEligibilityData(supabase: SupabaseAdmin) {
  const [
    customersResult,
    appointmentsResult,
    enrollmentsResult,
    dripResult,
    blacklistResult,
  ] = await Promise.all([
    supabase
      .from('ops_customers')
      .select(
        'id, full_name, first_name, email, phone, email_opt_out, created_at, ops_service_addresses(city, state, zip_code)',
      )
      .order('created_at', { ascending: true })
      .limit(3000),
    supabase
      .from('ops_appointments')
      .select('customer_id, appointment_date, completed_at, status')
      .neq('status', 'cancelled')
      .order('appointment_date', { ascending: false })
      .limit(10000),
    supabase
      .from('reactivation_campaign_enrollments')
      .select(
        'id, customer_id, status, messages_sent, next_send_at, manual_suppressed_at',
      ),
    supabase
      .from('drip_campaign_enrollments')
      .select('customer_id')
      .eq('status', 'active'),
    supabase.from('blacklist').select('phone'),
  ])

  if (customersResult.error) throw customersResult.error
  if (appointmentsResult.error) throw appointmentsResult.error
  if (enrollmentsResult.error) throw enrollmentsResult.error
  if (dripResult.error) throw dripResult.error
  if (blacklistResult.error) throw blacklistResult.error

  const customers = (customersResult.data || []) as CustomerRow[]
  const appointments = (appointmentsResult.data || []) as AppointmentRow[]
  const enrollments = (enrollmentsResult.data || []) as EnrollmentRow[]

  // Blended history (ops + QuickBooks + HCP): lifetime value for send
  // priority, last service for dormancy, do-not-contact flags. Non-fatal —
  // the engine still works without it.
  let valueIndex = new Map<string, CustomerValueEntry>()
  try {
    valueIndex = await loadCustomerValueIndex(supabase)
  } catch (err) {
    console.error('[reactivation] value index failed, continuing without', err)
  }

  return {
    customers,
    valueIndex,
    latestAppointment: latestAppointmentByCustomer(appointments),
    enrollmentsByCustomer: new Map(
      enrollments.map((row) => [row.customer_id, row]),
    ),
    activeDripCustomerIds: new Set(
      (dripResult.data || []).map((row) => row.customer_id as string),
    ),
    blacklistedPhones: new Set(
      (blacklistResult.data || [])
        .map((row) => phoneDigits(row.phone as string | null))
        .filter(Boolean),
    ),
  }
}

function buildEmailOwnerMap(customers: CustomerRow[]) {
  const ownerByEmail = new Map<string, string>()
  for (const customer of customers) {
    const email = normalizedEmail(customer.email)
    if (!isDeliverableCustomerEmail(email)) continue
    if (!ownerByEmail.has(email)) ownerByEmail.set(email, customer.id)
  }
  return ownerByEmail
}

export async function enrollEligibleReactivationCustomers(params?: {
  limit?: number
}): Promise<{ enrolled: number; updated: number; errors: string[] }> {
  const supabase = createAdminClient()
  const settings = await getSettings(supabase)
  const asOfDate = todayDate()
  const data = await loadEligibilityData(supabase)
  const emailOwnerByEmail = buildEmailOwnerMap(data.customers)
  const maxCustomers = Math.max(1, Math.min(params?.limit || 3000, 3000))
  const results = { enrolled: 0, updated: 0, errors: [] as string[] }

  for (const customer of data.customers.slice(0, maxCustomers)) {
    const existing = data.enrollmentsByCustomer.get(customer.id)
    const history = data.valueIndex.get(customer.id)
    const opsLatest = data.latestAppointment.get(customer.id) || null
    // Dormancy considers every system's last service, not just ops.
    const latestAppointmentDate =
      history?.lastKnownService &&
      (!opsLatest || history.lastKnownService > opsLatest)
        ? history.lastKnownService
        : opsLatest
    const computed = statusForCustomer({
      customer,
      latestAppointmentDate,
      history,
      emailOwnerByEmail,
      activeDripCustomerIds: data.activeDripCustomerIds,
      blacklistedPhones: data.blacklistedPhones,
      existingEnrollment: existing,
      settings,
      asOfDate,
    })

    const payload = {
      customer_id: customer.id,
      status: computed.status,
      enrollment_source: computed.source,
      next_send_at: computed.nextSendAt,
      latest_appointment_at: latestAppointmentDate,
      priority_value: Math.round((history?.lifetimeValue || 0) * 100) / 100,
      last_known_service: history?.lastKnownService || null,
      paused_until: computed.pausedUntil,
      stop_reason: computed.stopReason,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase
      .from('reactivation_campaign_enrollments')
      .upsert(payload, { onConflict: 'customer_id' })

    if (error) {
      results.errors.push(`${customer.id}: ${error.message}`)
      continue
    }

    if (existing) {
      results.updated++
    } else if (computed.status === 'active') {
      results.enrolled++
      await supabase.from('reactivation_email_log').insert({
        customer_id: customer.id,
        event_type: 'enrolled',
        status: 'logged',
        metadata: { source: computed.source },
      })
    }
  }

  return results
}

function shouldUseStrongOffer(settings: ReactivationSettings) {
  if (!settings.strong_offer_enabled) return false
  if (!settings.strong_offer_expires_at) return true
  return settings.strong_offer_expires_at >= todayDate()
}

async function loadTemplates(
  supabase: SupabaseAdmin,
  settings: ReactivationSettings,
) {
  const { data, error } = await supabase
    .from('reactivation_email_templates')
    .select('*')
    .eq('is_enabled', true)
    .order('rotation_order')

  if (error) throw error
  const templates = ((data || []) as TemplateRow[]).filter(
    (template) => !template.is_strong_offer || shouldUseStrongOffer(settings),
  )
  return templates
}

async function suppressEnrollment(params: {
  supabase: SupabaseAdmin
  enrollmentId: string
  customerId: string
  status: ReactivationStatus
  reason: string
  pausedUntil?: string | null
}) {
  await params.supabase
    .from('reactivation_campaign_enrollments')
    .update({
      status: params.status,
      next_send_at: null,
      paused_until: params.pausedUntil || null,
      stop_reason: params.reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.enrollmentId)

  await params.supabase.from('reactivation_email_log').insert({
    enrollment_id: params.enrollmentId,
    customer_id: params.customerId,
    event_type:
      params.status === 'paused_recent_booking' ? 'paused' : 'suppressed',
    status: 'logged',
    metadata: { reason: params.reason },
  })
}

async function customerHasRecentAppointment(params: {
  supabase: SupabaseAdmin
  customerId: string
  settings: ReactivationSettings
}) {
  const { data } = await params.supabase
    .from('ops_appointments')
    .select('appointment_date')
    .eq('customer_id', params.customerId)
    .neq('status', 'cancelled')
    .order('appointment_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  const latest = data?.appointment_date as string | null | undefined
  if (!latest) return { recent: false, latest: null, pausedUntil: null }

  const pausedUntil = addMonths(latest, params.settings.dormancy_months)
  return {
    recent: pausedUntil > todayDate(),
    latest,
    pausedUntil,
  }
}

function contextForCustomer(
  customer: CustomerRow,
  settings: ReactivationSettings,
): ReactivationContext {
  const address = unwrapRelation(customer.ops_service_addresses)
  return {
    first_name: firstName(customer),
    full_name: customer.full_name || firstName(customer),
    city: address?.city || 'the Colorado Springs area',
    booking_url: BOOK_URL,
    default_offer: settings.default_offer,
    strong_offer: settings.strong_offer,
  }
}

export async function processReactivationEmails(): Promise<ReactivationResults> {
  const supabase = createAdminClient()
  const settings = await getSettings(supabase)
  const enrollmentResults = await enrollEligibleReactivationCustomers()
  const results: ReactivationResults = {
    enrolled: enrollmentResults.enrolled,
    updated: enrollmentResults.updated,
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: [...enrollmentResults.errors],
  }

  if (!settings.engine_enabled || settings.daily_send_cap <= 0) return results

  const templates = await loadTemplates(supabase, settings)
  if (templates.length === 0) {
    results.errors.push('No enabled reactivation templates')
    return results
  }

  const { data: enrollmentsRaw, error: enrollmentError } = await supabase
    .from('reactivation_campaign_enrollments')
    .select(
      `
      id,
      customer_id,
      status,
      messages_sent,
      next_send_at,
      manual_suppressed_at,
      ops_customers (
        id,
        full_name,
        first_name,
        email,
        phone,
        email_opt_out,
        created_at,
        ops_service_addresses(city, state, zip_code)
      )
    `,
    )
    .eq('status', 'active')
    // Sequence complete — every template used; stop emailing this customer.
    .lt('messages_sent', Math.max(1, settings.max_messages))
    .lte('next_send_at', todayDate())
    // Highest lifetime value first — with a small daily cap, the $10k
    // property manager gets contacted before the $99 one-timer.
    .order('priority_value', { ascending: false })
    .order('next_send_at', { ascending: true })
    .limit(settings.daily_send_cap)

  if (enrollmentError) throw enrollmentError

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    results.errors.push('RESEND_API_KEY not configured')
    return results
  }

  const resend = new Resend(resendKey)
  const fromEmail =
    process.env.OPS_EMAIL_FROM ||
    'Sasquatch Carpet Cleaning <onboarding@resend.dev>'

  for (const enrollmentRaw of enrollmentsRaw || []) {
    const enrollment = enrollmentRaw as EnrollmentRow & {
      ops_customers: CustomerRow | CustomerRow[] | null
    }
    const customer = unwrapRelation(enrollment.ops_customers)
    results.processed++

    if (!customer) {
      await suppressEnrollment({
        supabase,
        enrollmentId: enrollment.id,
        customerId: enrollment.customer_id,
        status: 'excluded_no_email',
        reason: 'customer_not_found',
      })
      results.skipped++
      continue
    }

    if (customer.email_opt_out) {
      await suppressEnrollment({
        supabase,
        enrollmentId: enrollment.id,
        customerId: customer.id,
        status: 'suppressed_unsubscribed',
        reason: 'email_opt_out',
      })
      results.skipped++
      continue
    }

    if (customer.phone && (await isBlacklisted(customer.phone))) {
      await suppressEnrollment({
        supabase,
        enrollmentId: enrollment.id,
        customerId: customer.id,
        status: 'suppressed_blacklisted',
        reason: 'blacklisted_at_send_time',
      })
      results.skipped++
      continue
    }

    if (!isDeliverableCustomerEmail(customer.email)) {
      await suppressEnrollment({
        supabase,
        enrollmentId: enrollment.id,
        customerId: customer.id,
        status: 'excluded_no_email',
        reason: 'no_deliverable_email',
      })
      results.skipped++
      continue
    }

    const recentAppointment = await customerHasRecentAppointment({
      supabase,
      customerId: customer.id,
      settings,
    })
    if (recentAppointment.recent) {
      await suppressEnrollment({
        supabase,
        enrollmentId: enrollment.id,
        customerId: customer.id,
        status: 'paused_recent_booking',
        reason: 'booked_job',
        pausedUntil: recentAppointment.pausedUntil,
      })
      results.skipped++
      continue
    }

    const template = templates[enrollment.messages_sent % templates.length]
    const ctx = contextForCustomer(customer, settings)
    const subject = renderTemplate(template.subject_template, ctx)
    const body = renderTemplate(template.body_template, ctx)
    const html = buildReactivationEmailHtml(body, customer.id)
    const sendNumber = enrollment.messages_sent + 1

    // Resend rate-limits at a few requests/second — the June 2026 blast
    // lost 124 of 400 emails to 429s by sending full speed. Space sends out.
    await new Promise((resolve) => setTimeout(resolve, 400))

    const emailResult = await resend.emails.send(
      {
        from: fromEmail,
        to: normalizedEmail(customer.email),
        subject,
        html,
      },
      { idempotencyKey: `reactivation/${enrollment.id}/${sendNumber}` },
    )

    if (emailResult.error) {
      results.failed++
      results.errors.push(`${customer.id}: ${emailResult.error.message}`)
      await supabase.from('reactivation_email_log').insert({
        enrollment_id: enrollment.id,
        customer_id: customer.id,
        template_id: template.id,
        event_type: 'email',
        template_key: template.template_key,
        subject,
        body_text: body,
        to_email: normalizedEmail(customer.email),
        status: 'failed',
        error_message: emailResult.error.message,
      })
      continue
    }

    await supabase.from('reactivation_email_log').insert({
      enrollment_id: enrollment.id,
      customer_id: customer.id,
      template_id: template.id,
      event_type: 'email',
      template_key: template.template_key,
      subject,
      body_text: body,
      to_email: normalizedEmail(customer.email),
      resend_id: emailResult.data?.id || null,
      status: 'sent',
    })

    await supabase
      .from('reactivation_campaign_enrollments')
      .update({
        messages_sent: sendNumber,
        current_rotation_index: sendNumber % templates.length,
        last_sent_at: new Date().toISOString(),
        next_send_at: addDays(todayDate(), settings.cadence_days),
        updated_at: new Date().toISOString(),
      })
      .eq('id', enrollment.id)

    results.sent++
  }

  return results
}

export async function cancelReactivationForCustomer(
  customerId: string,
  reason = 'booked_job',
) {
  const supabase = createAdminClient()
  const settings = await getSettings(supabase)
  const pausedUntil = addMonths(todayDate(), settings.dormancy_months)

  const { data: enrollment } = await supabase
    .from('reactivation_campaign_enrollments')
    .select('id')
    .eq('customer_id', customerId)
    .maybeSingle()

  const { error } = await supabase
    .from('reactivation_campaign_enrollments')
    .upsert(
      {
        customer_id: customerId,
        status: 'paused_recent_booking',
        next_send_at: null,
        paused_until: pausedUntil,
        stop_reason: reason,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'customer_id' },
    )

  if (error) throw error

  await supabase.from('reactivation_email_log').insert({
    enrollment_id: enrollment?.id || null,
    customer_id: customerId,
    event_type: 'paused',
    status: 'logged',
    metadata: { reason, paused_until: pausedUntil },
  })
}

export async function manualReactivationOverride(params: {
  customerId: string
  action: 'pause' | 'suppress' | 'resume' | 'unsubscribe'
  userId?: string
  reason?: string
}) {
  const supabase = createAdminClient()
  const now = new Date().toISOString()

  if (params.action === 'unsubscribe') {
    await supabase
      .from('ops_customers')
      .update({ email_opt_out: true })
      .eq('id', params.customerId)
  }

  const update =
    params.action === 'resume'
      ? {
          status: 'active',
          next_send_at: todayDate(),
          stop_reason: null,
          manual_resume_at: now,
          updated_at: now,
        }
      : params.action === 'pause'
        ? {
            status: 'paused_recent_booking',
            next_send_at: null,
            stop_reason: params.reason || 'manual_pause',
            override_notes: params.reason || null,
            updated_at: now,
          }
        : {
            status:
              params.action === 'unsubscribe'
                ? 'suppressed_unsubscribed'
                : 'suppressed_manual',
            next_send_at: null,
            stop_reason:
              params.action === 'unsubscribe'
                ? 'manual_unsubscribe'
                : 'manual_suppression',
            manual_suppressed_at: now,
            manual_suppressed_by: params.userId || null,
            manual_suppression_reason: params.reason || null,
            override_notes: params.reason || null,
            updated_at: now,
          }

  const { data, error } = await supabase
    .from('reactivation_campaign_enrollments')
    .upsert(
      {
        customer_id: params.customerId,
        ...update,
      },
      { onConflict: 'customer_id' },
    )
    .select('id')
    .single()

  if (error) throw error

  await supabase.from('reactivation_email_log').insert({
    enrollment_id: data.id,
    customer_id: params.customerId,
    event_type:
      params.action === 'resume'
        ? 'resumed'
        : params.action === 'pause'
          ? 'paused'
          : params.action === 'unsubscribe'
            ? 'unsubscribed'
            : 'suppressed',
    status: 'logged',
    metadata: { reason: params.reason || null, action: params.action },
  })
}
