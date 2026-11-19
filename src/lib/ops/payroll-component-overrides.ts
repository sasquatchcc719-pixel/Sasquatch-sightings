import type { createAdminClient } from '@/supabase/server'

export type PayrollComponent = 'gratuity' | 'add_on_bonus'

export async function loadPayrollComponentOverrides(
  db: ReturnType<typeof createAdminClient>,
  component: PayrollComponent,
  sourceKeys: string[],
): Promise<Map<string, number>> {
  const overrides = new Map<string, number>()
  const uniqueKeys = [...new Set(sourceKeys)]

  for (let offset = 0; offset < uniqueKeys.length; offset += 100) {
    const { data, error } = await db
      .from('ops_payroll_component_overrides')
      .select('source_key, override_amount')
      .eq('component', component)
      .in('source_key', uniqueKeys.slice(offset, offset + 100))
    if (error) throw error
    for (const row of data || []) {
      overrides.set(row.source_key, Number(row.override_amount))
    }
  }

  return overrides
}
