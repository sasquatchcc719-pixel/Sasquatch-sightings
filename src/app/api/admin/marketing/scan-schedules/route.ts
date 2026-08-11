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
      /** Shallow-merged into scan_schedules.config (keyword, spacing, grid_size…). */
      config?: Record<string, unknown>
    }
    if (!body.id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const supabase = createAdminClient()
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

    if (body.config && typeof body.config === 'object' && !Array.isArray(body.config)) {
      const { data: existing, error: readError } = await supabase
        .from('scan_schedules')
        .select('config')
        .eq('id', body.id)
        .single()
      if (readError) throw readError
      const prev =
        existing?.config && typeof existing.config === 'object' && !Array.isArray(existing.config)
          ? (existing.config as Record<string, unknown>)
          : {}
      const next: Record<string, unknown> = { ...prev }

      if (typeof body.config.keyword === 'string') {
        const kw = body.config.keyword.trim().slice(0, 120)
        if (kw) next.keyword = kw
      }
      if (body.config.spacing_miles !== undefined) {
        const mi = Number(body.config.spacing_miles)
        if (!Number.isFinite(mi) || mi < 1 || mi > 10) {
          return NextResponse.json(
            { error: 'spacing_miles must be between 1 and 10' },
            { status: 400 },
          )
        }
        next.spacing_miles = mi
      }
      if (typeof body.config.preset === 'string') {
        next.preset =
          body.config.preset === 'tri-lakes' ? 'tri-lakes' : 'service-area'
      }
      if (body.config.grid_size !== undefined) {
        const size = Math.floor(Number(body.config.grid_size))
        const allowed = [3, 5, 7, 9, 11, 13, 15, 17, 19, 21]
        if (!allowed.includes(size)) {
          return NextResponse.json(
            { error: `grid_size must be one of ${allowed.join(', ')}` },
            { status: 400 },
          )
        }
        next.grid_size = size
      }
      if (body.config.radius !== undefined) {
        const radius = Number(body.config.radius)
        if (!Number.isFinite(radius) || radius < 0.5 || radius > 50) {
          return NextResponse.json(
            { error: 'radius must be between 0.5 and 50' },
            { status: 400 },
          )
        }
        next.radius = radius
      }
      if (typeof body.config.measurement === 'string') {
        next.measurement = body.config.measurement === 'km' ? 'km' : 'mi'
      }

      updates.config = next
    }

    const { error } = await supabase
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
