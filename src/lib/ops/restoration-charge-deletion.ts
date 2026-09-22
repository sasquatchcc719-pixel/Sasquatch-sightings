import type { SupabaseClient } from '@supabase/supabase-js'
import { unitDays } from '@/lib/ops/restoration-equipment-ledger'

export type RestorationChargeDeletionResult =
  | { ok: true; removedAmount: number }
  | {
      ok: false
      error:
        | 'charge_not_found'
        | 'project_not_found'
        | 'project_financially_locked'
        | 'delete_failed'
    }

async function projectChargesAreLocked(
  supabase: SupabaseClient,
  projectId: string,
): Promise<
  'project_not_found' | 'project_financially_locked' | 'delete_failed' | null
> {
  const { data: project, error: projectError } = await supabase
    .from('restoration_projects')
    .select('id, status, invoice_id')
    .eq('id', projectId)
    .maybeSingle()

  if (projectError) return 'delete_failed'
  if (!project) return 'project_not_found'
  if (project.status === 'closed' || project.invoice_id) {
    return 'project_financially_locked'
  }

  // The close flow creates its invoice before attaching it to the project.
  // Refuse during that window too: deleting a source charge must never detach
  // or rewrite an invoice line that has already been created.
  const { data: visits, error: visitsError } = await supabase
    .from('ops_appointments')
    .select('id')
    .eq('restoration_project_id', projectId)
  if (visitsError) return 'delete_failed'
  const visitIds = (visits ?? []).map((visit) => visit.id)
  if (visitIds.length === 0) return null

  const { data: invoice, error: invoiceError } = await supabase
    .from('ops_invoices')
    .select('id')
    .in('appointment_id', visitIds)
    .limit(1)
    .maybeSingle()

  if (invoiceError) return 'delete_failed'
  return invoice ? 'project_financially_locked' : null
}

export async function deleteRestorationWorkLine(
  supabase: SupabaseClient,
  params: { projectId: string; lineId: string },
): Promise<RestorationChargeDeletionResult> {
  const { data: line, error: lineError } = await supabase
    .from('ops_appointment_line_items')
    .select('id, appointment_id, line_total')
    .eq('id', params.lineId)
    .maybeSingle()

  if (lineError) return { ok: false, error: 'delete_failed' }
  if (!line) return { ok: false, error: 'charge_not_found' }

  const { data: visit, error: visitError } = await supabase
    .from('ops_appointments')
    .select('restoration_project_id')
    .eq('id', line.appointment_id)
    .maybeSingle()

  // The caller must name the project that owns the charge. A mismatched ID is
  // indistinguishable from a missing charge so this route cannot delete a line
  // from another project by guessing its UUID.
  if (visitError) return { ok: false, error: 'delete_failed' }
  if (visit?.restoration_project_id !== params.projectId) {
    return { ok: false, error: 'charge_not_found' }
  }

  const locked = await projectChargesAreLocked(supabase, params.projectId)
  if (locked) return { ok: false, error: locked }

  const { data: deleted, error } = await supabase
    .from('ops_appointment_line_items')
    .delete()
    .eq('id', params.lineId)
    .eq('appointment_id', line.appointment_id)
    .select('id')
    .maybeSingle()

  if (error || !deleted) return { ok: false, error: 'delete_failed' }
  return { ok: true, removedAmount: Number(line.line_total) }
}

export async function deleteRestorationEquipmentPlacement(
  supabase: SupabaseClient,
  params: { projectId: string; placementId: string },
): Promise<RestorationChargeDeletionResult> {
  const { data: placement, error: placementError } = await supabase
    .from('restoration_equipment_placements')
    .select('id, project_id, catalog_code, placed_on, removed_on')
    .eq('id', params.placementId)
    .eq('project_id', params.projectId)
    .maybeSingle()

  if (placementError) return { ok: false, error: 'delete_failed' }
  if (!placement) return { ok: false, error: 'charge_not_found' }

  const locked = await projectChargesAreLocked(supabase, params.projectId)
  if (locked) return { ok: false, error: locked }

  const { data: catalogItem } = await supabase
    .from('restoration_catalog_items')
    .select('unit_price')
    .eq('code', placement.catalog_code)
    .maybeSingle()
  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Denver',
  })
  const removedAmount =
    unitDays(placement.placed_on, placement.removed_on, today) *
    Number(catalogItem?.unit_price ?? 0)

  const { data: deleted, error } = await supabase
    .from('restoration_equipment_placements')
    .delete()
    .eq('id', params.placementId)
    .eq('project_id', params.projectId)
    .select('id')
    .maybeSingle()

  if (error || !deleted) return { ok: false, error: 'delete_failed' }
  return { ok: true, removedAmount }
}
