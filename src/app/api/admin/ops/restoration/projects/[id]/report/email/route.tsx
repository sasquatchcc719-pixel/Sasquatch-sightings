import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { renderToBuffer } from '@react-pdf/renderer'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { DryingReportPDF } from '@/lib/ops/pdf/drying-report'
import { buildDryingReportData } from '@/lib/ops/pdf/drying-report-data'

/** Emails the same drying report PDF the "Drying report (PDF)" button downloads. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { id } = await params
    const supabase = createAdminClient()

    const resendKey = process.env.RESEND_API_KEY
    if (!resendKey) {
      return NextResponse.json(
        { error: 'Email service not configured.' },
        { status: 503 },
      )
    }

    const built = await buildDryingReportData(supabase, id, true)
    if (!built)
      return NextResponse.json({ error: 'project_not_found' }, { status: 404 })
    const { data, customer } = built

    const customerEmail = customer?.email ?? null
    if (!customerEmail) {
      return NextResponse.json(
        { error: 'No email address on file for this customer.' },
        { status: 422 },
      )
    }
    if (customer?.email_opt_out) {
      return NextResponse.json(
        { error: 'Customer is suppressed from email communications.' },
        { status: 422 },
      )
    }

    let buffer: Buffer
    try {
      buffer = Buffer.from(
        await renderToBuffer(<DryingReportPDF data={data} />),
      )
    } catch (renderError) {
      console.error(
        '[restoration/report/email] retrying without photos:',
        renderError,
      )
      buffer = Buffer.from(
        await renderToBuffer(
          <DryingReportPDF data={{ ...data, includePhotos: false }} />,
        ),
      )
    }

    const subject = 'Your drying report from Sasquatch Carpet Cleaning'
    /**
     * Every send is logged, success or failure.
     *
     * The first version of this route logged nothing, and when Charles asked
     * whether a real customer had been sent her report there was no way to
     * answer — the carpet invoice send writes ops_email_log, this did not.
     */
    const logRow = {
      customer_id: customer?.id ?? null,
      template_key: 'restoration_drying_report',
      to_email: customerEmail,
      subject,
      body_text: `Drying report for ${data.address || 'the property'}.`,
    }

    const resend = new Resend(resendKey)
    const fromEmail =
      process.env.OPS_EMAIL_FROM ||
      'Sasquatch Carpet Cleaning <onboarding@resend.dev>'
    const safeName = (data.customer.name || 'report')
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()

    const { data: resendData, error: resendError } = await resend.emails.send({
      from: fromEmail,
      to: customerEmail,
      subject,
      html: `
        <p>Hi ${data.customer.name},</p>
        <p>Attached is the drying report for your water mitigation project at ${data.address || 'your property'}.</p>
        <p>Questions? Call or text us at ${data.company.phone}. Thank you!</p>
      `,
      attachments: [
        { filename: `drying-report-${safeName}.pdf`, content: buffer },
      ],
    })

    if (resendError) {
      const msg =
        typeof resendError === 'object' &&
        resendError !== null &&
        'message' in resendError &&
        typeof (resendError as { message: unknown }).message === 'string'
          ? (resendError as { message: string }).message
          : 'Email provider rejected the message.'
      await supabase
        .from('ops_email_log')
        .insert({ ...logRow, status: 'failed', error_message: msg })
      return NextResponse.json({ error: msg }, { status: 502 })
    }

    await supabase
      .from('ops_email_log')
      .insert({ ...logRow, resend_id: resendData?.id || null, status: 'sent' })

    return NextResponse.json({
      ok: true,
      to: customerEmail,
      id: resendData?.id,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to email report'
    return NextResponse.json(
      { error: message },
      { status: message === 'Not authorized' ? 403 : 500 },
    )
  }
}
