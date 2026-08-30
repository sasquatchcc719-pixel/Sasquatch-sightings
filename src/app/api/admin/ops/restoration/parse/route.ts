import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { parseRestorationLines } from '@/lib/ops/restoration-line-entry'
import type { WaterCategory } from '@/lib/ops/restoration-catalog'

/** Spoken or typed shorthand -> proposed line items. Nothing is saved here. */
export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const supabase = createAdminClient()
    const body = await request.json()

    const projectId = body.project_id ? String(body.project_id) : null
    let category = (Number(body.water_category ?? 1) || 1) as WaterCategory
    let afterHours = Boolean(body.after_hours)

    // Prefer the project's own loss context over anything the caller supplies.
    if (projectId) {
      const { data: project } = await supabase
        .from('restoration_projects')
        .select('water_category, after_hours_call')
        .eq('id', projectId)
        .maybeSingle()
      if (project) {
        category = ((project.water_category ?? 1) || 1) as WaterCategory
        afterHours = Boolean(project.after_hours_call)
      }
    }

    const result = await parseRestorationLines(supabase, {
      transcript: String(body.transcript ?? ''),
      context: { waterCategory: category, afterHours },
    })

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })
    return NextResponse.json({
      ...result,
      water_category: category,
      after_hours: afterHours,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to parse'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
