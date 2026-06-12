import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { getSettings, updateSettings } from '@/lib/echo/settings'
import type { EchoSettings } from '@/lib/echo/types'

// requireAnyRole throws a plain Error on auth failure; map those to 401 so an
// unauthenticated request gets a clean Unauthorized instead of a 500 (which is
// what made the Social Posts page look "crashed" when opened while logged out).
function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : ''
  return (
    msg.includes('not authorized') ||
    msg.includes('not authenticated') ||
    msg.includes('not an admin')
  )
}

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const settings = await getSettings()
    return NextResponse.json({ ok: true, settings })
  } catch (err) {
    if (isAuthError(err)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[echo/settings GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to read settings' },
      { status: 500 },
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const body = (await request.json()) as Partial<
      Omit<EchoSettings, 'id' | 'updated_at'>
    >

    const allowedKeys: (keyof typeof body)[] = [
      'enabled',
      'auto_post',
      'google_enabled',
      'facebook_enabled',
      'weekly_cap',
      'skip_repeat_days',
    ]
    const patch: Record<string, unknown> = {}
    for (const key of allowedKeys) {
      if (body[key] !== undefined) patch[key] = body[key]
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 },
      )
    }

    if (
      patch.weekly_cap !== undefined &&
      (typeof patch.weekly_cap !== 'number' ||
        patch.weekly_cap < 0 ||
        patch.weekly_cap > 20)
    ) {
      return NextResponse.json(
        { error: 'weekly_cap must be 0..20' },
        { status: 400 },
      )
    }
    if (
      patch.skip_repeat_days !== undefined &&
      (typeof patch.skip_repeat_days !== 'number' ||
        patch.skip_repeat_days < 0 ||
        patch.skip_repeat_days > 30)
    ) {
      return NextResponse.json(
        { error: 'skip_repeat_days must be 0..30' },
        { status: 400 },
      )
    }

    const settings = await updateSettings(patch)
    return NextResponse.json({ ok: true, settings })
  } catch (err) {
    if (isAuthError(err)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[echo/settings PATCH]', err)
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to update settings',
      },
      { status: 500 },
    )
  }
}
