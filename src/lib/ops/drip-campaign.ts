import { createHmac } from 'crypto'
import { Resend } from 'resend'
import { createAdminClient } from '@/supabase/server'
import { isDeliverableCustomerEmail } from '@/lib/ops/email'
import { isBlacklisted } from '@/lib/blacklist'

const BOOK_URL = 'https://sightings.sasquatchcarpet.com/book'
const UNSUB_BASE =
  'https://sightings.sasquatchcarpet.com/api/public/unsubscribe'

type DripTemplate = {
  step_index: number
  label: string
  delay_days: number
  subject_template: string
  body_template: string
  is_enabled: boolean
}

type EnrollmentRow = {
  id: string
  customer_id: string
  appointment_id: string
  current_step: number
  next_send_at: string
  status: string
}

type DripSchedule = {
  step: number
  sendDate: string
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

export function nextDripSchedule(params: {
  templates: Pick<DripTemplate, 'step_index' | 'delay_days' | 'is_enabled'>[]
  completionDate: string
  asOfDate: string
  afterStep?: number
}): DripSchedule | null {
  const afterStep = params.afterStep ?? -1
  const nextTemplate = params.templates
    .filter((template) => template.is_enabled)
    .filter((template) => template.step_index > afterStep)
    .map((template) => ({
      step: template.step_index,
      sendDate: addDays(params.completionDate, template.delay_days),
    }))
    .find((schedule) => schedule.sendDate > params.asOfDate)

  return nextTemplate || null
}

// ── Unsubscribe token helpers ──

function getHmacSecret(): string {
  return (
    process.env.DRIP_HMAC_SECRET ||
    process.env.CRON_SECRET ||
    'sasquatch-drip-default'
  )
}

export function generateUnsubscribeToken(customerId: string): string {
  return createHmac('sha256', getHmacSecret()).update(customerId).digest('hex')
}

export function verifyUnsubscribeToken(
  customerId: string,
  token: string,
): boolean {
  const expected = generateUnsubscribeToken(customerId)
  return expected === token
}

function unsubscribeUrl(customerId: string): string {
  const token = generateUnsubscribeToken(customerId)
  return `${UNSUB_BASE}?cid=${customerId}&token=${token}`
}

// ── Template rendering ──

type DripContext = {
  first_name: string
  full_name: string
  city: string
  service_summary: string
}

function renderDripTemplate(template: string, ctx: DripContext): string {
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_, key: string) => (ctx as Record<string, string>)[key] ?? '',
  )
}

// ── Email HTML builder (drip-specific with Book Now + Unsubscribe) ──

function buildDripEmailHtml(body: string, customerId: string): string {
  const normalized = body.replace(/\\n/g, '\n')

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const lines = p.split('\n').map((l) => escapeHtml(l.trim()))
      return `<p style="margin:0 0 16px 0;line-height:1.6;">${lines.join('<br>')}</p>`
    })
    .join('')

  const accentColor = '#2d6a4f'

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
            ${paragraphs}

            <!-- Book Now button -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
              <tr><td align="center">
                <a href="${BOOK_URL}" style="display:inline-block;padding:14px 32px;background:#1a73e8;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:16px;">BOOK NOW</a>
              </td></tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9f9f9;padding:20px 32px;border-top:1px solid #eeeeee;text-align:center;color:#888888;font-size:12px;">
            <p style="margin:0 0 6px 0;">(719) 249-8791 | sasquatchcc719@gmail.com</p>
            <p style="margin:0 0 6px 0;">Sasquatch Carpet Cleaning · Palmer Lake, CO</p>
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Enrollment ──

