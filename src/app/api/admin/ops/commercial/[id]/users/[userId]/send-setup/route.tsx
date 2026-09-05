import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
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

    const resendKey = process.env.RESEND_API_KEY
    if (!resendKey)
      return NextResponse.json(
        { error: 'Email service not configured.' },
        { status: 503 },
      )
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify([
          customerId,
          userId,
          body.agreement_id,
          contact.email,
          body.subject,
          body.body,
        ]),
      )
      .digest('hex')
    const { data: previous, error: previousError } = await db
      .from('ops_commercial_setup_deliveries')
      .select('*')
      .eq('operation_id', body.operation_id)
      .maybeSingle()
    if (previousError) throw previousError
    if (previous && previous.request_hash !== requestHash)
      return NextResponse.json(
        {
          error:
            'This send was already started with different details. Reopen email review to prepare a different message.',
        },
        { status: 409 },
      )
    let payload = previous?.payload
    let deliveredId: string | null = previous?.resend_id || null
    let sentAt: string | null = previous?.sent_at || null
    if (previous && !payload && !deliveredId)
      return NextResponse.json(
        {
          error:
            'This email is still being prepared. Retry shortly. If preparation was interrupted, close and reopen email review; no email was sent from this preparation.',
        },
        { status: 409 },
      )
    // Resend retains idempotency keys for 24 hours. Never retry beyond that
    // horizon, where delivery might be duplicated and the link has expired.
    if (
      previous &&
      !deliveredId &&
      Date.now() - Date.parse(previous.created_at) > 23 * 60 * 60 * 1000
    )
      return NextResponse.json(
        {
          error:
            'This send attempt is too old to retry safely. Check the email history before reopening review for a fresh setup link.',
        },
        { status: 409 },
      )

    if (!previous) {
      const { error: reserveError } = await db
        .from('ops_commercial_setup_deliveries')
        .insert({
          operation_id: body.operation_id,
          customer_id: customerId,
          contact_id: userId,
          agreement_id: body.agreement_id,
          request_hash: requestHash,
        })
      if (reserveError)
        return NextResponse.json(
          {
            error:
              'Could not reserve this send. Retry shortly; no email has been sent by this request.',
          },
          { status: 409 },
        )
      try {
        const { data: link, error: linkError } =
          await db.auth.admin.generateLink({
            type: 'magiclink',
            email: contact.email,
          })
        if (linkError || !link.properties.hashed_token)
          throw new Error('Could not create a secure portal link.')

        const origin = (
          process.env.NEXT_PUBLIC_SITE_URL ||
          process.env.SITE_URL ||
          request.nextUrl.origin
        ).replace(/\/$/, '')
        const setupUrl = new URL('/auth/portal-access', origin)
        setupUrl.searchParams.set('token_hash', link.properties.hashed_token)

        const agreement = agreementResult.data as CommercialAgreement
        const pdf = Buffer.from(
          await renderToBuffer(
            <CommercialAgreementPDF agreement={agreement} />,
          ),
        )
        const safeBusinessName = (
          customerResult.data.business_name ||
          customerResult.data.full_name ||
          'commercial-account'
        )
          .replace(/[^a-z0-9]+/gi, '-')
          .replace(/^-|-$/g, '')
          .toLowerCase()

        payload = {
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
              content: pdf.toString('base64'),
            },
          ],
        }
        const { error: saveError } = await db
          .from('ops_commercial_setup_deliveries')
          .update({ payload })
          .eq('operation_id', body.operation_id)
        if (saveError) throw saveError
      } catch (error) {
        await db
          .from('ops_commercial_setup_deliveries')
          .delete()
          .eq('operation_id', body.operation_id)
          .is('payload', null)
          .is('resend_id', null)
        throw error
      }
    }
    const logRow = {
      id: body.operation_id,
      customer_id: customerId,
      template_key: 'commercial_portal_setup',
      to_email: contact.email,
      subject: body.subject,
      body_text: body.body,
    }
    if (!deliveredId) {
      const { data: delivery, error: deliveryError } = await new Resend(
        resendKey,
      ).emails.send(payload, {
        idempotencyKey: `commercial-setup-${body.operation_id}`,
      })
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
          .upsert(
            { ...logRow, status: 'failed', error_message: message },
            { onConflict: 'id', ignoreDuplicates: true },
          )
        return NextResponse.json({ error: message }, { status: 502 })
      }
      if (!delivery?.id)
        throw new Error(
          'Email provider did not confirm delivery. Retry this same send.',
        )
      deliveredId = delivery.id
      sentAt = new Date().toISOString()
      const { error: recordError } = await db
        .from('ops_commercial_setup_deliveries')
        .update({ resend_id: deliveredId, sent_at: sentAt, payload: null })
        .eq('operation_id', body.operation_id)
      if (recordError)
        throw new Error(
          'Email accepted, but confirmation could not be saved. Retry this same send to finish recording it without sending a duplicate.',
        )
    }
    const { error: logError } = await db.from('ops_email_log').upsert({
      ...logRow,
      status: 'sent',
      error_message: null,
      resend_id: deliveredId,
      sent_at: sentAt,
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
    return NextResponse.json({ ok: true, to: contact.email, id: deliveredId })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to send customer setup'
    return NextResponse.json(
      { error: message },
      { status: message === 'Not authorized' ? 403 : 400 },
    )
  }
}
