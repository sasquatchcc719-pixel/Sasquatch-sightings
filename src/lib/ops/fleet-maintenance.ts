import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Shared completion logic for a maintenance task — used by both the admin
 * Fleet page and David's own field maintenance view, so marking something
 * done always restarts its rule's interval clock the same way regardless of
 * who taps the button.
 */
export async function setMaintenanceTaskStatus(
  supabase: SupabaseClient,
  taskId: string,
  status: 'completed' | 'dismissed' | 'unassigned',
) {
  const { data: task, error } = await supabase
    .from('maintenance_tasks')
    .update({
      status,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
    })
    .eq('id', taskId)
    .select('*')
    .single()
  if (error) throw error

  if (status === 'completed' && task?.rule_id) {
    const { data: asset } = await supabase
      .from('fleet_assets')
      .select('current_meter')
      .eq('id', task.asset_id)
      .maybeSingle()
    await supabase
      .from('maintenance_rules')
      .update({
        last_done_meter: asset?.current_meter ?? null,
        last_done_at: new Date().toISOString(),
      })
      .eq('id', task.rule_id)
  }
  return task
}
