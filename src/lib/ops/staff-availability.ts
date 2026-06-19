import type { SupabaseClient } from '@supabase/supabase-js'
import { getAvailableSlots, type SlotOption } from '@/lib/ops/availability'
import { loadAvailabilityBundle } from '@/lib/ops/availability-bundle'
import { getOpenStaffForDate, type StaffUser } from '@/lib/ops/staff'

export type StaffSlotResult = {
  staffUserId: string
  staffName: string
  slots: SlotOption[]
}

export async function getStaffPrioritizedSlots(params: {
  supabase: SupabaseClient
  date: string
  requiredMinutes: number
  excludeAppointmentId?: string
  minStartMinutes?: number
  maxResults?: number
  preferredStaffUserId?: string | null
}): Promise<StaffSlotResult | null> {
  const {
    supabase,
    date,
    requiredMinutes,
    excludeAppointmentId,
    minStartMinutes,
    maxResults = 12,
    preferredStaffUserId,
  } = params

  let staffToCheck: StaffUser[]

  if (preferredStaffUserId) {
    const allOpen = await getOpenStaffForDate(supabase, date)
    const preferred = allOpen.find((s) => s.id === preferredStaffUserId)
    staffToCheck = preferred ? [preferred] : allOpen
  } else {
    staffToCheck = await getOpenStaffForDate(supabase, date)
  }

  for (const staff of staffToCheck) {
    const bundle = await loadAvailabilityBundle(supabase, date, {
      excludeAppointmentId,
      staffUserId: staff.id,
    })

    const slots = getAvailableSlots({
      date,
      requiredMinutes,
      templates: bundle.templates,
      overrides: bundle.overrides,
      appointments: bundle.appointments,
      minStartMinutes,
      maxResults,
    })

    if (slots.length > 0) {
      return {
        staffUserId: staff.id,
        staffName: staff.display_name,
        slots,
      }
    }
  }

  return null
}

export async function getAllStaffSlots(params: {
  supabase: SupabaseClient
  date: string
  requiredMinutes: number
  minStartMinutes?: number
  maxResults?: number
}): Promise<StaffSlotResult[]> {
  const {
    supabase,
    date,
    requiredMinutes,
    minStartMinutes,
    maxResults = 8,
  } = params

  const openStaff = await getOpenStaffForDate(supabase, date)
  const results: StaffSlotResult[] = []

  for (const staff of openStaff) {
    const bundle = await loadAvailabilityBundle(supabase, date, {
      staffUserId: staff.id,
    })

    const slots = getAvailableSlots({
      date,
      requiredMinutes,
      templates: bundle.templates,
      overrides: bundle.overrides,
      appointments: bundle.appointments,
      minStartMinutes,
      maxResults,
    })

    if (slots.length > 0) {
      results.push({
        staffUserId: staff.id,
        staffName: staff.display_name,
        slots,
      })
    }
  }

  return results
}

/**
 * Slots for ONE specific tech. Returns only that tech's openings (empty if the
 * tech is closed that day) so the admin booking UI never offers a window that
 * would double-book the assigned technician.
 */
export async function getSlotsForStaff(params: {
  supabase: SupabaseClient
  date: string
  requiredMinutes: number
  staffUserId: string
  excludeAppointmentId?: string
  minStartMinutes?: number
  maxResults?: number
}): Promise<SlotOption[]> {
  const {
    supabase,
    date,
    requiredMinutes,
    staffUserId,
    excludeAppointmentId,
    minStartMinutes,
    maxResults = 12,
  } = params

  const openStaff = await getOpenStaffForDate(supabase, date)
  if (!openStaff.some((s) => s.id === staffUserId)) return []

  const bundle = await loadAvailabilityBundle(supabase, date, {
    excludeAppointmentId,
    staffUserId,
  })

  return getAvailableSlots({
    date,
    requiredMinutes,
    templates: bundle.templates,
    overrides: bundle.overrides,
    appointments: bundle.appointments,
    minStartMinutes,
    maxResults,
  })
}

export async function getUnionedSlots(params: {
  supabase: SupabaseClient
  date: string
  requiredMinutes: number
  minStartMinutes?: number
  maxResults?: number
}): Promise<SlotOption[]> {
  const allStaff = await getAllStaffSlots(params)
  const seen = new Set<string>()
  const union: SlotOption[] = []

  for (const result of allStaff) {
    for (const slot of result.slots) {
      const key = `${slot.start_time}-${slot.end_time}`
      if (!seen.has(key)) {
        seen.add(key)
        union.push(slot)
      }
    }
  }

  union.sort((a, b) => {
    const [ah, am] = a.start_time.split(':').map(Number)
    const [bh, bm] = b.start_time.split(':').map(Number)
    return ah * 60 + am - (bh * 60 + bm)
  })

  return union.slice(0, params.maxResults || 8)
}
