import { Resend } from 'resend'
import { sendCustomerSMS } from '@/lib/twilio'
import { createAdminClient } from '@/supabase/server'
import { isDeliverableCustomerEmail } from '@/lib/ops/email'
import { isBlacklisted, normalizePhone } from '@/lib/blacklist'

export const OPS_TEMPLATE_KEYS = [
  'job_scheduled_sms',
  'on_my_way_sms',
  'job_finished_sms',
  'job_rescheduled_sms',
  'job_rescheduled_email',
  'day_before_residential_sms',
  'day_before_recovery_village_sms',
  'job_scheduled_email',
  'job_finished_email',
  'satisfaction_checkin_email',
] as const

export type OpsTemplateKey = (typeof OPS_TEMPLATE_KEYS)[number]
export type OpsLifecycleEvent =
  | 'job_scheduled'
  | 'on_my_way'
  | 'job_finished'
  | 'job_rescheduled'

type OpsTemplateRow = {
  template_key: OpsTemplateKey
  channel: 'sms' | 'email'
  label: string
  is_enabled: boolean
  subject_template: string | null
  body_template: string
  delay_hours: number
}

type QueueItem = {
  id: string
  template_key: OpsTemplateKey
  scheduled_for: string
  payload: Record<string, unknown>
  appointment_id: string
  customer_id: string
}

type TemplateContext = {
  first_name: string
  full_name: string
  business_name: string
  company_name: string
  appointment_date: string
  start_time: string
  end_time: string
  service_summary: string
  address_line: string
  tech_name: string
  quoted_total: string
  work_area: string
}

type TechnicianEmailProfile = {
  displayName: string
  firstName: string
  imageUrl: string | null
}

type AppointmentWithRelations = {
  id: string
  customer_id: string
  appointment_date: string
  start_time: string
  end_time: string
  internal_notes: string | null
  ops_customers:
    | {
        full_name: string
        first_name: string | null
        business_name: string | null
        email: string | null
        phone: string | null
        email_opt_out: boolean | null
      }
    | {
        full_name: string
        first_name: string | null
        business_name: string | null
        email: string | null
        phone: string | null
        email_opt_out: boolean | null
      }[]
    | null
  ops_service_addresses:
    | {
        street_1: string
        city: string
        state: string
        zip_code: string
      }
    | {
        street_1: string
        city: string
        state: string
        zip_code: string
      }[]
    | null
  ops_appointment_line_items: Array<{
    name_snapshot: string
    notes?: string | null
  }>
  quoted_total: number | null
  status?: string | null
  assigned_staff_user_id?: string | null
}

const TEMP_SUPPRESS_CUSTOMER_COMMS_MARKER =
  'TEMP_SUPPRESS_CUSTOMER_COMMS_EVAN_COX_RECLEAN_TEST'
const CUSTOMER_HIDDEN_LINE_ITEMS = new Set([
  'Google LSA Lead Charge',
  'Minimum Dispatch Adjustment',
])

const APPOINTMENT_SELECT = `
  id,
  customer_id,
  appointment_date,
  start_time,
  end_time,
  internal_notes,
  status,
  quoted_total,
  assigned_staff_user_id,
  ops_customers!ops_appointments_customer_id_fkey (
    full_name,
    first_name,
    business_name,
    email,
    phone,
    email_opt_out
  ),
  ops_service_addresses (
    street_1,
    city,
    state,
    zip_code
  ),
  ops_appointment_line_items (
    name_snapshot,
    notes
  )
`

function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] || null : value
}