export async function enrollCustomerInDrip(
  appointmentId: string,
): Promise<void> {
  const supabase = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data: appt } = await supabase
    .from('ops_appointments')
    .select(
      'id, customer_id, appointment_date, completed_at, status, recurring_template_id, kind, visit_type, restoration_project_id, ops_customers!ops_appointments_customer_id_fkey(email, email_opt_out)',
    )
    .eq('id', appointmentId)
    .single()

  if (!appt || appt.status !== 'completed' || appt.recurring_template_id) return

  /**
   * Never drip a flood customer.
   *
   * The post-job drip is carpet marketing — "how are the floors looking?",
   * then an upholstery offer. Charles: "we probably don't wanna send Carpet
   * cleaning marketing emails to flood victims." A water loss is the worst
   * week of someone's year, not a purchase to follow up on. It is the same
   * rule that already keeps review requests off restoration jobs.
   *
   * The guard lives here rather than at the five call sites because it was
   * missing from exactly one of them: the appointments route computes
   * isRestorationVisit and applies it three times, but not on the line that
   * enrols the drip. Jill Benns was booked for a carpet email four days after
   * her basement flooded.
   */
  if (
    appt.kind === 'restoration' ||
    appt.visit_type ||
    appt.restoration_project_id
  ) {
    return
  }

  const customer = Array.isArray(appt.ops_customers)
    ? appt.ops_customers[0]
    : appt.ops_customers
  if (!isDeliverableCustomerEmail(customer?.email) || customer.email_opt_out)
    return

  const { data: latestCompleted } = await supabase
    .from('ops_appointments')
    .select('id')
    .eq('customer_id', appt.customer_id)
    .eq('status', 'completed')
    .is('recurring_template_id', null)
    .order('appointment_date', { ascending: false })
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestCompleted?.id !== appointmentId) return

  const { data: templates } = await supabase
    .from('drip_email_templates')
    .select('step_index, delay_days, is_enabled')
    .order('step_index')

  const completionDate = String(
    appt.completed_at || appt.appointment_date,
  ).slice(0, 10)
  const schedule = nextDripSchedule({
    templates: templates || [],
    completionDate,
    asOfDate: today,
  })

  // Cancel any existing active enrollment for this customer
  await supabase
    .from('drip_campaign_enrollments')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('customer_id', appt.customer_id)
    .eq('status', 'active')

  if (!schedule) return

  const { data: existing } = await supabase
    .from('drip_campaign_enrollments')
    .select('id')
    .eq('appointment_id', appointmentId)
    .maybeSingle()

  if (existing?.id) {
    await supabase
      .from('drip_campaign_enrollments')
      .update({
        current_step: schedule.step,
        next_send_at: schedule.sendDate,
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
  } else {
    await supabase.from('drip_campaign_enrollments').insert({
      customer_id: appt.customer_id,
      appointment_id: appointmentId,
      current_step: schedule.step,
      next_send_at: schedule.sendDate,
      status: 'active',
    })
  }
}

// ── Process due drip emails (called by cron) ──

export async function processDripEmails(): Promise<{
  processed: number
  sent: number
  skipped: number
  failed: number
  errors: string[]
}> {
  const supabase = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  const results = {
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: [] as string[],
  }

  // Load all enabled templates
  const { data: templates } = await supabase
    .from('drip_email_templates')
    .select('*')
    .eq('is_enabled', true)
    .order('step_index')

  if (!templates || templates.length === 0) return results

  const templateMap = new Map<number, DripTemplate>(
    templates.map((t: DripTemplate) => [t.step_index, t]),
  )

  // Get enrollments due today or earlier
  const { data: enrollments } = await supabase
    .from('drip_campaign_enrollments')
    .select('*')
    .eq('status', 'active')
    .lte('next_send_at', today)
    .order('next_send_at')
    .limit(100)

  if (!enrollments || enrollments.length === 0) return results

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    results.errors.push('RESEND_API_KEY not configured')
    return results
  }
  const resend = new Resend(resendKey)
  const fromEmail =
    process.env.OPS_EMAIL_FROM ||
    'Sasquatch Carpet Cleaning <onboarding@resend.dev>'

  for (const enrollment of enrollments as EnrollmentRow[]) {
    results.processed++

    const template = templateMap.get(enrollment.current_step)
    if (!template) {
      // No template for this step — mark completed
      await supabase
        .from('drip_campaign_enrollments')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', enrollment.id)
      results.skipped++
      continue
    }

    // Get customer info
    const { data: customer } = await supabase
      .from('ops_customers')
      .select('id, email, phone, first_name, full_name, email_opt_out')
      .eq('id', enrollment.customer_id)
      .single()

    if (customer?.phone && (await isBlacklisted(customer.phone))) {
      await supabase.from('drip_email_log').insert({
        enrollment_id: enrollment.id,
        step: enrollment.current_step,
        template_label: template.label,
        status: 'skipped',
        error_message: 'blacklisted',
      })
      await supabase
        .from('drip_campaign_enrollments')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', enrollment.id)
      results.skipped++
      continue
    }

    if (
      !customer ||
      !isDeliverableCustomerEmail(customer.email) ||
      customer.email_opt_out
    ) {
      const skipReason = !customer
        ? 'customer_not_found'
        : customer.email_opt_out
          ? 'opted_out'
          : 'invalid_email'
      await supabase.from('drip_email_log').insert({
        enrollment_id: enrollment.id,
        step: enrollment.current_step,
        template_label: template.label,
        status: 'skipped',
        error_message: skipReason,
      })

      if (customer?.email_opt_out) {
        await supabase
          .from('drip_campaign_enrollments')
          .update({
            status: 'unsubscribed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', enrollment.id)
      } else {
        // No email (or customer missing): do not keep retrying on every cron run.
        await supabase
          .from('drip_campaign_enrollments')
          .update({
            status: 'cancelled',
            updated_at: new Date().toISOString(),
          })
          .eq('id', enrollment.id)
      }

      results.skipped++
      continue
    }

    // Get appointment for city context
    const { data: appt } = await supabase
      .from('ops_appointments')
      .select(
        `
        appointment_date,
        completed_at,
        ops_service_addresses(city),
        ops_appointment_line_items(name_snapshot)
      `,
      )
      .eq('id', enrollment.appointment_id)
      .single()

    const addressRaw = appt?.ops_service_addresses as
      | { city: string }
      | { city: string }[]
      | null
    const address = Array.isArray(addressRaw) ? addressRaw[0] : addressRaw
    const city = address?.city || 'the Tri-Lakes area'
    const lineItems =
      (appt?.ops_appointment_line_items as
        | { name_snapshot: string }[]
        | null) || []
    const serviceSummary =
      lineItems.map((li) => li.name_snapshot).join(', ') || 'Carpet Cleaning'

    const firstName =
      customer.first_name || customer.full_name?.split(' ')[0] || 'there'

    const ctx: DripContext = {
      first_name: firstName,
      full_name: customer.full_name || firstName,
      city,
      service_summary: serviceSummary,
    }

    const subject = renderDripTemplate(template.subject_template, ctx)
    const body = renderDripTemplate(template.body_template, ctx)
    const html = buildDripEmailHtml(body, customer.id)

    try {
      const emailResult = await resend.emails.send({
        from: fromEmail,
        to: customer.email,
        subject,
        html,
      })

      await supabase.from('drip_email_log').insert({
        enrollment_id: enrollment.id,
        step: enrollment.current_step,
        template_label: template.label,
        subject,
        to_email: customer.email,
        resend_id: emailResult.data?.id || null,
        status: 'sent',
      })

      // Advance to next step
      const completionDate = String(
        appt?.completed_at || appt?.appointment_date || today,
      ).slice(0, 10)
      const nextSchedule = nextDripSchedule({
        templates,
        completionDate,
        asOfDate: today,
        afterStep: enrollment.current_step,
      })

      if (nextSchedule) {
        await supabase
          .from('drip_campaign_enrollments')
          .update({
            current_step: nextSchedule.step,
            next_send_at: nextSchedule.sendDate,
            updated_at: new Date().toISOString(),
          })
          .eq('id', enrollment.id)
      } else {
        await supabase
          .from('drip_campaign_enrollments')
          .update({ status: 'completed', updated_at: new Date().toISOString() })
          .eq('id', enrollment.id)
      }

      results.sent++
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      results.failed++
      results.errors.push(`${enrollment.id}: ${errMsg}`)

      await supabase.from('drip_email_log').insert({
        enrollment_id: enrollment.id,
        step: enrollment.current_step,
        template_label: template.label,
        subject,
        to_email: customer.email,
        status: 'failed',
        error_message: errMsg,
      })
    }
  }

  return results
}
