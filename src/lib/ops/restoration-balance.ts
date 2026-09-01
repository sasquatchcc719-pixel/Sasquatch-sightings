import { SupabaseClient } from '@supabase/supabase-js'

/**
 * The single source of truth for what a restoration project still owes.
 *
 * Mirrors the totals block in the project detail route exactly — any payment
 * feature that needs "the balance" must call this rather than re-deriving it,
 * so the Money card and the amount actually charged can never drift apart.
 */
export async function getRestorationBalanceCents(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{
  balanceCents: number
  netCents: number
  paidCents: number
} | null> {
  const { data: project } = await supabase
    .from('restoration_projects')
    .select('id, deductible_credit')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return null

  const { data: visits } = await supabase
    .from('ops_appointments')
    .select('id, ops_appointment_line_items ( line_total )')
    .eq('restoration_project_id', projectId)

  const visitIds = (visits ?? []).map((v) => v.id)

  const [{ data: billing }, { data: payments }] = await Promise.all([
    supabase
      .from('restoration_equipment_billing')
      .select('line_total')
      .eq('project_id', projectId),
    visitIds.length
      ? supabase
          .from('ops_payments')
          .select('amount_cents')
          .in('appointment_id', visitIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ])

  const lineTotal = (visits ?? []).reduce((sum, visit) => {
    const lines = (visit.ops_appointment_line_items ?? []) as Array<{
      line_total: number
    }>
    return sum + lines.reduce((s, l) => s + Number(l.line_total), 0)
  }, 0)
  const equipmentTotal = (billing ?? []).reduce(
    (sum, b) => sum + Number((b as { line_total: number }).line_total),
    0,
  )
  const paidCents = (
    (payments ?? []) as Array<{ amount_cents: number }>
  ).reduce((sum, p) => sum + Number(p.amount_cents), 0)

  const gross = Math.round((lineTotal + equipmentTotal) * 100) / 100
  const credit = Math.max(
    0,
    Math.min(gross, Number(project.deductible_credit ?? 0) || 0),
  )
  const net = Math.round((gross - credit) * 100) / 100
  const netCents = Math.round(net * 100)

  return { balanceCents: netCents - paidCents, netCents, paidCents }
}

/** The most recent visit on a project — where a final payment gets anchored. */
export async function getMostRecentVisitId(
  supabase: SupabaseClient,
  projectId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('ops_appointments')
    .select('id')
    .eq('restoration_project_id', projectId)
    .order('appointment_date', { ascending: false })
    .order('start_time', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}
