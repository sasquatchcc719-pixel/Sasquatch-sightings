import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * Update the loss context. Category and class both change what the job costs —
 * category picks the Xactimate variant, class picks the S500 dehumidification
 * factor — so both stay editable as the assessment firms up on site.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if ('loss_class' in body) {
      const lossClass = Number(body.loss_class)
      if (![1, 2, 3, 4].includes(lossClass)) {
        return NextResponse.json({ error: 'class must be 1-4' }, { status: 400 })
      }
      patch.loss_class = lossClass
    }

    if ('water_category' in body) {
      const category = Number(body.water_category)
      if (![1, 2, 3].includes(category)) {
        return NextResponse.json({ error: 'category must be 1-3' }, { status: 400 })
      }
      patch.water_category = category
    }

    for (const field of [
      'source_of_loss',
      'cause_narrative',
      'after_hours_call',
      'standing_water',
      'containment_required',
      'carrier',
      'claim_number',
      'adjuster_name',
      'deductible',
      'dry_standard_notes',
    ]) {
      if (field in body) patch[field] = body[field]
    }

    const { data, error } = await supabase
      .from('restoration_projects')
      .update(patch)
      .eq('id', id)
      .select('id, water_category, loss_class')
      .maybeSingle()

    if (error) throw error
    if (!data) return NextResponse.json({ error: 'project_not_found' }, { status: 404 })

    // Category is a dated fact — a change is a new entry, not an overwrite, so
    // work already performed keeps the rate it was performed at.
    if ('water_category' in body) {
      await supabase.from('restoration_category_events').insert({
        project_id: id,
        water_category: Number(body.water_category),
        effective_at: new Date().toISOString(),
        reason: body.category_reason ?? 'reassessed on site',
        recorded_by_user_id: access.id,
      })
    }

    return NextResponse.json({ project: data })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to update project'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
