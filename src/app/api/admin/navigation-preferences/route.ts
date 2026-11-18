import { NextRequest, NextResponse } from 'next/server'
import { getUserWithRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { normalizeNavigationPreferences } from '@/lib/admin-navigation'
import { readNavigationPreferences } from '@/lib/admin-navigation-server'

function canEdit(role: string | null): boolean {
  return role === 'owner' || role === 'admin'
}

export async function GET() {
  const { user, role } = await getUserWithRole()
  if (!user || !canEdit(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    preferences: await readNavigationPreferences(user.id),
  })
}

export async function PUT(request: NextRequest) {
  const { user, role } = await getUserWithRole()
  if (!user || !canEdit(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const preferences = normalizeNavigationPreferences(body.preferences)
    const { error } = await createAdminClient()
      .from('admin_navigation_preferences')
      .upsert(
        {
          user_id: user.id,
          preferences,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )

    if (error) throw error
    return NextResponse.json({ ok: true, preferences })
  } catch (error) {
    console.error('[navigation-preferences] Save failed:', error)
    return NextResponse.json(
      { error: 'Could not save navigation layout' },
      { status: 500 },
    )
  }
}

export async function DELETE() {
  const { user, role } = await getUserWithRole()
  if (!user || !canEdit(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { error } = await createAdminClient()
    .from('admin_navigation_preferences')
    .delete()
    .eq('user_id', user.id)

  if (error) {
    console.error('[navigation-preferences] Reset failed:', error.message)
    return NextResponse.json(
      { error: 'Could not restore navigation defaults' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
