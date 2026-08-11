/**
 * Read and edit scan frequencies. The daily scan-scheduler cron obeys this
 * table, so a frequency change here takes effect at the next daily tick —
 * no deploy involved.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'marketing'])
    const { data, error } = await createAdminClient()
      .from('scan_schedules')
      .select('*')
      .order('tool')
    if (error) throw error
    return NextResponse.json({ ok: true, schedules: data ?? [] })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load schedules'
    const status = /unauthor|forbidden|role/i.test(message) ? 403 : 500
    console.error('[scan-schedules GET]', err)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const body = (await request.json()) as {
      id?: string
      enabled?: boolean
      frequency_days?: number
    }
    if (!body.id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }
    if (typeof body.enabled === 'boolean') updates.enabled = body.enabled
    if (body.frequency_days !== undefined) {
      const days = Math.floor(Number(body.frequency_days))
      // 1..90: daily at the most aggressive, quarterly at the laziest. Zero or
      // negative would make the scheduler fire on every tick.
      if (!Number.isFinite(days) || days < 1 || days > 90) {
        return NextResponse.json(
          { error: 'frequency_days must be between 1 and 90' },
          { status: 400 },
        )
      }
      updates.frequency_days = days
    }

    const { error } = await createAdminClient()
      .from('scan_schedules')
      .update(updates)
      .eq('id', body.id)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update schedule'
    const status = /unauthor|forbidden|role/i.test(message) ? 403 : 500
    console.error('[scan-schedules PUT]', err)
    return NextResponse.json({ error: message }, { status })
  }
}
