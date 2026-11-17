import { NextRequest, NextResponse } from 'next/server'
import { getUserWithRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  readStationHealthSmsSetting,
  STATION_HEALTH_SMS_SETTING_KEY,
} from '@/lib/station-health-settings'

async function requireOwnerOrAdmin() {
  const { user, role } = await getUserWithRole()
  return !!user && (role === 'owner' || role === 'admin')
}

export async function GET() {
  try {
    if (!(await requireOwnerOrAdmin())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const setting = await readStationHealthSmsSetting(createAdminClient())
    return NextResponse.json(setting)
  } catch (error) {
    console.error('[station-health-settings] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to load station-health SMS setting' },
      { status: 500 },
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    if (!(await requireOwnerOrAdmin())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as { enabled?: unknown }
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled must be a boolean' },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    const { error } = await supabase.from('system_settings').upsert(
      {
        key: STATION_HEALTH_SMS_SETTING_KEY,
        value: { enabled: body.enabled },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    )

    if (error) throw error

    return NextResponse.json({ enabled: body.enabled, source: 'saved' })
  } catch (error) {
    console.error('[station-health-settings] PUT error:', error)
    return NextResponse.json(
      { error: 'Failed to save station-health SMS setting' },
      { status: 500 },
    )
  }
}
