import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  scanTomorrowFill,
  sendTomorrowFillWave,
  skipTomorrowFillCampaign,
} from '@/lib/ops/tomorrow-fill'

const ACCESS = ['admin', 'owner', 'dispatcher', 'marketing'] as const
const WRITE_ACCESS = ['admin', 'owner', 'dispatcher'] as const

function actorLabel(access: Awaited<ReturnType<typeof requireAnyRole>>) {
  return access.staff?.display_name || access.email || access.id
}

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole([...ACCESS])
    const supabase = createAdminClient()
    const selectedId = request.nextUrl.searchParams.get('campaign')

    const [
      { data: settings, error: settingsError },
      { data: campaigns, error: campaignError },
    ] = await Promise.all([
      supabase
        .from('tomorrow_fill_settings')
        .select('*')
        .eq('id', true)
        .single(),
      supabase
        .from('tomorrow_fill_campaigns')
        .select('*')
        .order('target_date', { ascending: false })
        .limit(30),
    ])
    if (settingsError) throw settingsError
    if (campaignError) throw campaignError

    const selectedCampaignId =
      selectedId && campaigns?.some((campaign) => campaign.id === selectedId)
        ? selectedId
        : campaigns?.[0]?.id || null

    let recipients: unknown[] = []
    let events: unknown[] = []
    if (selectedCampaignId) {
      const [recipientResult, eventResult] = await Promise.all([
        supabase
          .from('tomorrow_fill_recipients')
          .select(
            `
            id, customer_id, phone_normalized, zip_code, last_clean_date,
            lifetime_value, rank, status, exclusion_reason, sent_at, clicked_at,
            replied_at, booked_at, booking_total, appointment_id,
            ops_customers ( full_name, first_name, last_name )
          `,
          )
          .eq('campaign_id', selectedCampaignId)
          .order('rank', { ascending: true }),
        supabase
          .from('tomorrow_fill_events')
          .select('id, event_type, actor, detail, created_at, recipient_id')
          .eq('campaign_id', selectedCampaignId)
          .order('created_at', { ascending: false })
          .limit(100),
      ])
      if (recipientResult.error) throw recipientResult.error
      if (eventResult.error) throw eventResult.error
      recipients = recipientResult.data || []
      events = eventResult.data || []
    }

    return NextResponse.json({
      settings,
      campaigns: campaigns || [],
      selectedCampaignId,
      recipients,
      events,
    })
  } catch (error) {
    console.error('[tomorrow-fill][GET]', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to load Tomorrow Fill.',
      },
      { status: 500 },
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const access = await requireAnyRole([...WRITE_ACCESS])
    const body = await request.json()
    const allowed = [
      'engine_enabled',
      'send_enabled',
      'dormancy_months',
      'customer_cooldown_days',
      'unanswered_limit',
      'rest_days',
      'minimum_audience_size',
      'default_wave_size',
      'max_discounted_bookings',
      'offer_amount',
      'minimum_subtotal',
      'offer_valid_days',
      'message_template',
    ] as const
    const updates: Record<string, boolean | number | string> = {}
    for (const key of allowed) {
      if (body[key] === undefined) continue
      if (key === 'engine_enabled' || key === 'send_enabled') {
        updates[key] = Boolean(body[key])
      } else if (key === 'message_template') {
        const value = String(body[key] || '').trim()
        if (!value.includes('{{booking_url}}')) {
          return NextResponse.json(
            { error: 'The message must include {{booking_url}}.' },
            { status: 400 },
          )
        }
        updates[key] = value
      } else {
        const value = Number(body[key])
        if (!Number.isFinite(value) || value < 1) {
          return NextResponse.json(
            { error: `${key} must be at least 1.` },
            { status: 400 },
          )
        }
        updates[key] = value
      }
    }
    updates.updated_at = new Date().toISOString()
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('tomorrow_fill_settings')
      .update(updates)
      .eq('id', true)
      .select('*')
      .single()
    if (error) throw error
    await supabase.from('tomorrow_fill_events').insert({
      event_type: 'settings_updated',
      actor: actorLabel(access),
      detail: updates,
    })
    return NextResponse.json({ settings: data })
  } catch (error) {
    console.error('[tomorrow-fill][PATCH]', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unable to save settings.',
      },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireAnyRole([...WRITE_ACCESS])
    const actor = actorLabel(access)
    const body = await request.json()
    const action = String(body.action || '')
    if (action === 'scan') {
      const result = await scanTomorrowFill({ notifyTelegram: false, actor })
      return NextResponse.json({ result })
    }
    const campaignId = String(body.campaign_id || '')
    if (!/^[0-9a-f-]{36}$/i.test(campaignId)) {
      return NextResponse.json(
        { error: 'A campaign is required.' },
        { status: 400 },
      )
    }
    if (action === 'skip') {
      await skipTomorrowFillCampaign({ campaignId, actor })
      return NextResponse.json({ success: true })
    }
    if (action === 'send') {
      const amount = Number(body.amount)
      if (![5, 10, 15].includes(amount)) {
        return NextResponse.json(
          { error: 'Choose a staged wave of 5, 10, or 15.' },
          { status: 400 },
        )
      }
      const result = await sendTomorrowFillWave({ campaignId, amount, actor })
      return NextResponse.json({ result })
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (error) {
    console.error('[tomorrow-fill][POST]', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unable to complete action.',
      },
      { status: 500 },
    )
  }
}
