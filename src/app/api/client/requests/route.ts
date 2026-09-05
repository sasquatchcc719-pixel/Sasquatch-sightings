import { NextRequest, NextResponse } from 'next/server'
import { requireClientManager } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { sendTelegramNotification } from '@/lib/telegram'
import { serviceRequestDetailsSchema } from '@/lib/ops/commercial'
import { z } from 'zod'

const REQUESTABLE_TYPES = [
  'skip_visit',
  'reschedule',
  'add_visit',
  'scope_change',
  'other',
] as const
type RequestableType = (typeof REQUESTABLE_TYPES)[number]

const TYPE_LABELS: Record<RequestableType, string> = {
  skip_visit: 'Request to cancel a visit',
  reschedule: 'Reschedule a visit',
  add_visit: 'Add an extra visit',
  scope_change: 'Change cleaning scope',
  other: 'Other request',
}

/**
 * GET /api/client/requests — list this client's change requests.
 */
export async function GET() {
  try {
    const { client } = await requireClientManager()
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('ops_client_change_requests')
      .select('*')
      .eq('customer_id', client.customer_id)
      .order('created_at', { ascending: false })
      .limit(50)
    return NextResponse.json({ requests: data || [] })
  } catch {
    return NextResponse.json(
      { error: 'Failed to load requests' },
      { status: 403 },
    )
  }
}

/**
 * POST /api/client/requests
 * Submit a change request. These NEVER modify the schedule — they land in Charles's
 * review panel and Telegram, and he applies them with his conflict-aware tools.
 * Body: { request_type, message?, appointment_id?, details? }
 */
export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireClientManager()
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))

    const requestType = body.request_type as string
    if (!REQUESTABLE_TYPES.includes(requestType as RequestableType)) {
      return NextResponse.json(
        { error: 'Invalid request type' },
        { status: 400 },
      )
    }
    const message =
      typeof body.message === 'string' ? body.message.slice(0, 2000) : null
    if (!message?.trim())
      return NextResponse.json(
        { error: 'Describe your request.' },
        { status: 400 },
      )

    // If an appointment is referenced, verify ownership before linking it.
    let appointmentId: string | null = null
    if (typeof body.appointment_id === 'string' && body.appointment_id) {
      const { data: appt } = await supabase
        .from('ops_appointments')
        .select('id, customer_id')
        .eq('id', body.appointment_id)
        .maybeSingle()
      if (!appt || appt.customer_id !== client.customer_id) {
        return NextResponse.json(
          { error: 'Referenced visit not found' },
          { status: 404 },
        )
      }
      appointmentId = appt.id
    }

    const parsedDetails = serviceRequestDetailsSchema.safeParse(
      body.details || {},
    )
    if (!parsedDetails.success)
      return NextResponse.json(
        { error: 'Check the requested service and date fields.' },
        { status: 400 },
      )
    const details: Record<string, string | undefined> = {
      ...parsedDetails.data,
    }
    // Link feedback only to an unsigned agreement owned by this customer.
    // Use server-held title/version, never client-supplied contract metadata.
    if (body.agreement_id !== undefined) {
      const agreementId = z.string().uuid().safeParse(body.agreement_id)
      if (
        !agreementId.success ||
        requestType !== 'scope_change' ||
        appointmentId
      ) {
        return NextResponse.json(
          { error: 'Invalid agreement change request.' },
          { status: 400 },
        )
      }
      const { data: agreement, error: agreementError } = await supabase
        .from('ops_commercial_agreements')
        .select('id, version, status, content')
        .eq('id', agreementId.data)
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
      details.agreement_id = agreement.id
      details.agreement_title = agreement.content.title
      details.agreement_version = String(agreement.version)
    }

    const { data: inserted, error } = await supabase
      .from('ops_client_change_requests')
      .insert({
        customer_id: client.customer_id,
        requested_by_user_id: user.id,
        requested_by_name: client.display_name,
        appointment_id: appointmentId,
        request_type: requestType,
        details,
        message,
        status: 'pending',
      })
      .select()
      .single()

    if (error) throw error

    const label = details.agreement_id
      ? 'Request changes to agreement'
      : TYPE_LABELS[requestType as RequestableType]
    const { data: customer } = await supabase
      .from('ops_customers')
      .select('business_name,full_name')
      .eq('id', client.customer_id)
      .single()
    await sendTelegramNotification(
      `CLIENT REQUEST — ${client.display_name}

${customer?.business_name || customer?.full_name || 'Commercial client'}
${label}${message ? `\n${message}` : ''}
${Object.entries(details)
  .filter(([k, v]) => k !== 'agreement_id' && v)
  .map(([k, v]) => `${k.replaceAll('_', ' ')}: ${v}`)
  .join('\n')}

Review: https://sightings.sasquatchcarpet.com/admin/operations/commercial`,
    ).catch((error) =>
      console.error('[client/requests] Telegram notification failed', error),
    )

    return NextResponse.json({ request: inserted }, { status: 201 })
  } catch (error) {
    const status =
      error instanceof Error && error.message === 'Not a client manager'
        ? 403
        : 500
    return NextResponse.json({ error: 'Failed to submit request' }, { status })
  }
}
