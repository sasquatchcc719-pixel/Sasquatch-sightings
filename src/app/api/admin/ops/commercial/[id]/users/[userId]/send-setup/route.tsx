import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { Resend } from 'resend'
import { z } from 'zod'
import { requireAnyRole } from '@/lib/auth'
import { buildEmailHtml } from '@/lib/ops/communications'
import type { CommercialAgreement } from '@/lib/ops/commercial'
import { AGREEMENT_SELECT } from '@/lib/ops/commercial-server'
import { opsEmailBcc } from '@/lib/ops/email-bcc'
import { CommercialAgreementPDF } from '@/lib/ops/pdf/commercial-agreement'
import { createAdminClient } from '@/supabase/server'

const requestSchema = z.object({
  agreement_id: z.uuid(),
  operation_id: z.uuid(),
  subject: z.string().trim().min(5).max(200),
  body: z.string().trim().min(100).max(10000),
})

type Context = { params: Promise<{ id: string; userId: string }> }

export async function POST(request: NextRequest, { params }: Context) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { id: customerId, userId } = await params
    const body = requestSchema.parse(await request.json())
    const db = createAdminClient()

    const [customerResult, contactResult, agreementResult] = await Promise.all([
      db
        .from('ops_customers')
        .select('id,business_name,full_name')
        .eq('id', customerId)
        .eq('is_commercial', true)
        .maybeSingle(),
      db
        .from('ops_client_users')
        .select('id,user_id,display_name,email,is_active,can_sign_agreements')
        .eq('id', userId)
        .eq('customer_id', customerId)
        .maybeSingle(),
      db
        .from('ops_commercial_agreements')
        .select(AGREEMENT_SELECT)
        .eq('id', body.agreement_id)
        .eq('customer_id', customerId)
        .eq('status', 'published')
        .maybeSingle(),
    ])

    if (customerResult.error || contactResult.error || agreementResult.error)
      throw customerResult.error || contactResult.error || agreementResult.error
    if (!customerResult.data)
      return NextResponse.json(
        { error: 'Commercial account not found.' },
        { status: 404 },
      )
    const contact = contactResult.data
    if (!contact?.is_active || !contact.can_sign_agreements)
      return NextResponse.json(
        { error: 'Choose an active contact authorized to sign agreements.' },
        { status: 422 },
      )
    if (!agreementResult.data)
      return NextResponse.json(
        { error: 'Publish the agreement before sending customer setup.' },
        { status: 422 },
      )

    const { data: authUser, error: authError } =
      await db.auth.admin.getUserById(contact.user_id)
    if (
      authError ||
      !authUser.user ||
      authUser.user.email?.toLowerCase() !== contact.email.toLowerCase()
    )
      return NextResponse.json(
        { error: 'The portal login does not match this contact.' },
        { status: 409 },
      )

    const { data: link, error: linkError } = await db.auth.admin.generateLink({
      type: 'magiclink',
      email: contact.email,
    })
    if (linkError || !link.properties.hashed_token)
      return NextResponse.json(
        { error: 'Could not create a secure portal link.' },
        { status: 502 },
      )

    const origin = (
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.SITE_URL ||
      request.nextUrl.origin
    ).replace(/\/$/, '')
    const setupUrl = new URL('/auth/confirm', origin)
    setupUrl.searchParams.set('token_hash', link.properties.hashed_token)
    setupUrl.searchParams.set('type', 'magiclink')
    setupUrl.searchParams.set('next', '/client')

    const agreement = agreementResult.data as CommercialAgreement
    const pdf = Buffer.from(
      await renderToBuffer(<CommercialAgreementPDF agreement={agreement} />),
    )
    const resendKey = process.env.RESEND_API_KEY
    if (!resendKey)
      return NextResponse.json(
        { error: 'Email service not configured.' },
        { status: 503 },
      )

    const logRow = {
      customer_id: customerId,
      template_key: 'commercial_portal_setup',
      to_email: contact.email,
      subject: body.subject,
      body_text: body.body,
    }
    const safeBusinessName = (
      customerResult.data.business_name ||
      customerResult.data.full_name ||
      'commercial-account'
    )
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()

    const { data: delivery, error: deliveryError } = await new Resend(
      resendKey,
    ).emails.send(
      {
        from:
          process.env.OPS_EMAIL_FROM ||
          'Sasquatch Carpet Cleaning <onboarding@resend.dev>',
        to: contact.email,
        bcc: opsEmailBcc(),
        subject: body.subject,
        html: buildEmailHtml(body.body, 'commercial_portal_setup', {
          cta: {
            label: 'Open portal and review agreement',
            url: setupUrl.toString(),
          },
        }),
        attachments: [
          {
            filename: `${safeBusinessName}-service-agreement-v${agreement.version}.pdf`,
            content: pdf,
          },
        ],
      },
      { idempotencyKey: `commercial-setup-${body.operation_id}` },
    )

    if (deliveryError) {
      const message =
        typeof deliveryError === 'object' &&
        deliveryError !== null &&
        'message' in deliveryError &&
        typeof deliveryError.message === 'string'
          ? deliveryError.message
          : 'Email provider rejected the message.'
      await db
        .from('ops_email_log')
        .insert({ ...logRow, status: 'failed', error_message: message })
      return NextResponse.json({ error: message }, { status: 502 })
    }

    const { error: logError } = await db.from('ops_email_log').insert({
      ...logRow,
      status: 'sent',
      resend_id: delivery?.id || null,
    })
    if (logError) {
      console.error(
        '[commercial/setup-email] Message sent but delivery log failed:',
        logError,
      )
      return NextResponse.json(
        {
          error:
            'The setup email was sent, but its delivery record could not be saved. Retry this same send to repair the record without sending a duplicate email.',
        },
        { status: 500 },
      )
    }
    return NextResponse.json({ ok: true, to: contact.email, id: delivery?.id })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to send customer setup'
    return NextResponse.json(
      { error: message },
      { status: message === 'Not authorized' ? 403 : 400 },
    )
  }
}
