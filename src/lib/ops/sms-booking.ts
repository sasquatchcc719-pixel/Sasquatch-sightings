import type { createAdminClient } from '@/supabase/server'
import { getAvailableSlots } from '@/lib/ops/availability'

const OPS_SMS_BOOKING_ENABLED = process.env.OPS_SMS_BOOKING_ENABLED === 'true'

function addDays(baseDate: Date, days: number): Date {
  return new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000)
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function formatHumanSlot(date: string, time: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  const displayDate = new Date(year, month - 1, day, hours, minutes)
  return displayDate.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function matchesService(
  serviceNeeded: string | null,
  name: string,
  category: string,
) {
  if (!serviceNeeded) return false
  const haystack = `${name} ${category}`.toLowerCase()
  return serviceNeeded
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .some((token) => haystack.includes(token))
}

export async function buildSmsSlotOffer(params: {
  supabase: ReturnType<typeof createAdminClient>
  serviceNeeded: string | null
}): Promise<string | null> {
  if (!OPS_SMS_BOOKING_ENABLED) {
    return null
  }

  const { data: services, error: servicesError } = await params.supabase
    .from('service_catalog_items')
    .select('id, name, category, default_duration_minutes, buffer_minutes')
    .eq('is_active', true)
    .order('name')

  if (servicesError || !services || services.length === 0) {
    return null
  }

  const selectedService =
    services.find((service) =>
      matchesService(params.serviceNeeded, service.name, service.category),
    ) || services[0]

  if (
    !Number.isFinite(selectedService.default_duration_minutes) ||
    Number(selectedService.default_duration_minutes) <= 0
  ) {
    return null
  }

  const [templatesResult, overridesResult] = await Promise.all([
    params.supabase
      .from('availability_templates')
      .select('*')
      .eq('is_active', true),
    params.supabase.from('availability_overrides').select('*'),
  ])

  if (templatesResult.error || overridesResult.error) {
    return null
  }

  const requiredMinutes =
    Number(selectedService.default_duration_minutes) +
    Number(selectedService.buffer_minutes || 0)

  const slotLabels: string[] = []

  for (let offset = 1; offset <= 7; offset += 1) {
    const targetDate = formatDate(addDays(new Date(), offset))
    const { data: appointments, error: appointmentsError } =
      await params.supabase
        .from('ops_appointments')
        .select('appointment_date, start_time, end_time, status')
        .eq('appointment_date', targetDate)

    if (appointmentsError) {
      continue
    }

    const slots = getAvailableSlots({
      date: targetDate,
      requiredMinutes,
      templates: templatesResult.data || [],
      overrides: overridesResult.data || [],
      appointments: appointments || [],
      maxResults: 3 - slotLabels.length,
    })

    for (const slot of slots) {
      slotLabels.push(formatHumanSlot(targetDate, slot.start_time))
      if (slotLabels.length >= 3) {
        break
      }
    }

    if (slotLabels.length >= 3) {
      break
    }
  }

  if (slotLabels.length === 0) {
    return null
  }

  return `I can start offering live calendar times here now. For ${selectedService.name}, the next openings are ${slotLabels.join(', ')}. Reply with the one you want and I'll hold it for you.`
}
