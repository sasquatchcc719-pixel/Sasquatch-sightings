import { Resend } from 'resend'
import { sendCustomerSMS } from '@/lib/twilio'
import { createAdminClient } from '@/supabase/server'

export const OPS_TEMPLATE_KEYS = [
  'job_scheduled_sms',
  'on_my_way_sms',
  'job_finished_sms',
  'job_rescheduled_sms',
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
}

type AppointmentWithRelations = {
  id: string
  customer_id: string
  appointment_date: string
  start_time: string
  end_time: string
  ops_customers:
    | {
        full_name: string
        first_name: string | null
        business_name: string | null
        email: string | null
        phone: string | null
      }
    | {
        full_name: string
        first_name: string | null
        business_name: string | null
        email: string | null
        phone: string | null
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
  }>
  quoted_total: number | null
}

const APPOINTMENT_SELECT = `
  id,
  customer_id,
  appointment_date,
  start_time,
  end_time,
  quoted_total,
  ops_customers (
    full_name,
    first_name,
    business_name,
    email,
    phone
  ),
  ops_service_addresses (
    street_1,
    city,
    state,
    zip_code
  ),
  ops_appointment_line_items (
    name_snapshot
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

function eventToTemplateKeys(event: OpsLifecycleEvent): OpsTemplateKey[] {
  if (event === 'job_scheduled') {
    return ['job_scheduled_sms', 'job_scheduled_email']
  }
  if (event === 'on_my_way') {
    return ['on_my_way_sms']
  }
  if (event === 'job_rescheduled') {
    return ['job_rescheduled_sms']
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
  const keys = eventToTemplateKeys(event)
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

async function getAppointmentContext(
  supabase: ReturnType<typeof createAdminClient>,
  appointmentId: string,
): Promise<{
  appointment: AppointmentWithRelations | null
  context: TemplateContext | null
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
    return { appointment: null, context: null }
  }

  const appointment = data as AppointmentWithRelations
  const customer = unwrapRelation(appointment.ops_customers)
  const address = unwrapRelation(appointment.ops_service_addresses)
  const firstName =
    customer?.first_name ||
    customer?.full_name?.split(' ').filter(Boolean)[0] ||
    'there'
  const context: TemplateContext = {
    first_name: firstName,
    full_name: customer?.full_name || '',
    business_name: customer?.business_name || '',
    company_name: 'Sasquatch Carpet Cleaning',
    appointment_date: toLocalDateString(appointment.appointment_date),
    start_time: toLocalTimeString(String(appointment.start_time)),
    end_time: toLocalTimeString(String(appointment.end_time)),
    service_summary:
      appointment.ops_appointment_line_items
        ?.map((item) => item.name_snapshot)
        .filter(Boolean)
        .join(', ') || 'Service appointment',
    address_line: address
      ? `${address.street_1}, ${address.city}, ${address.state} ${address.zip_code}`
      : '',
    tech_name: 'Charles',
    quoted_total: Number(appointment.quoted_total || 0).toFixed(2),
  }

  return { appointment, context }
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
  const { appointment, context } = await getAppointmentContext(
    supabase,
    params.appointmentId,
  )
  if (!appointment || !context) return { sent: [] }

  const templates = await getTemplatesForEvent(supabase, params.event)
  if (templates.length === 0) return { sent: [] }

  const customer = unwrapRelation(appointment.ops_customers)
  const customerPhone = customer?.phone || ''
  const customerEmail = customer?.email || ''

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

    if (!resend || !customerEmail) continue
    try {
      const emailResult = await resend.emails.send({
        from: fromEmail,
        to: customerEmail,
        subject: subject || 'Update from Sasquatch Carpet Cleaning',
        html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap;line-height:1.5;">${body}</div>`,
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
    .select('id, template_key, scheduled_for, payload')
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

    try {
      if (!channel) {
        throw new Error(`No template channel found for ${item.template_key}`)
      }
      if (!body) {
        throw new Error('Missing message body')
      }

      if (channel === 'email') {
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
        await resend.emails.send({
          from: fromEmail,
          to,
          subject,
          html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap;line-height:1.5;">${body}</div>`,
        })
      } else {
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
