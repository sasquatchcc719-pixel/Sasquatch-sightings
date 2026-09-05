import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireClientManager } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { sendTelegramNotification } from '@/lib/telegram'

const agreementNoteSchema = z
  .object({
    request_type: z.literal('scope_change'),
    agreement_id: z.uuid(),
    message: z.string().trim().min(1).max(2000),
  })
  .strict()

/** List saved agreement notes for this commercial client. */
export async function GET() {
  try {
    const { client } = await requireClientManager()
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('ops_client_change_requests')
      .select('*')
      .eq('customer_id', client.customer_id)
      .eq('request_type', 'scope_change')
      .order('created_at', { ascending: false })
      .limit(50)
    return NextResponse.json({ requests: data || [] })
  } catch {
    return NextResponse.json(
      { error: 'Failed to load agreement notes' },
      { status: 403 },
    )
  }
}

/**
 * Save a note against the exact published agreement the customer is reviewing
 * and alert Charles in Telegram. Additional-work and scheduling requests are
 * intentionally handled by phone or text instead of this portal.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireClientManager()
    const body = agreementNoteSchema.parse(await request.json())
    const supabase = createAdminClient()

    const { data: agreement, error: agreementError } = await supabase
      .from('ops_commercial_agreements')
      .select('id, version, status, content')
      .eq('id', body.agreement_id)
      .eq('customer_id', client.customer_id)
      .maybeSingle()
    if (agreementError) throw agreementError
    if (!agreement || agreement.status === 'draft')
      return NextResponse.json(
        { error: 'Agreement not found.' },
        { status: 404 },
      )
    if (agreement.status !== 'published')
      return NextResponse.json(
        {
          error:
            'This version is no longer open for review. Reload your account to view the current agreement.',
        },
        { status: 409 },
      )

    const title = String(
      (agreement.content as { title?: unknown } | null)?.title ||
        'Commercial agreement',
    )
    const details = {
      agreement_id: agreement.id,
      agreement_title: title,
      agreement_version: String(agreement.version),
    }
    const { data: inserted, error } = await supabase
      .from('ops_client_change_requests')
      .insert({
        customer_id: client.customer_id,
        requested_by_user_id: user.id,
        requested_by_name: client.display_name,
        appointment_id: null,
        request_type: 'scope_change',
        details,
        message: body.message,
        status: 'pending',
      })
      .select()
      .single()
    if (error) throw error

    const { data: customer } = await supabase
      .from('ops_customers')
      .select('business_name,full_name')
      .eq('id', client.customer_id)
      .single()
    const notificationText = `AGREEMENT NOTE — ${client.display_name}

${customer?.business_name || customer?.full_name || 'Commercial client'}
${title} · version ${agreement.version}
${body.message}`
    const notification = `${notificationText.slice(0, 3400)}

Note ID: ${inserted.id}
Review: https://sightings.sasquatchcarpet.com/admin/operations/commercial#client-request-${inserted.id}`
    let telegramSent = false
    for (let attempt = 1; attempt <= 2 && !telegramSent; attempt++) {
      telegramSent = await sendTelegramNotification(notification).catch(
        () => false,
      )
    }
    if (!telegramSent) {
      console.error(
        '[client/requests] Agreement-note Telegram delivery failed after 2 attempts',
        { requestId: inserted.id, customerId: client.customer_id },
      )
    }

    return NextResponse.json(
      { request: inserted, telegram_sent: telegramSent },
      { status: 201 },
    )
  } catch (error) {
    const status =
      error instanceof z.ZodError
        ? 400
        : error instanceof Error && error.message === 'Not a client manager'
          ? 403
          : 500
    return NextResponse.json(
      {
        error:
          status === 400
            ? 'Enter a note about this agreement.'
            : 'Failed to send agreement note',
      },
      { status },
    )
  }
}
