import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { isDeliverableCustomerEmail } from '@/lib/ops/email'
import { sendCustomerSMS } from '@/lib/twilio'

const money = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )

/**
 * Send the estimate to the customer.
 *
 * Email carries the itemised scope; the text carries the number and says a
 * detailed copy is in their email, because a long line-item list is unreadable
 * as an SMS. Either channel can be sent on its own.
 *
 * This is a quote, not a bill: no invoice, no payment link, nothing to
 * QuickBooks.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['owner', 'admin', 'dispatcher', 'tech'])
    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))

    const wantsEmail = body.email !== false
    const wantsSms = body.sms === true

    const { data: project } = await supabase
      .from('restoration_projects')
      .select(
        `id, water_category,
         ops_customers!restoration_projects_customer_id_fkey ( full_name, business_name, email, phone ),
         ops_service_addresses ( street_1, street_2, city, state, zip_code )`,
      )
      .eq('id', id)
      .maybeSingle()

    if (!project) return NextResponse.json({ error: 'project_not_found' }, { status: 404 })

    const customer = Array.isArray(project.ops_customers)
      ? project.ops_customers[0]
      : project.ops_customers
    const address = Array.isArray(project.ops_service_addresses)
      ? project.ops_service_addresses[0]
      : project.ops_service_addresses

    const { data: lines } = await supabase
      .from('restoration_estimate_lines')
      .select('name_snapshot, quantity, units, days, unit_price, line_total, unit')
      .eq('project_id', id)
      .order('created_at')

    if (!lines || lines.length === 0) {
      return NextResponse.json({ error: 'estimate_is_empty' }, { status: 400 })
    }

    // Equipment reads the way it was quoted -- "8 x 3 days" rather than a bare
    // 24, which looks like a typo to whoever opens the email.
    const quantityLabel = (l: {
      quantity: number
      units: number | null
      days: number | null
      unit: string | null
    }) =>
      l.units != null && l.days != null
        ? `${l.units} x ${l.days} day${Number(l.days) === 1 ? '' : 's'}`
        : `${l.quantity} ${l.unit ?? ''}`.trim()

    const total = lines.reduce((sum, l) => sum + Number(l.line_total), 0)
    const addressLine = address
      ? `${address.street_1}, ${address.city}, ${address.state} ${address.zip_code}`
      : ''
    const name = customer?.business_name || customer?.full_name || 'there'

    const toEmail = body.to_email ? String(body.to_email).trim() : customer?.email
    const toPhone = body.to_phone ? String(body.to_phone).trim() : customer?.phone

    const sent: string[] = []
    const skipped: string[] = []

    if (wantsEmail) {
      const resendKey = process.env.RESEND_API_KEY
      if (!resendKey) {
        skipped.push('email: not configured')
      } else if (!isDeliverableCustomerEmail(toEmail)) {
        skipped.push('email: no deliverable address on file')
      } else {
        const rows = lines
          .map(
            (l) => `<tr>
              <td style="padding:6px 0;border-bottom:1px solid #eee">${escapeHtml(l.name_snapshot)}</td>
              <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${escapeHtml(quantityLabel(l))}</td>
              <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${money(Number(l.line_total))}</td>
            </tr>`,
          )
          .join('')

        await new Resend(resendKey).emails.send({
          from:
            process.env.OPS_EMAIL_FROM ||
            'Sasquatch Carpet Cleaning <onboarding@resend.dev>',
          to: toEmail,
          subject: `Your water mitigation estimate — ${money(total)}`,
          html: `<div style="font-family:system-ui,Arial,sans-serif;max-width:640px;color:#16242b">
            <h2 style="color:#0e6577;margin:0 0 4px">Water Mitigation Estimate</h2>
            <p style="color:#5c757f;margin:0 0 16px">Sasquatch Carpet Cleaning · (719) 249-8791</p>
            <p>Hi ${escapeHtml(name)},</p>
            <p>Here is the estimate for the water damage work at ${escapeHtml(addressLine)}.</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
              ${rows}
              <tr>
                <td style="padding:10px 0;font-weight:700">Estimated total</td>
                <td></td>
                <td style="padding:10px 0;text-align:right;font-weight:700">${money(total)}</td>
              </tr>
            </table>
            <p style="color:#5c757f;font-size:13px">
              This is an estimate of the work we expect to carry out. Water damage scope
              can change once materials are opened up, and we will talk to you before
              anything is added.
            </p>
            <p style="color:#5c757f;font-size:13px">Questions? Call or text (719) 249-8791.</p>
          </div>`,
        })
        sent.push('email')
      }
    }

    if (wantsSms) {
      if (!toPhone) {
        skipped.push('text: no phone on file')
      } else {
        await sendCustomerSMS(
          toPhone,
          `Sasquatch Carpet Cleaning — your water mitigation estimate is ${money(total)}. ` +
            `A full breakdown is in your email. Questions? Call or text (719) 249-8791.`,
          undefined,
          'restoration_estimate',
        )
        sent.push('text')
      }
    }

    if (sent.length > 0) {
      await supabase
        .from('restoration_projects')
        .update({ estimate_sent_at: new Date().toISOString() })
        .eq('id', id)
    }

    return NextResponse.json({ sent, skipped, total })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to send the estimate'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
