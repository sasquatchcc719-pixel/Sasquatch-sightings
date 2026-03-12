import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole, getUserWithRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  clearHarryControlCache,
  getHarryControlSnapshot,
  isKnownHarryControlKey,
  seedHarryControlDefaults,
} from '@/lib/harry/control'
import {
  isAnalystFeatureEnabled,
  isAnalystHistoryReadonlyEnabled,
} from '@/lib/harry/features'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    await seedHarryControlDefaults()
    const snapshot = await getHarryControlSnapshot({ bypassCache: true })

    return NextResponse.json({
      settings: snapshot.rows,
      source: snapshot.source,
      runtime: {
        ai_dispatcher_enabled: process.env.AI_DISPATCHER_ENABLED === 'true',
        analyst_enabled: isAnalystFeatureEnabled(),
        analyst_history_readonly: isAnalystHistoryReadonlyEnabled(),
      },
    })
  } catch (error) {
    console.error('[admin/harry/control][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load Harry control settings' },
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

    const key = String(body.setting_key || '').trim()
    const isEnabled = Boolean(body.is_enabled)
    if (!key || !isKnownHarryControlKey(key)) {
      return NextResponse.json(
        { error: 'Valid setting_key is required' },
        { status: 400 },
      )
    }

    const snapshot = await getHarryControlSnapshot({ bypassCache: true })
    const existing = snapshot.rows.find((row) => row.setting_key === key)
    if (!existing) {
      return NextResponse.json({ error: 'Setting not found' }, { status: 404 })
    }

    const { error } = await supabase.from('harry_control_settings').upsert(
      {
        setting_key: key,
        group_key: existing.group_key,
        label: existing.label,
        description: existing.description,
        is_enabled: isEnabled,
        updated_at: new Date().toISOString(),
        updated_by: user?.id || null,
      },
      { onConflict: 'setting_key' },
    )
    if (error) throw error

    clearHarryControlCache()
    const nextSnapshot = await getHarryControlSnapshot({ bypassCache: true })
    return NextResponse.json({
      success: true,
      settings: nextSnapshot.rows,
    })
  } catch (error) {
    console.error('[admin/harry/control][PUT] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update Harry control setting' },
      { status: 500 },
    )
  }
}
