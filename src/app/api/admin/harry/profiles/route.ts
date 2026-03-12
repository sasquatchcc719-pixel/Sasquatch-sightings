import { NextRequest, NextResponse } from 'next/server'
import { getUserWithRole, requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

type ProfileInput = {
  profile_key: string
  label: string
  channel_key: string
  booking_mode: string
  prompt_overrides: string
  is_enabled: boolean
}

function normalizeProfileInput(value: unknown): ProfileInput {
  const raw = (value || {}) as Record<string, unknown>
  return {
    profile_key: String(raw.profile_key || '').trim(),
    label: String(raw.label || '').trim(),
    channel_key: String(raw.channel_key || '').trim(),
    booking_mode: String(raw.booking_mode || 'bounded_auto_booking').trim(),
    prompt_overrides: String(raw.prompt_overrides || ''),
    is_enabled: Boolean(raw.is_enabled),
  }
}

function isMissingRelationError(message: string | undefined): boolean {
  const normalized = String(message || '').toLowerCase()
  return (
    normalized.includes('does not exist') ||
    normalized.includes('relation') ||
    normalized.includes('schema cache')
  )
}

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('harry_logic_profiles')
      .select('*')
      .order('label')

    if (error) {
      if (isMissingRelationError(error.message)) {
        return NextResponse.json({ profiles: [] })
      }
      throw error
    }
    return NextResponse.json({ profiles: data || [] })
  } catch (error) {
    console.error('[admin/harry/profiles][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load Harry logic profiles' },
      { status: 500 },
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const { user } = await getUserWithRole()
    const supabase = createAdminClient()
    const body = await request.json()
    const input = normalizeProfileInput(body)

    if (!input.profile_key || !input.label || !input.channel_key) {
      return NextResponse.json(
        { error: 'profile_key, label, and channel_key are required' },
        { status: 400 },
      )
    }

    const { error } = await supabase.from('harry_logic_profiles').upsert(
      {
        ...input,
        updated_at: new Date().toISOString(),
        updated_by: user?.id || null,
      },
      { onConflict: 'profile_key' },
    )

    if (error) throw error

    const { data: profiles } = await supabase
      .from('harry_logic_profiles')
      .select('*')
      .order('label')

    return NextResponse.json({ success: true, profiles: profiles || [] })
  } catch (error) {
    console.error('[admin/harry/profiles][PUT] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update Harry logic profile' },
      { status: 500 },
    )
  }
}
