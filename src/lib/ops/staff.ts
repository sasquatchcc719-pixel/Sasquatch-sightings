import type { SupabaseClient } from '@supabase/supabase-js'

export type StaffUser = {
  id: string
  user_id: string
  display_name: string
  role: string
  is_active: boolean
  default_open: boolean
  scheduling_priority: number
}

export const STAFF_COLORS: Record<string, string> = {}

const COLOR_PALETTE = [
  '#2563eb', // blue
  '#16a34a', // green
  '#9333ea', // purple
  '#ea580c', // orange
  '#0891b2', // cyan
  '#dc2626', // red
]

export async function getActiveStaff(
  supabase: SupabaseClient,
): Promise<StaffUser[]> {
  const { data, error } = await supabase
    .from('staff_users')
    .select(
      'id, user_id, display_name, role, is_active, default_open, scheduling_priority',
    )
    .eq('is_active', true)
    .order('scheduling_priority', { ascending: true })

  if (error) throw error
  const staff = (data || []) as StaffUser[]

  staff.forEach((s, i) => {
    if (!STAFF_COLORS[s.id]) {
      STAFF_COLORS[s.id] = COLOR_PALETTE[i % COLOR_PALETTE.length]
    }
  })

  return staff
}

export async function isStaffOpenForDate(
  supabase: SupabaseClient,
  staffUserId: string,
  date: string,
  defaultOpen: boolean,
): Promise<boolean> {
  const { data } = await supabase
    .from('staff_daily_availability')
    .select('is_open')
    .eq('staff_user_id', staffUserId)
    .eq('date', date)
    .maybeSingle()

  return data ? data.is_open : defaultOpen
}

export async function getOpenStaffForDate(
  supabase: SupabaseClient,
  date: string,
): Promise<StaffUser[]> {
  const staff = await getActiveStaff(supabase)

  const results = await Promise.all(
    staff.map(async (s) => {
      const open = await isStaffOpenForDate(
        supabase,
        s.id,
        date,
        s.default_open,
      )
      return { staff: s, open }
    }),
  )

  return results.filter((r) => r.open).map((r) => r.staff)
}