function toLocalDateString(dateValue: string): string {
  try {
    return new Date(`${dateValue}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return dateValue
  }
}

function toLocalTimeString(timeValue: string): string {
  try {
    const [hours, minutes] = timeValue.slice(0, 5).split(':').map(Number)
    const date = new Date()
    date.setHours(hours, minutes, 0, 0)
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return timeValue.slice(0, 5)
  }
}

function renderTemplate(
  template: string | null | undefined,
  context: TemplateContext,
): string {
  if (!template) return ''
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_, key: string) => {
      const value = context[key as keyof TemplateContext]
      return value ?? ''
    },
  )
}

export function getOpsTemplateKeysForEvent(
  event: OpsLifecycleEvent,
): OpsTemplateKey[] {
  if (event === 'job_scheduled') {
    return ['job_scheduled_sms', 'job_scheduled_email']
  }
  if (event === 'on_my_way') {
    return ['on_my_way_sms']
  }
  if (event === 'job_rescheduled') {
    return ['job_rescheduled_sms', 'job_rescheduled_email']
  }
  return [
    'job_finished_sms',
    'job_finished_email',
    'satisfaction_checkin_email',
  ]
}

async function getTemplatesForEvent(
  supabase: ReturnType<typeof createAdminClient>,
  event: OpsLifecycleEvent,
): Promise<OpsTemplateRow[]> {
  const keys = getOpsTemplateKeysForEvent(event)
  const { data, error } = await supabase
    .from('ops_communication_templates')
    .select('*')
    .in('template_key', keys)
    .eq('is_enabled', true)

  if (error) {
    console.error('[ops/communications] Failed to load templates:', error)
    return []
  }

  return (data || []) as OpsTemplateRow[]
}

async function resolveTechFirstName(
  supabase: ReturnType<typeof createAdminClient>,
  staffUserId: string | null,
): Promise<string> {
  const profile = await resolveTechnicianEmailProfile(supabase, staffUserId)
  return profile.firstName
}

async function resolveTechnicianEmailProfile(
  supabase: ReturnType<typeof createAdminClient>,
  staffUserId: string | null,
): Promise<TechnicianEmailProfile> {
  if (staffUserId) {
    const { data } = await supabase
      .from('staff_users')
      .select('display_name, profile_image_url')
      .or(`id.eq.${staffUserId},user_id.eq.${staffUserId}`)
      .maybeSingle()

    const displayName = data?.display_name || 'Your technician'
    return {
      displayName,
      firstName: displayName.split(' ').filter(Boolean)[0] || displayName,
      imageUrl: data?.profile_image_url || null,
    }
  }

  const { data } = await supabase
    .from('staff_users')
    .select('display_name, profile_image_url')
    .eq('display_name', 'Charles')
    .maybeSingle()
  const displayName = data?.display_name || 'Charles'
  return {
    displayName,
    firstName: displayName.split(' ').filter(Boolean)[0] || displayName,
    imageUrl: data?.profile_image_url || null,
  }
}

async function getAppointmentContext(
  supabase: ReturnType<typeof createAdminClient>,
  appointmentId: string,
): Promise<{
  appointment: AppointmentWithRelations | null
  context: TemplateContext | null
  technician: TechnicianEmailProfile | null
}> {
  const { data, error } = await supabase
    .from('ops_appointments')
    .select(APPOINTMENT_SELECT)
    .eq('id', appointmentId)
    .single()

  if (error) {
    console.error(
      '[ops/communications] Failed to load appointment context:',
      error,
    )
    return { appointment: null, context: null, technician: null }
  }

  const appointment = data as AppointmentWithRelations
  const customer = unwrapRelation(appointment.ops_customers)
  const address = unwrapRelation(appointment.ops_service_addresses)
  const firstName =
    customer?.first_name ||
    customer?.full_name?.split(' ').filter(Boolean)[0] ||
    'there'
  const customerVisibleLineItems = appointment.ops_appointment_line_items
    ?.map((item) => item.name_snapshot)
    .filter((name) => name && !CUSTOMER_HIDDEN_LINE_ITEMS.has(name))
  const technician = await resolveTechnicianEmailProfile(
    supabase,
    appointment.assigned_staff_user_id ?? null,
  )
  const context: TemplateContext = {
    first_name: firstName,
    full_name: customer?.full_name || '',
    business_name: customer?.business_name || '',
    company_name: 'Sasquatch Carpet Cleaning',
    appointment_date: toLocalDateString(appointment.appointment_date),
    start_time: toLocalTimeString(String(appointment.start_time)),
    end_time: toLocalTimeString(String(appointment.end_time)),
    service_summary:
      customerVisibleLineItems?.join(', ') || 'Service appointment',
    address_line: address
      ? `${address.street_1}, ${address.city}, ${address.state} ${address.zip_code}`
      : '',
    tech_name: technician.firstName,
    quoted_total: Number(appointment.quoted_total || 0).toFixed(2),
    work_area:
      appointment.internal_notes?.trim() ||
      appointment.ops_appointment_line_items
        ?.map((item) => item.notes?.trim())
        .filter(Boolean)
        .join('; ') ||
      customerVisibleLineItems?.join(', ') ||
      'Scheduled service area',
  }

  return { appointment, context, technician }
}

async function queueFollowupEmail(params: {
  supabase: ReturnType<typeof createAdminClient>
  templateKey: OpsTemplateKey
  appointmentId: string
  customerId: string
  delayHours: number
  payload: Record<string, unknown>
}) {
  const scheduledFor = new Date(Date.now() + params.delayHours * 60 * 60 * 1000)

  const { error } = await params.supabase
    .from('ops_communication_queue')
    .insert({
      template_key: params.templateKey,
      appointment_id: params.appointmentId,
      customer_id: params.customerId,
      scheduled_for: scheduledFor.toISOString(),
      status: 'pending',
      payload: params.payload,
    })

  if (error) {
    console.error(
      '[ops/communications] Failed to queue follow-up email:',
      error,
    )
  }
}

export type LifecycleNotificationSent = {
  template_key: string
  channel: 'sms' | 'email'
  body: string
  /** false when the body is a preview (e.g. template disabled or SMS not sent) */
  actually_sent?: boolean
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Escapes HTML and wraps bare URLs in anchor tags.
 */
function linkifyAndEscape(str: string): string {
  return str
    .split(/(https?:\/\/[^\s]+)/)
    .map((part, i) => {
      if (i % 2 === 1) {
        const safeUrl = part.replace(/"/g, '%22')
        return `<a href="${safeUrl}" style="color:#2d6a4f;font-weight:600;text-decoration:underline;">${escapeHtml(part)}</a>`
      }
      return escapeHtml(part)
    })
    .join('')
}

/**
 * Converts a single block of plain text into HTML.
 * Lines starting with "- " are rendered as a <ul>/<li> list.
 * Bare URLs become clickable links.
 */
function buildBlockHtml(block: string): string {
  const lines = block
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return ''

  const hasBullets = lines.some((l) => l.startsWith('- '))
  if (!hasBullets) {
    return `<p style="margin:0 0 16px 0;line-height:1.6;">${lines.map(linkifyAndEscape).join('<br>')}</p>`
  }

  let html = ''
  let bulletBuffer: string[] = []

  const flushBullets = () => {
    if (bulletBuffer.length === 0) return
    const items = bulletBuffer
      .map(
        (b) =>
          `<li style="margin-bottom:5px;line-height:1.5;">${linkifyAndEscape(b)}</li>`,
      )
      .join('')
    html += `<ul style="margin:0 0 12px 0;padding-left:22px;">${items}</ul>`
    bulletBuffer = []
  }

  for (const line of lines) {
    if (line.startsWith('- ')) {
      bulletBuffer.push(line.slice(2))
    } else {
      flushBullets()
      html += `<p style="margin:0 0 10px 0;line-height:1.6;">${linkifyAndEscape(line)}</p>`
    }
  }
  flushBullets()

  return html
}

function buildTechnicianCardHtml(
  templateKey: string,
  technician?: TechnicianEmailProfile | null,
): string {
  if (templateKey !== 'job_scheduled_email' || !technician) return ''

  const initials = technician.displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
  const photoHtml = technician.imageUrl
    ? `<img
                          src="${escapeHtml(technician.imageUrl)}"
                          alt="${escapeHtml(technician.displayName)}"
                          width="64"
                          height="64"
                          style="display:block;width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid #2d6a4f;"
                        />`
    : `<div
                          style="display:block;width:64px;height:64px;border-radius:50%;border:2px solid #2d6a4f;background:#2d6a4f;color:#ffffff;font-size:22px;font-weight:700;line-height:64px;text-align:center;"
                        >${escapeHtml(initials || technician.firstName[0] || 'S')}</div>`

  return `
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 24px 0;border:1px solid #d8e8df;border-radius:12px;background:#f4fbf7;">
              <tr>
                <td style="padding:16px;">
                  <table cellpadding="0" cellspacing="0" style="width:100%;">
                    <tr>
                      <td width="76" style="width:76px;vertical-align:middle;">
                        ${photoHtml}
                      </td>
                      <td style="vertical-align:middle;color:#173f2c;">
                        <p style="margin:0 0 4px 0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#2d6a4f;">Your technician</p>
                        <p style="margin:0;font-size:18px;font-weight:700;color:#173f2c;">${escapeHtml(technician.displayName)}</p>
                        <p style="margin:4px 0 0 0;font-size:14px;line-height:1.4;color:#46685a;">${escapeHtml(technician.firstName)} will be the Sasquatch team member arriving for your appointment.</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>`
}

function technicianProfileFromPayload(
  value: unknown,
): TechnicianEmailProfile | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const displayName =
    typeof record.displayName === 'string' ? record.displayName.trim() : ''
  const firstName =
    typeof record.firstName === 'string' ? record.firstName.trim() : ''
  const imageUrl =
    typeof record.imageUrl === 'string' ? record.imageUrl.trim() : ''

  if (!displayName || !firstName) return null
  return {
    displayName,
    firstName,
    imageUrl: imageUrl || null,
  }
}

/**
 * Converts plain-text template output into a clean, branded HTML email.
 * Handles real newlines (\n) and literal "\n" sequences both safely.
 * Bullet point lines ("- …") are rendered as proper lists; URLs become links.
 *
 * Exported so the admin email preview API can render a stored body_text.
 */
export function buildEmailHtml(
  body: string,
  templateKey: string,
  options?: {
    technician?: TechnicianEmailProfile | null
  },
): string {
  // Normalize literal \n sequences (stored in some templates) to real newlines
  const normalized = body.replace(/\\n/g, '\n')

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(buildBlockHtml)
    .join('')

  const accentColor = '#2d6a4f'
  const technicianCard = buildTechnicianCardHtml(
    templateKey,
    options?.technician,
  )

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:${accentColor};padding:24px 32px;text-align:center;">
            <img
              src="https://sightings.sasquatchcarpet.com/sasquatch-logo.png"
              alt="Sasquatch Carpet Cleaning"
              width="160"
              style="display:block;margin:0 auto;max-width:160px;height:auto;"
            />
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px;color:#333333;font-size:15px;">
            ${technicianCard}
            ${paragraphs}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9f9f9;padding:20px 32px;border-top:1px solid #eeeeee;text-align:center;color:#888888;font-size:12px;">
            <p style="margin:0 0 6px 0;">
              Questions or changes? <strong>Text us at (719) 249-8791</strong> and we'll help.
            </p>
            <p style="margin:0;">Sasquatch Carpet Cleaning · Colorado Springs, CO</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/** Rendered On My Way SMS from DB template (even if `is_enabled` is false). */
export async function getOnMyWaySmsRenderedBody(
  appointmentId: string,
): Promise<string | null> {
  const supabase = createAdminClient()
  const { data: template } = await supabase
    .from('ops_communication_templates')
    .select('body_template')
    .eq('template_key', 'on_my_way_sms')
    .maybeSingle()

  if (!template?.body_template) return null

  const { context } = await getAppointmentContext(supabase, appointmentId)
  if (!context) return null

  return renderTemplate(template.body_template, context)
}

export async function sendOpsLifecycleCommunications(params: {
  event: OpsLifecycleEvent
  appointmentId: string
}): Promise<{ sent: LifecycleNotificationSent[] }> {
  const sent: LifecycleNotificationSent[] = []
  const supabase = createAdminClient()
  const { appointment, context, technician } = await getAppointmentContext(
    supabase,
    params.appointmentId,
  )
  if (!appointment || !context) return { sent: [] }
  if (
    appointment.internal_notes?.includes(TEMP_SUPPRESS_CUSTOMER_COMMS_MARKER)
  ) {
    return { sent: [] }
  }

  const templates = await getTemplatesForEvent(supabase, params.event)
  if (templates.length === 0) return { sent: [] }

  const customer = unwrapRelation(appointment.ops_customers)
  const customerPhone = customer?.phone || ''
  const customerEmail = isDeliverableCustomerEmail(customer?.email)
    ? customer.email
    : ''
  const customerEmailOptOut = customer?.email_opt_out ?? false
  const customerBlacklisted = customerPhone
    ? await isBlacklisted(customerPhone)
    : false

  if (customerBlacklisted) {
    return { sent: [] }
  }

  const resendApiKey = process.env.RESEND_API_KEY
  const resend = resendApiKey ? new Resend(resendApiKey) : null
  const twilioFrom = process.env.TWILIO_PHONE_NUMBER
  const fromEmail =
    process.env.OPS_EMAIL_FROM ||
    'Sasquatch Carpet Cleaning <onboarding@resend.dev>'

  for (const template of templates) {
    const body = renderTemplate(template.body_template, context)
    const subject = renderTemplate(template.subject_template || '', context)

    if (
      template.template_key === 'satisfaction_checkin_email' &&
      template.delay_hours > 0
    ) {
      if (customerEmailOptOut) continue
      await queueFollowupEmail({
        supabase,
        templateKey: template.template_key,
        appointmentId: appointment.id,
        customerId: appointment.customer_id,
        delayHours: template.delay_hours,
        payload: {
          subject,
          body,
          to: customerEmail,
          technician,
        },
      })
      continue
    }

    if (template.channel === 'sms') {
      if (!customerPhone) continue
      await sendCustomerSMS(
        customerPhone,
        body,
        undefined,
        `ops_${template.template_key}`,
        twilioFrom,
      )
      sent.push({
        template_key: template.template_key,
        channel: 'sms',
        body,
        actually_sent: true,
      })
      continue
    }

    if (!resend || !customerEmail || customerEmailOptOut) continue
    const bcc = process.env.OPS_EMAIL_BCC || undefined
    try {
      const emailResult = await resend.emails.send({
        from: fromEmail,
        to: customerEmail,
        bcc,
        subject: subject || 'Update from Sasquatch Carpet Cleaning',
        html: buildEmailHtml(body, template.template_key, { technician }),
      })
      sent.push({
        template_key: template.template_key,
        channel: 'email',
        body,
      })
      await supabase.from('ops_email_log').insert({
        appointment_id: appointment.id,
        customer_id: appointment.customer_id,
        template_key: template.template_key,
        to_email: customerEmail,
        subject: subject || 'Update from Sasquatch Carpet Cleaning',
        resend_id: emailResult.data?.id || null,
        status: 'sent',
        body_text: body,
      })
    } catch (error) {
      console.error('[ops/communications] Failed to send email:', error)
      await supabase.from('ops_email_log').insert({
        appointment_id: appointment.id,
        customer_id: appointment.customer_id,
        template_key: template.template_key,
        to_email: customerEmail,
        subject: subject || 'Update from Sasquatch Carpet Cleaning',
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        body_text: body,
      })
    }
  }

  return { sent }
}

export async function getOpsCommunicationQueueStats() {
  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()
  const oneDayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [
    pendingCountResult,
    dueCountResult,
    failedCountResult,
    sentLast24hCountResult,
  ] = await Promise.all([
    supabase
      .from('ops_communication_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .from('ops_communication_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')
      .lte('scheduled_for', nowIso),
    supabase
      .from('ops_communication_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'failed'),
    supabase
      .from('ops_communication_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'sent')
      .gte('sent_at', oneDayAgoIso),
  ])

  return {
    pending: pendingCountResult.count || 0,
    due_now: dueCountResult.count || 0,
    failed: failedCountResult.count || 0,
    sent_last_24h: sentLast24hCountResult.count || 0,
  }
}

export async function processOpsCommunicationQueue(params?: {
  limit?: number
}) {
  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()
  const limit = Math.max(1, Math.min(params?.limit || 50, 200))

  const { data: dueItemsRaw, error: dueError } = await supabase
    .from('ops_communication_queue')
    .select(
      'id, template_key, scheduled_for, payload, appointment_id, customer_id',
    )
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(limit)

  if (dueError) {
    throw new Error(`Failed to load queue: ${dueError.message}`)
  }

  const dueItems = (dueItemsRaw || []) as QueueItem[]
  if (dueItems.length === 0) {
    return { processed: 0, sent: 0, failed: 0, errors: [] as string[] }
  }

  const templateKeys = [...new Set(dueItems.map((item) => item.template_key))]
  const { data: templatesRaw, error: templatesError } = await supabase
    .from('ops_communication_templates')
    .select('template_key, channel')
    .in('template_key', templateKeys)

  if (templatesError) {
    throw new Error(`Failed to load templates: ${templatesError.message}`)
  }

  const templateChannelByKey = new Map(
    (templatesRaw || []).map((row) => [row.template_key, row.channel]),
  )

  const customerIds = [...new Set(dueItems.map((item) => item.customer_id))]
  const { data: customersRaw, error: customersError } = await supabase
    .from('ops_customers')
    .select('id, phone, email_opt_out')
    .in('id', customerIds)

  if (customersError) {
    throw new Error(
      `Failed to load queued customers: ${customersError.message}`,
    )
  }

  const customerById = new Map(
    (customersRaw || []).map((row) => [
      row.id,
      {
        phone: String(row.phone || ''),
        emailOptOut: row.email_opt_out === true,
      },
    ]),
  )
  const queuedPhones = [
    ...new Set(
      (customersRaw || [])
        .map((row) => normalizePhone(String(row.phone || '')))
        .filter((phone) => phone.length === 10),
    ),
  ]
  const { data: blacklistRaw, error: blacklistError } =
    queuedPhones.length > 0
      ? await supabase
          .from('blacklist')
          .select('phone')
          .in('phone', queuedPhones)
      : { data: [], error: null }

  if (blacklistError) {
    throw new Error(`Failed to load blacklist: ${blacklistError.message}`)
  }

  const blacklistedPhones = new Set(
    (blacklistRaw || []).map((row) => normalizePhone(String(row.phone || ''))),
  )

  const resendApiKey = process.env.RESEND_API_KEY
  const resend = resendApiKey ? new Resend(resendApiKey) : null
  const fromEmail =
    process.env.OPS_EMAIL_FROM ||
    'Sasquatch Carpet Cleaning <onboarding@resend.dev>'
  const twilioFrom = process.env.TWILIO_PHONE_NUMBER

  const results = {
    processed: dueItems.length,
    sent: 0,
    failed: 0,
    errors: [] as string[],
  }

  for (const item of dueItems) {
    const channel = templateChannelByKey.get(item.template_key)
    const payload = item.payload || {}
    const body = String(payload.body || '').trim()
    const customer = customerById.get(item.customer_id)
    const normalizedPhone = normalizePhone(customer?.phone || '')
    const isQueuedCustomerBlacklisted =
      normalizedPhone.length === 10 && blacklistedPhones.has(normalizedPhone)

    try {
      if (!channel) {
        throw new Error(`No template channel found for ${item.template_key}`)
      }
      if (!body) {
        throw new Error('Missing message body')
      }

      if (channel === 'email') {
        if (customer?.emailOptOut) {
          throw new Error('Suppressed: customer has email opt-out enabled')
        }
        if (isQueuedCustomerBlacklisted) {
          throw new Error('Suppressed: customer is blacklisted')
        }
        const to = String(payload.to || '').trim()
        const subject = String(
          payload.subject || 'Update from Sasquatch Carpet Cleaning',
        ).trim()
        if (!resend) {
          throw new Error('RESEND_API_KEY not configured')
        }
        if (!to) {
          throw new Error('Missing recipient email')
        }
        const bcc = process.env.OPS_EMAIL_BCC || undefined
        const technician = technicianProfileFromPayload(payload.technician)
        const emailResult = await resend.emails.send({
          from: fromEmail,
          to,
          bcc,
          subject,
          html: buildEmailHtml(body, item.template_key as OpsTemplateKey, {
            technician,
          }),
        })
        await supabase.from('ops_email_log').insert({
          appointment_id: item.appointment_id,
          customer_id: item.customer_id,
          template_key: item.template_key,
          to_email: to,
          subject,
          resend_id: emailResult.data?.id || null,
          status: 'sent',
          body_text: body,
        })
      } else {
        if (isQueuedCustomerBlacklisted) {
          throw new Error('Suppressed: customer is blacklisted')
        }
        const toPhone = String(payload.to_phone || '').trim()
        if (!toPhone) {
          throw new Error('Missing recipient phone')
        }
        await sendCustomerSMS(
          toPhone,
          body,
          undefined,
          `ops_queue_${item.template_key}`,
          twilioFrom,
        )
      }

      const { error: sentUpdateError } = await supabase
        .from('ops_communication_queue')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id)

      if (sentUpdateError) {
        throw new Error(`Sent update failed: ${sentUpdateError.message}`)
      }

      results.sent++
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown queue send error'
      results.failed++
      results.errors.push(`${item.id}: ${message}`)

      const ch = templateChannelByKey.get(item.template_key)
      if (ch === 'email') {
        const payload = item.payload || {}
        const bodyText = String(payload.body || '').trim()
        const toEmail = String(payload.to || '').trim()
        const subj = String(
          payload.subject || 'Update from Sasquatch Carpet Cleaning',
        ).trim()
        await supabase.from('ops_email_log').insert({
          appointment_id: item.appointment_id,
          customer_id: item.customer_id,
          template_key: item.template_key,
          to_email: toEmail || 'unknown',
          subject: subj,
          status: 'failed',
          error_message: message,
          body_text: bodyText || null,
        })
      }

      await supabase
        .from('ops_communication_queue')
        .update({
          status: 'failed',
          error_message: message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id)
    }
  }

  return results
}

export async function sendDayBeforeReminderSms(params?: {
  targetHourMountain?: number
  bypassHourCheck?: boolean
}) {
  const supabase = createAdminClient()
  const now = new Date()
  const nowMountain = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/Denver' }),
  )
  const targetHour = Math.max(0, Math.min(23, params?.targetHourMountain ?? 9))
  if (!params?.bypassHourCheck && nowMountain.getHours() !== targetHour) {
    return {
      sent: 0,
      skipped_outside_hour: true,
      target_hour_mt: targetHour,
      now_hour_mt: nowMountain.getHours(),
      checked: 0,
    }
  }

  const tomorrow = new Date(nowMountain)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowDate = tomorrow.toLocaleDateString('en-CA')

  const { data: appointmentsRaw, error: appointmentsError } = await supabase
    .from('ops_appointments')
    .select(APPOINTMENT_SELECT)
    .eq('appointment_date', tomorrowDate)
    .not('status', 'in', '(cancelled,completed)')

  if (appointmentsError) {
    throw new Error(
      `[day-before-reminders] Failed to load appointments: ${appointmentsError.message}`,
    )
  }

  const appointments = (appointmentsRaw || []) as AppointmentWithRelations[]
  if (appointments.length === 0) {
    return {
      sent: 0,
      checked: 0,
      message: `No appointments for ${tomorrowDate}`,
    }
  }

  const { data: templatesRaw, error: templatesError } = await supabase
    .from('ops_communication_templates')
    .select('template_key, body_template, is_enabled')
    .in('template_key', [
      'day_before_residential_sms',
      'day_before_recovery_village_sms',
    ])

  if (templatesError) {
    throw new Error(
      `[day-before-reminders] Failed to load templates: ${templatesError.message}`,
    )
  }

  const templateByKey = new Map(
    (templatesRaw || []).map((row) => [row.template_key, row]),
  )
  const twilioFrom = process.env.TWILIO_PHONE_NUMBER

  let sent = 0
  let skippedNoPhone = 0
  let skippedDuplicate = 0
  let skippedTemplateDisabled = 0

  for (const appointment of appointments) {
    if (
      appointment.internal_notes?.includes(TEMP_SUPPRESS_CUSTOMER_COMMS_MARKER)
    ) {
      continue
    }

    const customer = unwrapRelation(appointment.ops_customers)
    const customerPhone = customer?.phone?.trim() || ''
    if (!customerPhone) {
      skippedNoPhone++
      continue
    }

    const isRecoveryVillage =
      (customer?.business_name || '').trim() === 'Recovery Village'
    const templateKey = isRecoveryVillage
      ? 'day_before_recovery_village_sms'
      : 'day_before_residential_sms'
    const template = templateByKey.get(templateKey)
    if (!template?.is_enabled || !template.body_template?.trim()) {
      skippedTemplateDisabled++
      continue
    }

    const { context } = await getAppointmentContext(supabase, appointment.id)
    if (!context) continue
    const body = renderTemplate(template.body_template, context)
    if (!body.trim()) continue

    const dedupeKey = `day_before_sms_${appointment.id}_${tomorrowDate}`
    const { data: existingReminder } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', dedupeKey)
      .maybeSingle()
    if (existingReminder) {
      skippedDuplicate++
      continue
    }

    await sendCustomerSMS(
      customerPhone,
      body,
      undefined,
      `ops_${templateKey}`,
      twilioFrom,
    )

    await supabase.from('system_settings').upsert({
      key: dedupeKey,
      value: JSON.stringify({
        sent_at: new Date().toISOString(),
        template_key: templateKey,
      }),
      updated_at: new Date().toISOString(),
    })

    sent++
  }

  return {
    sent,
    checked: appointments.length,
    skipped_no_phone: skippedNoPhone,
    skipped_duplicate: skippedDuplicate,
    skipped_template_disabled: skippedTemplateDisabled,
    target_date: tomorrowDate,
  }
}
