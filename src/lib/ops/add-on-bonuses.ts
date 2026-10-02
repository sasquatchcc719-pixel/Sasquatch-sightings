import type { createAdminClient } from '@/supabase/server'

type AdminClient = ReturnType<typeof createAdminClient>

export type AddOnBonusCategory =
  | 'carpet_cleaning'
  | 'tile_and_grout'
  | 'rug_cleaning'
  | 'upholstery_cleaning'

export const ADD_ON_BONUS_CATEGORY_LABELS: Record<AddOnBonusCategory, string> =
  {
    carpet_cleaning: 'Carpet cleaning',
    tile_and_grout: 'Tile & grout',
    rug_cleaning: 'Rug cleaning',
    upholstery_cleaning: 'Furniture / upholstery',
  }

export type AddOnBonusRow = {
  key: string
  appointmentId: string
  appointmentDate: string
  staffUserId: string
  staffName: string
  customerName: string
  category: AddOnBonusCategory
  categoryLabel: string
  eligibleRevenue: number
  bonusRate: number
  bonusAmount: number
  status: 'earned' | 'pending'
}

export type AddOnBonusSummary = {
  rows: AddOnBonusRow[]
  earnedBonus: number
  pendingBonus: number
  eligibleRevenue: number
}

function normalize(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}

/**
 * Only whole service categories qualify. Fees, estimate corrections and
 * ancillary treatments do not become bonuses just because they live beside
 * carpet services in the catalog.
 */
export function qualifyingAddOnCategory(
  catalogCategory: string | null | undefined,
  serviceName: string | null | undefined,
): AddOnBonusCategory | null {
  const category = normalize(catalogCategory)
  const name = normalize(serviceName)

  if (category === 'rug cleaning' || (!category && /\brug\b/.test(name))) {
    return 'rug_cleaning'
  }
  if (
    category === 'upholstery cleaning' ||
    (!category &&
      /(sofa|couch|sectional|recliner|love seat|dining chair|ottoman|upholstery)/.test(
        name,
      ))
  ) {
    return 'upholstery_cleaning'
  }
  if ((category === 'hard surface' || !category) && /(tile|grout)/.test(name)) {
    return 'tile_and_grout'
  }
  if (
    (category === 'carpet cleaning' || !category) &&
    /(step carpet|room|walk-in closet|encapsulation|commercial carpet)/.test(
      name,
    )
  ) {
    return 'carpet_cleaning'
  }

  return null
}

export function isNewQualifyingServiceCategory(
  category: AddOnBonusCategory | null,
  baselineCategories: readonly AddOnBonusCategory[],
): category is AddOnBonusCategory {
  return Boolean(category && !baselineCategories.includes(category))
}

function unwrap<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

export async function captureAddOnBonusBaseline(
  supabase: AdminClient,
  appointmentId: string,
): Promise<AddOnBonusCategory[]> {
  const { data: appointment, error: appointmentError } = await supabase
    .from('ops_appointments')
    .select('add_on_bonus_baseline_categories, commission_baseline_captured_at')
    .eq('id', appointmentId)
    .single()

  if (appointmentError) throw appointmentError
  if (appointment.commission_baseline_captured_at) {
    return (appointment.add_on_bonus_baseline_categories ||
      []) as AddOnBonusCategory[]
  }

  const { data: lines, error: linesError } = await supabase
    .from('ops_appointment_line_items')
    .select(
      `
        name_snapshot,
        line_total,
        excluded_at,
        service_catalog_items (category, name)
      `,
    )
    .eq('appointment_id', appointmentId)

  if (linesError) throw linesError

  const categories = new Set<AddOnBonusCategory>()
  let baselineTotal = 0
  for (const line of lines || []) {
    if (line.excluded_at) continue
    baselineTotal += Number(line.line_total || 0)
    const catalog = unwrap(line.service_catalog_items)
    const category = qualifyingAddOnCategory(
      catalog?.category,
      catalog?.name || line.name_snapshot,
    )
    if (category) categories.add(category)
  }

  const capturedAt = new Date().toISOString()
  const baselineCategories = [...categories]
  const { data: captured, error: captureError } = await supabase
    .from('ops_appointments')
    .update({
      add_on_bonus_baseline_categories: baselineCategories,
      commission_baseline_total: Math.round(baselineTotal * 100) / 100,
      commission_baseline_captured_at: capturedAt,
    })
    .eq('id', appointmentId)
    .is('commission_baseline_captured_at', null)
    .select('add_on_bonus_baseline_categories')
    .maybeSingle()

  if (captureError) throw captureError
  if (captured) {
    return (captured.add_on_bonus_baseline_categories ||
      []) as AddOnBonusCategory[]
  }

  const { data: raced, error: racedError } = await supabase
    .from('ops_appointments')
    .select('add_on_bonus_baseline_categories')
    .eq('id', appointmentId)
    .single()
  if (racedError) throw racedError
  return (raced.add_on_bonus_baseline_categories || []) as AddOnBonusCategory[]
}

export function discountedEligibleRevenue(
  lineRevenue: number,
  subtotal: number,
  discountAmount: number,
  percentageDiscountAmount: number,
): number {
  if (lineRevenue <= 0 || subtotal <= 0) return 0
  const netSubtotal = Math.max(
    0,
    subtotal - discountAmount - percentageDiscountAmount,
  )
  const factor = Math.min(1, netSubtotal / subtotal)
  return Math.round(lineRevenue * factor * 100) / 100
}

