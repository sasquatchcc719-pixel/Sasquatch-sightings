import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { isBlacklisted } from '@/lib/blacklist'
import { buildEmailHtml } from '@/lib/ops/communications'
import { isDeliverableCustomerEmail } from '@/lib/ops/email'
import { isWarrantyAppointment } from '@/lib/ops/warranty-appointment'
import { generateInvoicePDF } from '@/lib/ops/pdf/generate'
import {
  INVOICE_CHECK_PAYEE,
  INVOICE_MAILING_ADDRESS,
} from '@/lib/ops/invoice-remittance'

const TABLE = 'ops_invoice_email_deliveries'
const TEMPLATE = 'invoice_on_completion'
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000

type EmailPayload = {
  from: string
  to: string
  bcc?: string
  subject: string
  text: string
  html: string
  attachments: Array<{ filename: string; content: string }>
}
type Delivery = {
  id: string
  invoice_id: string
  appointment_id: string
  customer_id: string
  status: string
  payload: EmailPayload | null
  source_hash: string | null
  first_attempt_at: string | null
  resend_id: string | null
  sent_at: string | null
  created_at: string
}

const one = <T>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? value[0] || null : value

export function invoiceDueDate(serviceDate: string, days: number | null) {
  if (days == null || !Number.isInteger(days) || days < 0) return null
  const date = new Date(`${serviceDate}T12:00:00Z`)
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid service date')
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

async function loadInvoice(supabase: SupabaseClient, appointmentId: string) {
  const { data: appt, error } = await supabase
    .from('ops_appointments')
    .select(
      `id, customer_id, status, kind, visit_type, restoration_project_id,
      service_concern_id, recurring_template_id, internal_notes, appointment_date,
      ops_appointment_line_items(name_snapshot, service_catalog_items(slug)),
      ops_customers!ops_appointments_customer_id_fkey(id, full_name, business_name,
        email, phone, email_opt_out, billing_mode, quickbooks_payment_terms_days),
      ops_service_addresses(street_1, street_2, city, state, zip_code)`,
    )
    .eq('id', appointmentId)
    .maybeSingle()
  if (error) throw error
  if (!appt || appt.status !== 'completed') return null
  if (
    appt.kind === 'estimate' ||
    appt.kind === 'restoration' ||
    appt.visit_type ||
    appt.restoration_project_id ||
    isWarrantyAppointment(appt) ||
    appt.internal_notes?.includes('TEMP_SUPPRESS_CUSTOMER_COMMS_')
  )
    return null
  const customer = one(appt.ops_customers)
  const address = one(appt.ops_service_addresses)
  if (!customer || customer.billing_mode === 'monthly_consolidated') return null
  if (appt.recurring_template_id) {
    const { data: template, error: templateError } = await supabase
      .from('ops_recurring_templates')
      .select('invoice_mode')
      .eq('id', appt.recurring_template_id)
      .maybeSingle()
    if (templateError) throw templateError
    if (template?.invoice_mode === 'batch_monthly') return null
  }
  const { data: batch, error: batchError } = await supabase
    .from('ops_batch_invoice_entries')
    .select('id')
    .eq('appointment_id', appointmentId)
    .limit(1)
    .maybeSingle()
  if (batchError) throw batchError
  if (batch) return null
  const { data: invoice, error: invoiceError } = await supabase
    .from('ops_invoices')
    .select(
      `id, invoice_number, status, payment_status, subtotal, total,
      discount_amount, percentage_discount_amount,
      ops_invoice_line_items(description, quantity, unit_price, line_total, excluded_at, service_catalog_items(name, slug, category), ops_appointment_line_items(service_catalog_items(name, slug, category)))`,
    )
    .eq('appointment_id', appointmentId)
    .maybeSingle()
  if (invoiceError) throw invoiceError
  if (
    !invoice ||
    !['ready', 'sent'].includes(invoice.status) ||
    invoice.payment_status !== 'unpaid' ||
    Number(invoice.total) <= 0
  )
    return null
  if (
    customer.email_opt_out ||
    (customer.phone && (await isBlacklisted(customer.phone)))
  )
    return null
  if (!address || !invoice.invoice_number)
    throw new Error('Invoice address or number is missing')
  const lines = (invoice.ops_invoice_line_items || []).filter(
    (line) => !line.excluded_at,
  )
  return { appt, customer, address, invoice, lines }
}

type InvoiceContext = NonNullable<Awaited<ReturnType<typeof loadInvoice>>>

export function buildCloseOutInvoiceBody(params: {
  customerName: string
  invoiceNumber: number
  serviceAddress: string
  serviceDate: string
  total: number
  dueDate: string | null
}) {
  return [
    `Hello ${params.customerName},`,
    `Thank you for choosing Sasquatch Carpet Cleaning. Your itemized invoice #${params.invoiceNumber} is attached.`,
    `Service address: ${params.serviceAddress}\nService date: ${params.serviceDate}\nTotal due: $${params.total.toFixed(2)}${params.dueDate ? `\nPayment due: ${params.dueDate}` : ''}`,
    `Please make checks payable to ${INVOICE_CHECK_PAYEE} and mail to:\n${INVOICE_MAILING_ADDRESS}\nInclude invoice #${params.invoiceNumber} on the memo line.`,
    'Questions about your invoice? Reply to this email or call (719) 249-8791. Thank you!',
  ].join('\n\n')
}

function sourceHash(context: InvoiceContext) {
  return createHash('sha256').update(JSON.stringify(context)).digest('hex')
}

async function preparePayload(context: InvoiceContext): Promise<EmailPayload> {
  const { appt, customer, address, invoice, lines } = context
  if (!isDeliverableCustomerEmail(customer.email)) {
    throw new Error('Customer has no deliverable email address on file')
  }
  const customerName =
    customer.business_name || customer.full_name || 'Customer'
  const serviceAddress = [
    address.street_1,
    address.street_2,
    `${address.city}, ${address.state} ${address.zip_code}`,
  ]
    .filter(Boolean)
    .join(', ')
  const dueDate = invoiceDueDate(
    appt.appointment_date,
    customer.quickbooks_payment_terms_days,
  )
  const text = buildCloseOutInvoiceBody({
    customerName,
    serviceAddress,
    dueDate,
    invoiceNumber: invoice.invoice_number,
    serviceDate: appt.appointment_date,
    total: Number(invoice.total),
  })
  const pdf = await generateInvoicePDF({
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
    dueDate,
    isPaid: false,
    customerName,
    serviceAddress,
    serviceDate: appt.appointment_date,
    lineItems: lines,
    subtotal: Number(invoice.subtotal),
    total: Number(invoice.total),
    discountAmount:
      Number(invoice.discount_amount || 0) +
      Number(invoice.percentage_discount_amount || 0),
  })
  if (!pdf)
    throw new Error('Invoice PDF could not be generated; email was not sent')
  return {
    from:
      process.env.OPS_EMAIL_FROM ||
      'Sasquatch Carpet Cleaning <onboarding@resend.dev>',
    to: customer.email.trim(),
    bcc: process.env.OPS_EMAIL_BCC || undefined,
    subject: `Invoice #${invoice.invoice_number} from Sasquatch Carpet Cleaning`,
    text,
    html: buildEmailHtml(text, TEMPLATE),
    attachments: [
      {
        filename: `Invoice-${invoice.invoice_number}.pdf`,
        content: pdf.toString('base64'),
      },
    ],
  }
}

async function updateDelivery(
  supabase: SupabaseClient,
  id: string,
  values: Record<string, unknown>,
) {
  const { error } = await supabase
    .from(TABLE)
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

async function logDelivery(
  supabase: SupabaseClient,
  record: Delivery,
  status: 'sent' | 'failed',
  errorMessage?: string,
) {
  const { error } = await supabase.from('ops_email_log').upsert(
    {
      id: record.id,
      appointment_id: record.appointment_id,
      customer_id: record.customer_id,
      template_key: TEMPLATE,
      to_email: record.payload?.to || 'missing',
      subject: record.payload?.subject || 'Close-out invoice email',
      body_text: record.payload?.text || null,
      resend_id: record.resend_id,
      status,
      error_message: errorMessage || null,
      sent_at: record.sent_at || new Date().toISOString(),
    },
    { onConflict: 'id' },
  )
  if (error) throw error
}

export async function deliverInvoiceEmail(
  supabase: SupabaseClient,
  initial: Delivery,
) {
  let record = initial
  try {
    if (
      record.status === 'sent' ||
      record.status === 'skipped' ||
      record.status === 'review'
    )
      return record.status
    if (!record.resend_id) {
      if (
        Date.now() - Date.parse(record.first_attempt_at || record.created_at) >=
        RETRY_WINDOW_MS
      ) {
        const message =
          'Automatic retry window elapsed; review delivery before resending'
        await logDelivery(supabase, record, 'failed', message)
        await updateDelivery(supabase, record.id, {
          status: 'review',
          error_message: message,
        })
        return 'review'
      }
      // Recheck paid status, monthly billing and customer suppression even on retries.
      const context = await loadInvoice(supabase, record.appointment_id)
      if (!context) {
        await updateDelivery(supabase, record.id, {
          status: 'skipped',
          payload: null,
        })
        return 'skipped'
      }
      const hash = sourceHash(context)
      if (!record.payload) {
        const payload = await preparePayload(context)
        const { data, error } = await supabase
          .from(TABLE)
          .update({
            payload,
            source_hash: hash,
            first_attempt_at: new Date().toISOString(),
          })
          .eq('id', record.id)
          .is('payload', null)
          .is('resend_id', null)
          .in('status', ['pending', 'failed'])
          .select('*')
          .maybeSingle()
        if (error) throw error
        if (data) record = data as Delivery
        else {
          const existing = await supabase
            .from(TABLE)
            .select('*')
            .eq('id', record.id)
            .single()
          if (existing.error) throw existing.error
          record = existing.data as Delivery
        }
        if (['sent', 'skipped', 'review'].includes(record.status))
          return record.status
        if (record.resend_id) return await deliverInvoiceEmail(supabase, record)
      }
      if (record.source_hash !== hash) {
        const message =
          'Invoice or recipient changed after email preparation; review before resending'
        await logDelivery(supabase, record, 'failed', message)
        await updateDelivery(supabase, record.id, {
          status: 'review',
          error_message: message,
        })
        return 'review'
      }
      if (!process.env.RESEND_API_KEY)
        throw new Error('Email service is not configured')
      const { data, error } = await new Resend(
        process.env.RESEND_API_KEY,
      ).emails.send(record.payload!, {
        idempotencyKey: `invoice-close-${record.invoice_id}`,
      })
      if (error || !data?.id)
        throw new Error(
          error?.message || 'Email provider did not confirm acceptance',
        )
      record = {
        ...record,
        resend_id: data.id,
        sent_at: new Date().toISOString(),
      }
      // Persist the provider ID before logging; a log failure must never resend.
      await updateDelivery(supabase, record.id, {
        resend_id: record.resend_id,
        sent_at: record.sent_at,
      })
    }
    await logDelivery(supabase, record, 'sent')
    await updateDelivery(supabase, record.id, {
      status: 'sent',
      payload: null,
      error_message: null,
    })
    return 'sent'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[invoice-email]', record.invoice_id, message)
    await logDelivery(supabase, record, 'failed', message)
    await updateDelivery(supabase, record.id, {
      status: 'failed',
      error_message: message,
    })
    return 'failed'
  }
}

/** Called only on explicit new completion, never by QuickBooks reconciliation. */
export async function emailInvoiceOnJobCompletion(
  supabase: SupabaseClient,
  params: {
    appointmentId: string
    previousStatus: string | null
    skipCustomerCommunications?: boolean
  },
) {
  if (
    params.previousStatus === 'completed' ||
    params.skipCustomerCommunications
  )
    return 'skipped'
  try {
    const context = await loadInvoice(supabase, params.appointmentId)
    if (!context) return 'skipped'
    const { error } = await supabase.from(TABLE).upsert(
      {
        invoice_id: context.invoice.id,
        appointment_id: params.appointmentId,
        customer_id: context.customer.id,
      },
      { onConflict: 'invoice_id', ignoreDuplicates: true },
    )
    if (error) throw error
    const result = await supabase
      .from(TABLE)
      .select('*')
      .eq('invoice_id', context.invoice.id)
      .single()
    if (result.error) throw result.error
    return await deliverInvoiceEmail(supabase, result.data as Delivery)
  } catch (error) {
    console.error('[invoice-email] enqueue failed', params.appointmentId, error)
    return 'failed'
  }
}

export async function retryInvoiceEmails(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .in('status', ['pending', 'failed'])
    .order('created_at')
    .limit(20)
  if (error) throw error
  const statuses: string[] = []
  for (const row of data || [])
    statuses.push(await deliverInvoiceEmail(supabase, row as Delivery))
  return statuses
}
