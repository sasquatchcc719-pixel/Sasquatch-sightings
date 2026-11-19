import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import type { PayrollComponent } from '@/lib/ops/payroll-component-overrides'
import { createAdminClient } from '@/supabase/server'

const COMPONENTS = new Set<PayrollComponent>(['gratuity', 'add_on_bonus'])

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function PATCH(request: NextRequest) {
  try {
    const access = await requireAnyRole(['admin', 'owner'])
    const body = await request.json().catch(() => ({}))
    const component = String(body.component || '') as PayrollComponent
    const sourceKey = String(body.sourceKey || '').trim()
    const rawOverrideAmount = String(body.overrideAmount ?? '')
    const overrideAmount = Number(body.overrideAmount)

    if (!COMPONENTS.has(component)) {
      return jsonError('A valid payroll component is required', 400)
    }
    if (!sourceKey || sourceKey.length > 250) {
      return jsonError('A valid sourceKey is required', 400)
    }
    if (
      !Number.isFinite(overrideAmount) ||
      overrideAmount < 0 ||
      overrideAmount > 1_000_000 ||
      !/^\d+(?:\.\d{1,2})?$/.test(rawOverrideAmount)
    ) {
      return jsonError(
        'overrideAmount must be 0 to 1,000,000 with at most two decimals',
        400,
      )
    }

    const { data, error } = await createAdminClient()
      .from('ops_payroll_component_overrides')
      .upsert(
        {
          component,
          source_key: sourceKey,
          override_amount: overrideAmount,
          created_by: access.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'component,source_key' },
      )
      .select()
      .single()
    if (error) throw error

    return NextResponse.json({ override: data })
  } catch (error) {
    console.error('[payroll/component-overrides][PATCH]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return jsonError('Failed to save payroll override', status)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { searchParams } = new URL(request.url)
    const component = String(
      searchParams.get('component') || '',
    ) as PayrollComponent
    const sourceKey = String(searchParams.get('sourceKey') || '').trim()
    if (!COMPONENTS.has(component) || !sourceKey) {
      return jsonError('A valid component and sourceKey are required', 400)
    }

    const { error } = await createAdminClient()
      .from('ops_payroll_component_overrides')
      .delete()
      .eq('component', component)
      .eq('source_key', sourceKey)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[payroll/component-overrides][DELETE]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return jsonError('Failed to reset payroll override', status)
  }
}
