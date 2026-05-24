import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getUserWithRole } from '@/lib/auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// GET - Fetch current phone settings
export async function GET() {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || (role !== 'admin' && role !== 'owner')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('phone_settings')
      .select('*')
      .limit(1)
      .single()

    if (error) {
      console.error('[Phone Settings] Error fetching:', error)
      return NextResponse.json(
        { error: 'Failed to fetch settings' },
        { status: 500 },
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('[Phone Settings] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}

// PUT - Update phone settings
export async function PUT(request: NextRequest) {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || (role !== 'admin' && role !== 'owner')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    const {
      voicemail_message,
      voicemail_voice,
      business_hours_start,
      business_hours_end,
      business_days,
      sip_endpoints,
      sip_domain,
      dial_timeout,
      temporary_open_line_mode,
      twilio_primary_forward_number,
      twilio_failover_forward_number,
      ivr_schedule_timeout_seconds,
      ivr_technical_timeout_seconds,
    } = body

    // Validate business hours
    if (
      business_hours_start !== undefined &&
      (business_hours_start < 0 || business_hours_start > 23)
    ) {
      return NextResponse.json(
        { error: 'Invalid business hours start' },
        { status: 400 },
      )
    }
    if (
      business_hours_end !== undefined &&
      (business_hours_end < 0 || business_hours_end > 23)
    ) {
      return NextResponse.json(
        { error: 'Invalid business hours end' },
        { status: 400 },
      )
    }
    if (
      ivr_schedule_timeout_seconds !== undefined &&
      (Number(ivr_schedule_timeout_seconds) < 10 ||
        Number(ivr_schedule_timeout_seconds) > 180)
    ) {
      return NextResponse.json(
        { error: 'Invalid schedule timeout' },
        { status: 400 },
      )
    }
    if (
      ivr_technical_timeout_seconds !== undefined &&
      (Number(ivr_technical_timeout_seconds) < 10 ||
        Number(ivr_technical_timeout_seconds) > 180)
    ) {
      return NextResponse.json(
        { error: 'Invalid technical timeout' },
        { status: 400 },
      )
    }

    // Build update object with only provided fields
    const updates: Record<string, unknown> = {}
    if (voicemail_message !== undefined)
      updates.voicemail_message = voicemail_message
    if (voicemail_voice !== undefined) updates.voicemail_voice = voicemail_voice
    if (business_hours_start !== undefined)
      updates.business_hours_start = business_hours_start
    if (business_hours_end !== undefined)
      updates.business_hours_end = business_hours_end
    if (business_days !== undefined) updates.business_days = business_days
    if (sip_endpoints !== undefined) updates.sip_endpoints = sip_endpoints
    if (sip_domain !== undefined) updates.sip_domain = sip_domain
    if (dial_timeout !== undefined) updates.dial_timeout = dial_timeout
    if (temporary_open_line_mode !== undefined)
      updates.temporary_open_line_mode = Boolean(temporary_open_line_mode)
    if (twilio_primary_forward_number !== undefined)
      updates.twilio_primary_forward_number = twilio_primary_forward_number
    if (twilio_failover_forward_number !== undefined)
      updates.twilio_failover_forward_number = twilio_failover_forward_number
    if (ivr_schedule_timeout_seconds !== undefined)
      updates.ivr_schedule_timeout_seconds = Number(
        ivr_schedule_timeout_seconds,
      )
    if (ivr_technical_timeout_seconds !== undefined)
      updates.ivr_technical_timeout_seconds = Number(
        ivr_technical_timeout_seconds,
      )

    // Get the first (and only) settings row
    const { data: existing } = await supabase
      .from('phone_settings')
      .select('id')
      .limit(1)
      .single()

    if (!existing) {
      return NextResponse.json({ error: 'No settings found' }, { status: 404 })
    }

    const { data, error } = await supabase
      .from('phone_settings')
      .update(updates)
      .eq('id', existing.id)
      .select()
      .single()

    if (error) {
      console.error('[Phone Settings] Error updating:', error)
      return NextResponse.json(
        { error: 'Failed to update settings' },
        { status: 500 },
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('[Phone Settings] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