export async function loadAddOnBonuses(
  supabase: AdminClient,
  options: { startDate: string; endDate: string; staffUserId?: string },
): Promise<AddOnBonusSummary> {
  const { data: appointments, error: appointmentsError } = await supabase
    .from('ops_appointments')
    .select(
      `
        id,
        appointment_date,
        ops_customers!ops_appointments_customer_id_fkey (
          full_name,
          business_name
        )
      `,
    )
    .gte('appointment_date', options.startDate)
    .lte('appointment_date', options.endDate)

  if (appointmentsError) throw appointmentsError
  const appointmentIds = (appointments || []).map((row) => row.id)
  if (appointmentIds.length === 0) {
    return { rows: [], earnedBonus: 0, pendingBonus: 0, eligibleRevenue: 0 }
  }

  let lineQuery = supabase
    .from('ops_appointment_line_items')
    .select(
      'id, appointment_id, line_total, add_on_bonus_staff_user_id, add_on_bonus_category, add_on_bonus_rate',
    )
    .in('appointment_id', appointmentIds)
    .not('add_on_bonus_staff_user_id', 'is', null)
    .is('excluded_at', null)

  if (options.staffUserId) {
    lineQuery = lineQuery.eq('add_on_bonus_staff_user_id', options.staffUserId)
  }

  const { data: lines, error: linesError } = await lineQuery
  if (linesError) throw linesError
  if (!lines?.length) {
    return { rows: [], earnedBonus: 0, pendingBonus: 0, eligibleRevenue: 0 }
  }

  const staffIds = [
    ...new Set(lines.map((line) => line.add_on_bonus_staff_user_id as string)),
  ]
  const [
    { data: staff, error: staffError },
    { data: invoices, error: invoiceError },
  ] = await Promise.all([
    supabase.from('staff_users').select('id, display_name').in('id', staffIds),
    supabase
      .from('ops_invoices')
      .select(
        'id, appointment_id, payment_status, subtotal, discount_amount, percentage_discount_amount, created_at',
      )
      .in('appointment_id', appointmentIds)
      .order('created_at', { ascending: false }),
  ])

  if (staffError) throw staffError
  if (invoiceError) throw invoiceError

  const appointmentById = new Map(
    (appointments || []).map((row) => [row.id, row]),
  )
  const staffById = new Map(
    (staff || []).map((row) => [row.id, row.display_name]),
  )
  const invoiceByAppointment = new Map<string, (typeof invoices)[number]>()
  for (const invoice of invoices || []) {
    if (!invoiceByAppointment.has(invoice.appointment_id)) {
      invoiceByAppointment.set(invoice.appointment_id, invoice)
    }
  }

  const grouped = new Map<
    string,
    {
      appointmentId: string
      staffUserId: string
      category: AddOnBonusCategory
      rate: number
      lineRevenue: number
    }
  >()

  for (const line of lines) {
    const category = line.add_on_bonus_category as AddOnBonusCategory | null
    const staffUserId = line.add_on_bonus_staff_user_id as string | null
    if (!category || !staffUserId) continue
    const key = `${line.appointment_id}:${staffUserId}:${category}`
    const existing = grouped.get(key) || {
      appointmentId: line.appointment_id,
      staffUserId,
      category,
      rate: Number(line.add_on_bonus_rate || 0),
      lineRevenue: 0,
    }
    existing.lineRevenue += Number(line.line_total || 0)
    grouped.set(key, existing)
  }

  const rows: AddOnBonusRow[] = []
  for (const [key, group] of grouped) {
    const appointment = appointmentById.get(group.appointmentId)
    if (!appointment) continue
    const invoice = invoiceByAppointment.get(group.appointmentId)
    const customer = unwrap(appointment.ops_customers)
    const eligibleRevenue = discountedEligibleRevenue(
      group.lineRevenue,
      Number(invoice?.subtotal || 0),
      Number(invoice?.discount_amount || 0),
      Number(invoice?.percentage_discount_amount || 0),
    )
    const bonusAmount = Math.round(eligibleRevenue * group.rate * 100) / 100

    rows.push({
      key,
      appointmentId: group.appointmentId,
      appointmentDate: appointment.appointment_date,
      staffUserId: group.staffUserId,
      staffName: staffById.get(group.staffUserId) || 'Unknown technician',
      customerName:
        customer?.business_name?.trim() ||
        customer?.full_name?.trim() ||
        'Customer',
      category: group.category,
      categoryLabel: ADD_ON_BONUS_CATEGORY_LABELS[group.category],
      eligibleRevenue,
      bonusRate: group.rate,
      bonusAmount,
      status: invoice?.payment_status === 'paid' ? 'earned' : 'pending',
    })
  }

  rows.sort(
    (a, b) =>
      b.appointmentDate.localeCompare(a.appointmentDate) ||
      a.customerName.localeCompare(b.customerName),
  )

  return {
    rows,
    earnedBonus:
      Math.round(
        rows
          .filter((row) => row.status === 'earned')
          .reduce((sum, row) => sum + row.bonusAmount, 0) * 100,
      ) / 100,
    pendingBonus:
      Math.round(
        rows
          .filter((row) => row.status === 'pending')
          .reduce((sum, row) => sum + row.bonusAmount, 0) * 100,
      ) / 100,
    eligibleRevenue:
      Math.round(
        rows.reduce((sum, row) => sum + row.eligibleRevenue, 0) * 100,
      ) / 100,
  }
}
