import { NextRequest, NextResponse } from 'next/server'
import { getUserWithRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { generateApiKey } from '@/lib/agent-auth'

export async function GET() {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || !['admin', 'owner'].includes(role || '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient()

    const [settingsResult, keysResult] = await Promise.all([
      supabase
        .from('settings')
        .select(
          'ai_agent_api_enabled, ai_agent_promo_enabled, ai_agent_promo_discount, ai_agent_promo_minimum',
        )
        .limit(1)
        .maybeSingle(),
      supabase
        .from('agent_api_keys')
        .select('id, label, booking_mode, is_active, created_at')
        .order('created_at', { ascending: false }),
    ])

    return NextResponse.json({
      settings: {
        ai_agent_api_enabled:
          settingsResult.data?.ai_agent_api_enabled ?? false,
        ai_agent_promo_enabled:
          settingsResult.data?.ai_agent_promo_enabled ?? true,
        ai_agent_promo_discount: Number(
          settingsResult.data?.ai_agent_promo_discount ?? 20,
        ),
        ai_agent_promo_minimum: Number(
          settingsResult.data?.ai_agent_promo_minimum ?? 220,
        ),
      },
      keys: keysResult.data || [],
    })
  } catch (error) {
    console.error('[agent-settings] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to load agent settings' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || !['admin', 'owner'].includes(role || '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const supabase = createAdminClient()

    if (body.action === 'update_settings') {
      const updates: Record<string, unknown> = {}
      if (typeof body.ai_agent_api_enabled === 'boolean')
        updates.ai_agent_api_enabled = body.ai_agent_api_enabled
      if (typeof body.ai_agent_promo_enabled === 'boolean')
        updates.ai_agent_promo_enabled = body.ai_agent_promo_enabled
      if (body.ai_agent_promo_discount !== undefined)
        updates.ai_agent_promo_discount = Number(body.ai_agent_promo_discount)
      if (body.ai_agent_promo_minimum !== undefined)
        updates.ai_agent_promo_minimum = Number(body.ai_agent_promo_minimum)

      updates.updated_at = new Date().toISOString()

      const { data: existing } = await supabase
        .from('settings')
        .select('id')
        .limit(1)
        .maybeSingle()

      if (existing) {
        await supabase.from('settings').update(updates).eq('id', existing.id)
      } else {
        await supabase.from('settings').insert({ ...updates, user_id: user.id })
      }

      return NextResponse.json({ ok: true })
    }

    if (body.action === 'create_key') {
      const label = String(body.label || 'Unnamed').trim()
      const bookingMode = body.booking_mode === 'direct' ? 'direct' : 'request'

      const { raw, hash } = generateApiKey()

      await supabase.from('agent_api_keys').insert({
        key_hash: hash,
        label,
        booking_mode: bookingMode,
      })

      return NextResponse.json({
        ok: true,
        api_key: raw,
        message: 'Save this key now — it will not be shown again.',
      })
    }

    if (body.action === 'update_key') {
      const keyId = String(body.key_id || '')
      if (!keyId)
        return NextResponse.json(
          { error: 'key_id is required' },
          { status: 400 },
        )

      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      }
      if (body.booking_mode === 'direct' || body.booking_mode === 'request')
        updates.booking_mode = body.booking_mode
      if (typeof body.label === 'string' && body.label.trim())
        updates.label = body.label.trim()

      await supabase.from('agent_api_keys').update(updates).eq('id', keyId)

      return NextResponse.json({ ok: true })
    }

    if (body.action === 'revoke_key') {
      const keyId = String(body.key_id || '')
      if (!keyId)
        return NextResponse.json(
          { error: 'key_id is required' },
          { status: 400 },
        )

      await supabase
        .from('agent_api_keys')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', keyId)

      return NextResponse.json({ ok: true })
    }

    if (body.action === 'delete_key') {
      const keyId = String(body.key_id || '')
      if (!keyId)
        return NextResponse.json(
          { error: 'key_id is required' },
          { status: 400 },
        )

      await supabase.from('agent_api_keys').delete().eq('id', keyId)

      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('[agent-settings] POST error:', error)
    return NextResponse.json(
      { error: 'Failed to update agent settings' },
      { status: 500 },
    )
  }
}
