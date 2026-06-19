import { Resend } from 'resend'
import { createAdminClient } from '@/supabase/server'

type AdminClient = ReturnType<typeof createAdminClient>

/** system_settings key holding the QuickBooks receipt-capture inbox address. */
export const QB_RECEIPT_EMAIL_SETTING_KEY = 'quickbooks_receipt_email'

/**
 * The QuickBooks receipt-capture inbox (something@qbodocs.com). An env var
 * overrides the DB setting so production can be pinned without a DB write.
 * Returns null when no inbox has been configured yet — receipts are still
 * captured, just not forwarded.
 */
export async function getQuickbooksReceiptEmail(
  supabase: AdminClient,
): Promise<string | null> {
  const envEmail = process.env.QB_RECEIPT_EMAIL?.trim()
  if (envEmail) return envEmail

  const { data } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', QB_RECEIPT_EMAIL_SETTING_KEY)
    .maybeSingle()

  const value = data?.value as { email?: string } | string | null | undefined
  if (!value) return null
  const email = typeof value === 'string' ? value : value.email
  return email?.trim() || null
}

/** Persist the QuickBooks receipt inbox address (admin-configured). */
export async function setQuickbooksReceiptEmail(
  supabase: AdminClient,
  email: string,
): Promise<void> {
  await supabase.from('system_settings').upsert({
    key: QB_RECEIPT_EMAIL_SETTING_KEY,
    value: { email: email.trim() },
    updated_at: new Date().toISOString(),
  })
}

function receiptFromEmail(): string {
  return (
    process.env.OPS_EMAIL_FROM ||
    'Sasquatch Carpet Cleaning <onboarding@resend.dev>'
  )
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

type SendReceiptParams = {
  qbEmail: string
  imageBuffer: Buffer
  filename: string
  submittedByName: string
  category: string
  amount?: number | null
  note?: string | null
}

export type SendReceiptResult = {
  ok: boolean
  resendId?: string | null
  error?: string
}

/**
 * Forward a receipt image to the QuickBooks receipt-capture inbox by email.
 * QuickBooks reads the amount/vendor/date off the attached image itself; the
 * body is just human-readable context. The sending address (OPS_EMAIL_FROM)
 * must be authorized as a forwarding sender inside QuickBooks or QB will
 * silently ignore the email.
 */
export async function emailReceiptToQuickbooks(
  params: SendReceiptParams,
): Promise<SendReceiptResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not configured' }

  const resend = new Resend(apiKey)
  const amountLabel =
    params.amount != null && Number.isFinite(params.amount)
      ? ` $${params.amount.toFixed(2)}`
      : ''
  const subject = `${titleCase(params.category)} receipt${amountLabel} — ${params.submittedByName}`

  const detailRows = [
    ['Submitted by', params.submittedByName],
    ['Category', titleCase(params.category)],
    params.amount != null && Number.isFinite(params.amount)
      ? ['Amount', `$${params.amount.toFixed(2)}`]
      : null,
    params.note ? ['Note', params.note] : null,
  ].filter(Boolean) as [string, string][]

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;">
    <p>Expense receipt submitted from the Sasquatch tech portal. Receipt image attached.</p>
    <table style="border-collapse:collapse;">
      ${detailRows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:2px 12px 2px 0;color:#666;">${k}</td><td style="padding:2px 0;"><strong>${v}</strong></td></tr>`,
        )
        .join('')}
    </table>
  </div>`

  try {
    const result = await resend.emails.send({
      from: receiptFromEmail(),
      to: params.qbEmail,
      subject,
      html,
      attachments: [{ filename: params.filename, content: params.imageBuffer }],
    })
    if (result.error) return { ok: false, error: result.error.message }
    return { ok: true, resendId: result.data?.id ?? null }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Email send failed',
    }
  }
}
