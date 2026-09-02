/**
 * Customer-facing accept / decline for an emailed estimate.
 *
 * POST only, and the token in the body is the only credential — there is no
 * session here. The token proves the caller was handed the link; it does not
 * carry the decision, so a mail scanner following links cannot accept a bid.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/supabase/server'
import {
  EstimateTokenError,
  verifyEstimateDecisionToken,
} from '@/lib/ops/estimate-decision-token'
import { buildEmailHtml } from '@/lib/ops/communications'
import { sendAdminAlert } from '@/lib/telegram'

type Decision = 'accepted' | 'declined'

/**
 * Which statuses a customer decision may overwrite.
 *
 * 'converted' is absent on purpose: once the estimate has become a real job on
 * the calendar, a stale link in an old inbox must not walk it backwards.
 */
const DECIDABLE_STATUSES = new Set(['draft', 'sent', 'accepted', 'declined'])

function money(n: number): string {
  return `$${Number(n || 0).toFixed(2)}`
}

/**
 * Email Charles when a customer decides. Telegram is the fast ping; this is the
 * copy that stays in his inbox and survives a phone reinstall.
 *
 * Same OWNER_ALERT_EMAIL / OPS_EMAIL_FROM convention the voicemail alert uses.
 */
async function sendOwnerEmail(params: {
  headline: string
  who: string
  facts: string[]
  decision: Decision
  adminLink: string
}): Promise<void> {
  const { headline, who, facts, decision, adminLink } = params

  const resendKey = process.env.RESEND_API_KEY
  const toEmail = process.env.OWNER_ALERT_EMAIL || 'sasquatchcc719@gmail.com'
  if (!resendKey) {
    console.warn('[estimates/decision] RESEND_API_KEY not set — no owner email')
    return
  }

  const bodyText = [
    `${who} just ${decision === 'accepted' ? 'accepted' : 'declined'} their estimate.`,
    facts.map((f) => `- ${f}`).join('\n'),
    decision === 'accepted'
      ? `Convert it to a job to get it on the calendar.`
      : `The estimate is marked declined. Nothing else to do unless you want to follow up.`,
  ].join('\n\n')

  const resend = new Resend(resendKey)
  const { error } = await resend.emails.send({
    from:
      process.env.OPS_EMAIL_FROM ||
      process.env.OPS_FROM_EMAIL ||
      'Sasquatch Carpet Cleaning <noreply@sasquatchcarpet.com>',
    to: toEmail,
    subject: `${headline} — ${who}`,
    html: buildEmailHtml(bodyText, 'owner_alert', {
      cta: {
        label: decision === 'accepted' ? 'Open the estimate' : 'View the estimate',
        url: adminLink,
      },
    }),
  })

  if (error) {
    throw new Error(error.message || 'Resend rejected the owner alert')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const token = String(body?.token || '').trim()
    const decision: Decision =
      body?.decision === 'declined' ? 'declined' : 'accepted'

    if (!token) {
      return NextResponse.json({ error: 'Missing link token.' }, { status: 400 })
    }

    let estimateId: string
    try {
      ;({ estimateId } = verifyEstimateDecisionToken(token))
    } catch (error) {
      if (error instanceof EstimateTokenError) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: error.code === 'expired' ? 410 : 400 },
        )
      }
      throw error
    }

    const supabase = createAdminClient()
    const { data: estimate, error: loadError } = await supabase
      .from('ops_appointments')
      .select(
        `
        id,
        estimate_status,
        quoted_total,
        converted_appointment_id,
        ops_customers!ops_appointments_customer_id_fkey ( full_name, phone, email ),
        ops_service_addresses ( street_1, city, state, zip_code )
      `,
      )
      .eq('id', estimateId)
      .eq('kind', 'estimate')
      .single()

    if (loadError || !estimate) {
      return NextResponse.json(
        { error: 'This estimate is no longer available.' },
        { status: 404 },
      )
    }

    const currentStatus = String(estimate.estimate_status || 'draft')
    if (
      !DECIDABLE_STATUSES.has(currentStatus) ||
      estimate.converted_appointment_id
    ) {
      return NextResponse.json(
        {
          error:
            'This estimate has already been scheduled. Please text us and we will help.',
        },
        { status: 409 },
      )
    }

    // Re-clicking the same choice is a no-op rather than an error — customers
    // do double-tap, and a scary red page on the second tap is not useful.
    if (currentStatus === decision) {
      return NextResponse.json({ success: true, decision, repeat: true })
    }

    const { error: updateError } = await supabase
      .from('ops_appointments')
      .update({
        estimate_status: decision,
        updated_at: new Date().toISOString(),
      })
      .eq('id', estimateId)
      .eq('kind', 'estimate')

    if (updateError) throw updateError

    const customer = Array.isArray(estimate.ops_customers)
      ? estimate.ops_customers[0]
      : estimate.ops_customers
    const addr = Array.isArray(estimate.ops_service_addresses)
      ? estimate.ops_service_addresses[0]
      : estimate.ops_service_addresses

    const who = customer?.full_name || 'A customer'
    const where = addr
      ? `${addr.street_1}, ${addr.city}, ${addr.state} ${addr.zip_code}`
      : 'address on file'

    const headline =
      decision === 'accepted' ? '✅ Estimate ACCEPTED' : '❌ Estimate declined'
    const adminLink = `https://sightings.sasquatchcarpet.com/admin/operations/estimates/${estimateId}`
    const facts = [
      where,
      `Quoted: ${money(Number(estimate.quoted_total ?? 0))}`,
      customer?.phone ? `Phone: ${customer.phone}` : null,
      customer?.email ? `Email: ${customer.email}` : null,
    ].filter((line): line is string => line !== null)

    // Charles works alone and needs to know immediately — an accepted bid is a
    // job to schedule. Telegram and email go out independently: neither one
    // failing may sink the other, and neither may roll back the decision the
    // customer already made.
    await Promise.allSettled([
      sendAdminAlert(
        headline,
        [
          `*${who}*`,
          ...facts,
          '',
          decision === 'accepted'
            ? 'Convert it to a job to get it on the calendar:'
            : 'Estimate marked declined.',
          adminLink,
        ].join('\n'),
      ).catch((alertError) => {
        console.error('[estimates/decision] Telegram alert failed:', alertError)
      }),
      sendOwnerEmail({ headline, who, facts, decision, adminLink }).catch(
        (mailError) => {
          console.error('[estimates/decision] Owner email failed:', mailError)
        },
      ),
    ])

    return NextResponse.json({ success: true, decision })
  } catch (error) {
    console.error('[estimates/decision] Error:', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please text us and we will help.' },
      { status: 500 },
    )
  }
}
