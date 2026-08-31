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

    // Guidance warnings are internal prompts, not rules — acknowledging one
    // hides it for this project and never reaches a customer document.
    if (body.acknowledge_warning) {
      const { data: current } = await supabase
        .from('restoration_projects')
        .select('acknowledged_warnings')
        .eq('id', id)
        .maybeSingle()
      const existing = (current?.acknowledged_warnings ?? []) as string[]
      const key = String(body.acknowledge_warning)
      patch.acknowledged_warnings = existing.includes(key) ? existing : [...existing, key]
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
      'deductible_credit',
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

/**
 * Delete a water loss and everything under it.
 *
 * Every child table cascades from `restoration_projects`, including
 * `ops_appointments`, so the mitigation day and every monitor visit go with it —
 * scheduled or still in the tray.
 *
 * Refuses once an invoice exists: at that point the job has been billed and
 * deleting it would take the billing record with it. Cancel or void the invoice
 * first if that is really the intent.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { id } = await params
    const supabase = createAdminClient()

    const { data: project } = await supabase
      .from('restoration_projects')
      .select('id, status, invoice_id')
      .eq('id', id)
      .maybeSingle()

    if (!project) return NextResponse.json({ error: 'project_not_found' }, { status: 404 })
    if (project.invoice_id) {
      return NextResponse.json(
        {
          error:
            'This loss has been invoiced. Void or delete the invoice first if you really want to remove it.',
        },
        { status: 409 },
      )
    }

    const { data: visits } = await supabase
      .from('ops_appointments')
      .select('id')
      .eq('restoration_project_id', id)

    // Payments taken before an invoice exists (the day-1 deposit) hang off the
    // visit, and ops_payments does not cascade from the appointment.
    const visitIds = (visits ?? []).map((v) => v.id)
    if (visitIds.length > 0) {
      await supabase.from('ops_payments').delete().in('appointment_id', visitIds)
    }

    const { error } = await supabase.from('restoration_projects').delete().eq('id', id)
    if (error) throw error

    return NextResponse.json({ ok: true, deleted_visits: visitIds.length })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to delete the loss'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
